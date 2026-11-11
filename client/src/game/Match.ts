import {
  AdditiveBlending,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import {
  CARDS,
  FIELD_HALF_WIDTH,
  HOME_TEAM,
  STYLE_BY_ID,
  cardRating,
  catchChance,
  heatLabel,
  RECEIVER_POSITIONS,
  RECEIVER_SLOTS,
  ROUTE_COLORS,
  SACK_YARDS,
  YARD,
  playById,
  routePath,
  stageInfo,
  yardToZ,
  type ArmStats,
  type Difficulty,
  type MatchResultMessage,
  type MatchState,
  type PlayDef,
  type PlayOutcome,
  type ProfileMessage,
  type StageInfo,
} from '@mctf/shared';
import { NpcBody, type NpcPose } from '../actors/NpcBody.js';
import type { Avatar } from '../actors/Avatar.js';
import { Ball, ballTrailColor } from '../world/Ball.js';
import { Effects } from '../world/Effects.js';
import { Trail } from '../world/Trail.js';
import { RouteArrow } from '../world/RouteArrow.js';
import type { FieldLines } from '../world/FieldLines.js';
import type { Stadium } from '../world/Stadium.js';
import type { Input } from '../input/Input.js';
import type { Hud } from '../ui/Hud.js';
import type { Labels, Tag } from '../ui/Labels.js';
import { CATCH_HEIGHT, type AimTarget, type Thrower, type ThrowEvent } from './Thrower.js';
import { makeRoster, type RosterEntry } from './roster.js';
import { sound } from '../audio/Sound.js';

type Phase = 'idle' | 'call' | 'presnap' | 'snap' | 'pocket' | 'flight' | 'carry' | 'dead' | 'waiting';
type Role = 'ol' | 'wr' | 'dl' | 'cover' | 'lb' | 'safety';

interface Actor {
  body: NpcBody;
  role: Role;
  pos: Vector3;
  vel: Vector3;
  yaw: number;
  speed: number;
  max: number;
  slot: number;
  tag: Tag | null;
  entry: RosterEntry;
  /** Card overall (from your lineup) or a default for computer players. */
  rating: number;
  // Receivers.
  path: Vector3[];
  wp: number;
  hold: boolean;
  history: Array<{ t: number; x: number; z: number }>;
  // Ball reaction.
  goTo: Vector3 | null;
  goAt: number;
  // Linemen.
  home: Vector3;
  rushing: boolean;
  down: boolean;
  glow: Mesh | null;
}

export interface MatchContext {
  scene: Scene;
  camera: PerspectiveCamera;
  input: Input;
  hud: Hud;
  labels: Labels;
  qb: Avatar;
  ball: Ball;
  thrower: Thrower;
  lines: FieldLines;
  stadium: Stadium;
  stats(): ArmStats;
  profile(): ProfileMessage | null;
  send(result: MatchResultMessage): void;
  touch: boolean;
}

const OL_POS = ['LT', 'LG', 'C', 'RG', 'RT'];

const OL_NUMBERS = [71, 64, 55, 62, 77];
const WR_NUMBERS = [11, 85, 17];
const CALL_SECONDS = 2.2;
const PRESNAP_SECONDS = 3;
const QB_SPEED = 7.5;
const CATCH_RADIUS = 1.45;
const TACKLE_RADIUS = 1.45;

const v1 = new Vector3();
const v2 = new Vector3();
const camTarget = new Vector3();
const lookTarget = new Vector3();

const glowGeo = new CircleGeometry(1.1, 24);

/** One game: a single drive, run play by play against the AI defense. */
export class Match {
  private phase: Phase = 'idle';
  private t = 0;
  private playClock = 0;
  private state: MatchState | null = null;
  private info: StageInfo = stageInfo(1);
  private play: PlayDef = playById('slants');
  private z0 = 0;
  private offense: Actor[] = [];
  private receivers: Actor[] = [];
  private linemen: Actor[] = [];
  private defense: Actor[] = [];
  private rushers: Actor[] = [];
  private arrows: RouteArrow[] = [];
  private carrier: Actor | null = null;
  private throwEvent: ThrowEvent | null = null;
  private pocketTime = 5;
  private hasBall = false;
  private resultSent = false;
  private outcome: PlayOutcome = 'incomplete';
  private gained = 0;
  private perfect = false;
  private deadSpotZ = 0;
  private breaker: Actor | null = null;
  private readonly lookAt = new Vector3();
  private time = 0;
  private builtStage = -1;
  private readonly offenseRoster = makeRoster(7, [...OL_NUMBERS, ...WR_NUMBERS]);
  private qbX = 0;
  private qbZ = 0;
  private sacked = false;
  private firstPlay = true;
  /** Look direction in the pocket: yaw 0 = straight downfield. */
  private aimYaw = 0;
  /** Flat direction the flight camera chases the ball along. */
  private readonly chaseDir = new Vector3(0, 0, 1);
  private aimPitch = 0.16;
  private offenseKey = '';
  private rbBoost = 1;
  private readonly heatTag: Tag;
  private readonly effects: Effects;
  private readonly trail: Trail;

  constructor(private readonly ctx: MatchContext) {
    this.effects = new Effects(ctx.scene);
    this.trail = new Trail(ctx.scene);
    this.heatTag = ctx.labels.tag();
    this.heatTag.visible = false;
    this.heatTag.el.classList.add('heat');
    this.buildOffense();
  }

  /** Equipped style: the carrier's run trail. */
  applyStyle(p: ProfileMessage): void {
    this.trail.setColors(STYLE_BY_ID[p.styleEquipped.trail]?.colors ?? [0xffffff]);
  }

  /** Keep running effects alive between games (confetti still falling). */
  updateEffects(dt: number): void {
    this.effects.update(dt);
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  // ------------------------------------------------------------ lifecycle

  /** The server's state for the next snap (or the first one). */
  onState(state: MatchState): void {
    const firstOfGame = !this.state || !this.active;
    this.state = state;
    this.info = stageInfo(state.stage);
    if (this.lineupKey() !== this.offenseKey) this.buildOffense();
    if (this.builtStage !== state.stage) this.buildDefense();
    if (firstOfGame) {
      this.ctx.stadium.setTheme(HOME_TEAM, this.info.opponent);
      this.firstPlay = true;
    }
    this.setupPlay();
  }

  stop(): void {
    this.phase = 'idle';
    this.state = null;
    this.clearArrows();
    this.ctx.lines.hide();
    this.ctx.hud.callout(null);
    this.ctx.hud.coach(null);
    this.ctx.hud.pocket(null);
    this.ctx.hud.meter(null);
    this.ctx.thrower.visible = false;
    this.ctx.thrower.cancel();
    this.ctx.ball.hide();
    this.ctx.hud.setReticle(false, false);
    this.heatTag.visible = false;
    this.trail.clear();
    for (const a of [...this.offense, ...this.defense]) {
      a.body.root.visible = false;
      if (a.tag) a.tag.visible = false;
      if (a.glow) a.glow.visible = false;
    }
  }

  /** The game ended (touchdown, downs, interception): freeze on the field. */
  finish(): void {
    this.phase = 'waiting';
    this.ctx.hud.coach(null);
    this.ctx.hud.pocket(null);
    this.ctx.hud.meter(null);
    this.ctx.hud.setReticle(false, false);
    this.heatTag.visible = false;
    this.ctx.thrower.visible = false;
  }

  // ------------------------------------------------------------ building

  private actor(body: NpcBody, role: Role, entry: RosterEntry, slot: number, tagged: boolean): Actor {
    this.ctx.scene.add(body.root);
    body.root.visible = false;
    const tag = tagged ? this.ctx.labels.tag() : null;
    if (tag) tag.visible = false;
    return {
      body,
      role,
      pos: new Vector3(),
      vel: new Vector3(),
      yaw: 0,
      speed: 0,
      max: 0,
      slot,
      tag,
      entry,
      rating: 70,
      path: [],
      wp: 0,
      hold: false,
      history: [],
      goTo: null,
      goAt: 0,
      home: new Vector3(),
      rushing: false,
      down: false,
      glow: null,
    };
  }

  private lineupKey(): string {
    const p = this.ctx.profile();
    if (!p) return '';
    const lv = (id: number): string => `${id}:${cardRating(id, p.cards[id] ?? 1)}`;
    return [...p.lineup.wr.map(lv), '|', ...p.lineup.ol.map(lv), '|', ...p.lineup.rb.map(lv)].join(',');
  }

  /** A roster entry and rating for a lineup card (or the made-up fallback). */
  private fromCard(id: number | undefined, fallback: RosterEntry): { entry: RosterEntry; rating: number } {
    const p = this.ctx.profile();
    const card = id === undefined ? undefined : CARDS[id];
    if (!p || !card) return { entry: fallback, rating: 66 };
    return { entry: { name: card.short, short: card.short.split(' ').pop() ?? card.short, num: card.num }, rating: cardRating(card.id, p.cards[card.id] ?? 1) };
  }

  private buildOffense(): void {
    // Rebuilt whenever the equipped lineup changes: new names, numbers and ratings.
    for (const a of this.offense) {
      a.body.dispose();
      if (a.tag) this.ctx.labels.remove(a.tag);
      if (a.glow) this.ctx.scene.remove(a.glow);
    }
    this.offense = [];
    this.linemen = [];
    this.receivers = [];
    this.offenseKey = this.lineupKey();
    const lineup = this.ctx.profile()?.lineup;
    const rb = this.fromCard(lineup?.rb[0], this.offenseRoster[0] as RosterEntry);
    this.rbBoost = lineup?.rb.length ? 1 + (rb.rating - 55) * 0.006 : 1;
    const c = HOME_TEAM.colors;
    for (let i = 0; i < 5; i += 1) {
      const { entry: e, rating } = this.fromCard(lineup?.ol[i], this.offenseRoster[i] as RosterEntry);
      const a = this.actor(new NpcBody(c, e.num, e.short, i * 31 + 3), 'ol', e, i, true);
      a.rating = rating;
      if (a.tag) this.ctx.labels.set(a.tag, `${e.name}<small>${OL_POS[i]} ${rating}</small>`);
      this.linemen.push(a);
      this.offense.push(a);
    }
    for (let s = 0; s < RECEIVER_SLOTS; s += 1) {
      const { entry: e, rating } = this.fromCard(lineup?.wr[s], this.offenseRoster[5 + s] as RosterEntry);
      const a = this.actor(new NpcBody(c, e.num, e.short, s * 17 + 5), 'wr', e, s, true);
      a.rating = rating;
      const glow = new Mesh(glowGeo, new MeshBasicMaterial({ color: ROUTE_COLORS[s], transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.1;
      glow.visible = false;
      this.ctx.scene.add(glow);
      a.glow = glow;
      this.receivers.push(a);
      this.offense.push(a);
    }
  }

  private buildDefense(): void {
    for (const a of this.defense) {
      a.body.dispose();
      if (a.tag) this.ctx.labels.remove(a.tag);
    }
    this.defense = [];
    this.rushers = [];
    this.builtStage = this.state?.stage ?? 1;
    const opp = this.info.opponent;
    const roster = makeRoster(this.builtStage * 101 + 13, [91, 97, 94, 99, 24, 52, 31, 21, 54]);
    for (let i = 0; i < 4; i += 1) {
      const e = roster[i] as RosterEntry;
      const a = this.actor(new NpcBody(opp.colors, e.num, e.short, i * 13 + this.builtStage), 'dl', e, i, false);
      this.rushers.push(a);
      this.defense.push(a);
    }
    for (let s = 0; s < RECEIVER_SLOTS; s += 1) {
      const e = roster[4 + s] as RosterEntry;
      this.defense.push(this.actor(new NpcBody(opp.colors, e.num, e.short, s * 7 + this.builtStage * 3), 'cover', e, s, false));
    }
    const e = roster[7] as RosterEntry;
    this.defense.push(this.actor(new NpcBody(opp.colors, e.num, e.short, 77 + this.builtStage), 'safety', e, 0, false));
    const lb = roster[8] as RosterEntry;
    this.defense.push(this.actor(new NpcBody(opp.colors, lb.num, lb.short, 55 + this.builtStage), 'lb', lb, 0, false));
  }

  private get diff(): Difficulty {
    return this.info.difficulty;
  }

  private place(a: Actor, x: number, z: number, yaw: number, pose: NpcPose): void {
    a.pos.set(x, 0, z);
    a.vel.set(0, 0, 0);
    a.speed = 0;
    a.yaw = yaw;
    a.goTo = null;
    a.down = false;
    a.rushing = false;
    a.history.length = 0;
    a.home.set(x, 0, z);
    a.body.setPose(pose);
    a.body.speed = 0;
    a.body.root.visible = true;
    a.body.root.position.copy(a.pos);
    a.body.root.rotation.y = yaw;
    if (a.tag) a.tag.visible = true;
  }

  private setupPlay(): void {
    const st = this.state as MatchState;
    const ctx = this.ctx;
    this.play = playById(st.playId);
    this.z0 = yardToZ(st.yardLine);
    const z0 = this.z0;
    this.carrier = null;
    this.throwEvent = null;
    this.hasBall = false;
    this.resultSent = false;
    this.sacked = false;
    this.breaker = null;
    this.perfect = false;
    this.outcome = 'incomplete';
    this.gained = 0;
    this.pocketTime = this.diff.pocket + ctx.stats().pocketBonus;
    ctx.thrower.cancel();
    ctx.qb.setState('free');
    ctx.qb.holdingBall = false;

    // Offense.
    this.linemen.forEach((a, i) => this.place(a, (i - 2) * 2 * YARD, z0 - 0.7 * YARD, 0, i === 2 ? 'snap' : 'stance'));
    (this.linemen[2] as Actor).body.setPose('stance');
    this.receivers.forEach((a, s) => {
      const path = routePath(this.play, s, 0, 80);
      const start = path[0] as [number, number];
      this.place(a, start[0] * YARD, z0 + start[1] * YARD, 0, s === 1 ? 'stance' : 'idle');
      // Routes that keep running after their last cut stay in bounds (a step inside the sideline).
      const edge = FIELD_HALF_WIDTH - 1.6;
      a.path = path.slice(1).map(([x, z]) => new Vector3(Math.max(-edge, Math.min(edge, x * YARD)), 0, z0 + z * YARD));
      a.wp = 0;
      a.hold = !!this.play.routes[s]?.hold;
      a.max = this.diff.receiverSpeed * (s === 1 ? 0.93 : 1);
      if (a.tag) ctx.labels.set(a.tag, `${a.entry.name}<small>${RECEIVER_POSITIONS[s]} ${a.rating}</small>`);
      if (a.glow) {
        a.glow.visible = true;
        a.glow.position.set(a.pos.x, 0.1, a.pos.z);
      }
    });
    this.qbX = 0;
    this.qbZ = z0 - 5 * YARD;
    ctx.qb.root.position.set(this.qbX, 0, this.qbZ);
    ctx.qb.root.rotation.y = 0;
    ctx.qb.root.visible = true;

    // Defense.
    const d = this.diff;
    this.rushers.forEach((a, i) => this.place(a, [-5, -1.6, 1.6, 5][i]! * YARD, z0 + 1.0 * YARD, Math.PI, 'stance'));
    for (const a of this.defense) {
      if (a.role === 'cover') {
        const r = this.receivers[a.slot] as Actor;
        this.place(a, r.pos.x + (r.pos.x > 0 ? -0.8 : 0.8), z0 + d.cushion * YARD, Math.PI, 'idle');
        a.max = r.max * d.coverSpeed;
      } else if (a.role === 'safety') {
        this.place(a, 0, z0 + (d.safety ? 14 : 17) * YARD, Math.PI, 'idle');
        a.max = this.diff.receiverSpeed * d.coverSpeed * (d.safety ? 0.95 : 0.85);
      } else if (a.role === 'lb') {
        this.place(a, 0, z0 + 5.5 * YARD, Math.PI, 'idle');
        a.max = this.diff.receiverSpeed * d.coverSpeed * 0.9;
      }
    }
    for (const a of this.rushers) a.max = 13;

    // Arrows.
    this.clearArrows();
    this.receivers.forEach((a, s) => {
      const pts = routePath(this.play, s, 0, 5).map(([x, z]) => [x * YARD, z0 + z * YARD] as const);
      const arrow = new RouteArrow(pts, ROUTE_COLORS[s] as number);
      ctx.scene.add(arrow.mesh);
      this.arrows.push(arrow);
    });

    // Ball spotted under the center.
    ctx.ball.hold(new Vector3(0, 0.25, z0 - 0.15), Math.PI / 2);
    ctx.ball.mesh.rotation.set(0, 0, 0);

    ctx.lines.show(st.yardLine, st.toGo, st.down);
    ctx.hud.setScoreboard(st);
    ctx.hud.pocket(null);
    ctx.hud.meter(null);
    ctx.thrower.visible = false;
    ctx.thrower.aim.set(0, 0, z0 + 12 * YARD);
    ctx.hud.setReticle(false, false);
    this.aimYaw = 0;
    this.aimPitch = 0.16;
    this.trail.clear();
    const heat = heatLabel(st.heat ?? 0);
    this.heatTag.visible = !!heat;
    if (heat) this.ctx.labels.set(this.heatTag, heat);
    this.phase = 'call';
    this.t = 0;
    ctx.input.clearPrimary();
    ctx.input.touchTurns = false;
    ctx.hud.callout(this.play.name, ctx.touch ? 'Tap HIKE to snap' : 'Click to hike', '#ffffff');
    ctx.hud.coach(this.firstPlay ? 'Watch the arrows: that is where each receiver will run.' : null);
    ctx.hud.setMainButton('HIKE');
    this.firstPlay = false;
    // Snap the camera overhead for the call.
    this.cameraFor('call', 1);
  }

  private clearArrows(): void {
    for (const a of this.arrows) a.dispose();
    this.arrows = [];
  }

  // ------------------------------------------------------------ frame

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.time += dt;
    this.t += dt;
    const ctx = this.ctx;
    for (const a of this.arrows) a.tick(this.time);
    ctx.lines.update(dt);

    switch (this.phase) {
      case 'call': {
        const k = Math.min(1, this.t / 1.4);
        for (const a of this.arrows) {
          a.progress = k * k * (3 - 2 * k);
          a.opacity = 1;
        }
        // A click here snaps straight away (as the callout promises);
        // otherwise the play call rolls into the presnap countdown.
        // Clicks in the first half second stay queued, not dropped.
        const clicked = this.t > 0.5 && ctx.input.takePrimary();
        if (clicked || this.t > CALL_SECONDS) {
          for (const a of this.arrows) a.progress = 1.001;
          if (clicked) {
            this.hike();
          } else {
            this.phase = 'presnap';
            this.t = 0;
          }
        }
        break;
      }
      case 'presnap': {
        const left = Math.ceil(PRESNAP_SECONDS - this.t);
        ctx.hud.callout(this.play.name, `${ctx.touch ? 'Tap HIKE' : 'Click to hike'} (${Math.max(1, left)})`, '#ffffff', false);
        if (this.t >= PRESNAP_SECONDS || (this.t > 0.35 && ctx.input.takePrimary())) this.hike();
        break;
      }
      case 'snap': {
        // The ball travels from the center to the quarterback.
        const k = Math.min(1, this.t / 0.3);
        ctx.qb.handPosition(v1);
        v2.set(0, 0.6, this.z0 - 0.3).lerp(v1, k);
        v2.y += Math.sin(k * Math.PI) * 0.6;
        ctx.ball.hold(v2, 0);
        if (k >= 1) {
          this.phase = 'pocket';
          this.hasBall = true;
          ctx.qb.holdingBall = true;
          ctx.hud.callout(null);
          ctx.thrower.visible = true;
          ctx.hud.setMainButton('THROW');
          if (this.state?.plays === 0) ctx.hud.coach(ctx.touch ? 'Throw it to the OPEN receiver! Tap THROW twice.' : 'Throw it to the OPEN receiver! Click twice.');
        }
        this.simulateRoutes(dt);
        break;
      }
      case 'pocket':
        this.updatePocket(dt);
        this.simulateRoutes(dt);
        break;
      case 'flight':
        this.updateFlight(dt);
        this.simulateRoutes(dt);
        break;
      case 'carry':
        this.updateCarry(dt);
        break;
      case 'dead':
        this.updateDead(dt);
        break;
      case 'waiting':
        for (const a of [...this.offense, ...this.defense]) this.integrate(a, dt, 0);
        break;
    }

    // Arrows fade once the ball is snapped.
    if (this.phase !== 'call' && this.phase !== 'presnap') for (const a of this.arrows) a.opacity = Math.max(0, 1 - this.playClock * 2.2);

    this.syncBodies(dt);
    this.updateQbVisual(dt);
    this.updateCamera(dt);
  }

  private hike(): void {
    const ctx = this.ctx;
    this.phase = 'snap';
    this.t = 0;
    this.playClock = 0;
    ctx.input.clearPrimary();
    ctx.input.takeTurn();
    ctx.input.touchTurns = true;
    ctx.hud.callout('HIKE!', '', '#ffe23a');
    ctx.hud.coach(null);
    sound.hike();
    sound.whistle();
    for (const a of this.linemen) {
      a.body.setPose('block');
      // Declutter: only the receivers keep their tags once the ball is live.
      if (a.tag) a.tag.visible = false;
    }
    for (const a of this.rushers) a.body.setPose('rush');
    for (const a of this.receivers) a.body.setPose('run');
    for (const a of this.defense) if (a.role !== 'dl') a.body.setPose('backpedal');
  }

  // ------------------------------------------------------------ pocket

  private updatePocket(dt: number): void {
    const ctx = this.ctx;
    this.playClock += dt;
    const stats = ctx.stats();
    // Move the quarterback inside the pocket.
    ctx.input.poll();
    const mx = ctx.input.moveX;
    const mz = ctx.input.moveY;
    this.qbX = Math.max(-9, Math.min(9, this.qbX - mx * QB_SPEED * dt));
    this.qbZ = Math.max(this.z0 - 11 * YARD, Math.min(this.z0 - 1.5, this.qbZ + mz * QB_SPEED * dt));
    ctx.qb.speed = Math.hypot(mx, mz) * QB_SPEED;

    ctx.qb.handPosition(v1);
    const from = v1.clone();
    // The ball goes where the centre reticle points.
    ctx.thrower.aimFromCenter(ctx.camera, from, stats, this.aimTargets());
    ctx.thrower.update(dt, from, stats);
    ctx.hud.setReticle(true, ctx.thrower.charging);
    if (ctx.thrower.charging) ctx.hud.meter(ctx.thrower.power, ctx.thrower.idealPower(from, stats), stats.perfectBand);
    else ctx.hud.meter(null);

    if (ctx.input.takePrimary()) {
      if (!ctx.thrower.charging) {
        ctx.thrower.start();
        ctx.qb.setState('aim');
      } else {
        this.throwBall(ctx.thrower.release(from, stats, stats.perfectBand));
        return;
      }
    }
    // Hold the ball at the hand.
    ctx.ball.hold(from, ctx.qb.root.rotation.y);

    // The rush.
    const left = this.pocketTime - this.playClock;
    ctx.hud.pocket(left / this.pocketTime);
    this.updateLines(dt, Math.min(1, this.playClock / this.pocketTime));
    if (left <= 0) this.updateBreaker(dt);
    if (left < 1.2 && left > 0 && this.state?.plays === 0) ctx.hud.coach('The rush is coming - throw it!');

    this.updateOpenTags();
  }

  /** Linemen push and pull; the pocket slowly collapses. */
  /**
   * Players the reticle can sit on: a ray through someone's body targets
   * his chest, not the grass far behind him (the camera looks over the
   * quarterback's shoulder, so that ground point would send the ball over
   * his head).
   */
  private readonly targets: AimTarget[] = [];
  private aimTargets(): AimTarget[] {
    const list = [...this.receivers, ...this.defense.filter((a) => a.role !== 'dl')];
    while (this.targets.length < list.length) this.targets.push({ center: new Vector3(), radius: 1.05 });
    this.targets.length = list.length;
    list.forEach((a, i) => (this.targets[i] as AimTarget).center.set(a.pos.x, CATCH_HEIGHT - 0.3, a.pos.z));
    return this.targets;
  }

  private updateLines(dt: number, collapse: number): void {
    const qz = this.qbZ;
    const depth = (this.z0 - qz) * 0.55 * collapse * collapse;
    this.linemen.forEach((a, i) => {
      const target = v1.set(a.home.x * (1 - 0.15 * collapse), 0, a.home.z - depth - 0.6);
      this.steer(a, target, 4, dt, 0);
      a.yaw = 0;
      a.body.setPose('block');
      void i;
    });
    this.rushers.forEach((a, i) => {
      if (a === this.breaker) return;
      const ol = this.linemen[[0, 1, 3, 4][i] as number] as Actor;
      const target = v1.set(ol.pos.x + (i < 2 ? -0.3 : 0.3), 0, ol.pos.z + 1.25);
      this.steer(a, target, 6, dt, 0);
      a.yaw = Math.PI;
    });
  }

  private updateBreaker(dt: number): void {
    if (!this.breaker) {
      // The rusher nearest the quarterback beats his block.
      let best: Actor | null = null;
      let bd = Infinity;
      for (const a of this.rushers) {
        const d = Math.hypot(a.pos.x - this.qbX, a.pos.z - this.qbZ);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      this.breaker = best;
      if (best) best.body.setPose('run');
    }
    const b = this.breaker;
    if (!b) return;
    this.steer(b, v1.set(this.qbX, 0, this.qbZ), 14, dt, 30);
    if (Math.hypot(b.pos.x - this.qbX, b.pos.z - this.qbZ) < TACKLE_RADIUS) {
      b.body.setPose('dive');
      this.sacked = true;
      this.ctx.qb.setState('down');
      this.ctx.qb.holdingBall = false;
      this.ctx.thrower.cancel();
      sound.tackle();
      this.endPlay('sack', -SACK_YARDS, this.z0 - SACK_YARDS * YARD);
    }
  }

  /** Mark receivers with space around them as OPEN. */
  private updateOpenTags(): void {
    for (const r of this.receivers) {
      if (!r.tag) continue;
      let nearest = Infinity;
      for (const d of this.defense) {
        if (d.role === 'dl' || !d.body.root.visible) continue;
        nearest = Math.min(nearest, Math.hypot(d.pos.x - r.pos.x, d.pos.z - r.pos.z));
      }
      const open = nearest > 3.6 && this.playClock > 0.6;
      this.ctx.labels.set(r.tag, `${r.entry.name}<small>${RECEIVER_POSITIONS[r.slot]} ${r.rating}</small>${open ? '<span class="open-pill">OPEN</span>' : ''}`);
      r.tag.el.classList.toggle('open', open);
    }
  }

  // ------------------------------------------------------------ routes & coverage

  private simulateRoutes(dt: number): void {
    const now = this.playClock;
    for (const r of this.receivers) {
      if (r === this.carrier) continue;
      if (r.goTo) {
        // Breaking to the ball.
        const arriveIn = Math.max(0.05, r.goAt - now);
        const dist = Math.hypot(r.goTo.x - r.pos.x, r.goTo.z - r.pos.z);
        const want = Math.min(r.max * 1.3, dist / arriveIn + 0.5);
        this.steer(r, r.goTo, want, dt, 40);
        if (dist < 0.4) r.yaw = Math.atan2(this.qbX - r.pos.x, this.qbZ - r.pos.z);
        const ball = this.ctx.ball.position;
        r.body.setPose(Math.hypot(ball.x - r.pos.x, ball.z - r.pos.z) < 7 ? 'reach' : 'run');
      } else {
        const target = r.path[r.wp];
        if (target) {
          const before = r.wp;
          this.steer(r, target, r.max, dt, 26);
          if (Math.hypot(target.x - r.pos.x, target.z - r.pos.z) < 0.6) {
            r.wp += 1;
            if (r.wp > before && r.path[r.wp]) r.speed *= 0.62; // a hard cut
          }
          r.body.setPose('run');
        } else {
          // End of a hitch or curl: settle, face the quarterback.
          this.steer(r, r.pos, 0, dt, 30);
          r.yaw = Math.atan2(this.qbX - r.pos.x, this.qbZ - r.pos.z);
          r.body.setPose('idle');
        }
      }
      r.history.push({ t: now, x: r.pos.x, z: r.pos.z });
      if (r.history.length > 90) r.history.shift();
      if (r.glow) r.glow.position.set(r.pos.x, 0.1, r.pos.z);
    }

    const d = this.diff;
    for (const a of this.defense) {
      if (a.role === 'dl' || a.down) continue;
      if (a.goTo) {
        this.steer(a, a.goTo, a.max * 1.08, dt, 30);
        a.body.setPose(Math.hypot(a.goTo.x - a.pos.x, a.goTo.z - a.pos.z) < 3 ? 'reach' : 'run');
        continue;
      }
      if (a.role === 'cover') {
        const r = this.receivers[a.slot] as Actor;
        const past = this.lagged(r, now - d.reaction);
        const cushion = d.cushion * YARD * Math.max(0, 1 - now / 2.2) + 0.9;
        const inside = r.pos.x > 0 ? -0.7 : 0.7;
        const target = v1.set(past.x + inside, 0, Math.max(past.z + cushion, this.z0 + 0.5));
        this.steer(a, target, a.max, dt, 22);
        const backpedal = a.vel.z > 0.5 && now < 1.6;
        a.body.setPose(backpedal ? 'backpedal' : 'run');
        a.yaw = backpedal ? Math.PI : a.yaw;
      } else if (a.role === 'lb') {
        // Underneath zone: drift toward whoever is crossing in front of him.
        let near: Actor | null = null;
        let nd = 11 * YARD;
        for (const r of this.receivers) {
          const depth = r.pos.z - this.z0;
          const d2 = Math.hypot(r.pos.x - a.pos.x, r.pos.z - a.pos.z);
          if (depth < 12 * YARD && d2 < nd) {
            nd = d2;
            near = r;
          }
        }
        const tx = near ? near.pos.x * 0.75 : 0;
        const tz = this.z0 + Math.min(9, Math.max(4, near ? (near.pos.z - this.z0) / YARD + 1.5 : 5.5)) * YARD;
        this.steer(a, v1.set(tx, 0, tz), a.max * 0.8, dt, 16);
        a.body.setPose(a.speed > 2 ? 'run' : 'idle');
        if (a.speed < 2) a.yaw = Math.PI;
      } else if (a.role === 'safety') {
        // Shade toward the deepest receiver once someone runs past 10 yards.
        let deep: Actor | null = null;
        for (const r of this.receivers) if (r.pos.z > this.z0 + 9 * YARD && (!deep || r.pos.z > deep.pos.z)) deep = r;
        const tx = deep ? deep.pos.x * 0.7 : 0;
        const tz = Math.max(this.z0 + (d.safety ? 12 : 15) * YARD, deep ? deep.pos.z + 3 : 0);
        this.steer(a, v1.set(tx, 0, tz), a.max * 0.85, dt, 14);
        a.body.setPose(a.speed > 2 ? 'run' : 'idle');
        if (a.speed < 2) a.yaw = Math.PI;
      }
    }
  }

  private lagged(r: Actor, t: number): { x: number; z: number } {
    const h = r.history;
    if (!h.length) return { x: r.pos.x, z: r.pos.z };
    for (let i = h.length - 1; i >= 0; i -= 1) if ((h[i] as { t: number }).t <= t) return h[i] as { x: number; z: number };
    return h[0] as { x: number; z: number };
  }

  /** Accelerate an actor toward a point. */
  private steer(a: Actor, target: Vector3, maxSpeed: number, dt: number, accel: number): void {
    const dx = target.x - a.pos.x;
    const dz = target.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (accel <= 0) {
      // Linemen: ease into position.
      const k = 1 - Math.exp(-maxSpeed * dt);
      a.vel.set((dx * k) / Math.max(dt, 1e-4), 0, (dz * k) / Math.max(dt, 1e-4));
      a.pos.x += dx * k;
      a.pos.z += dz * k;
      a.speed = a.vel.length();
      return;
    }
    const want = dist < 0.05 ? 0 : Math.min(maxSpeed, dist / Math.max(dt, 1e-3));
    a.speed = a.speed < want ? Math.min(want, a.speed + accel * dt) : Math.max(want, a.speed - accel * 2 * dt);
    if (dist > 1e-3) {
      a.vel.set((dx / dist) * a.speed, 0, (dz / dist) * a.speed);
      const step = Math.min(dist, a.speed * dt);
      a.pos.x += (dx / dist) * step;
      a.pos.z += (dz / dist) * step;
      if (a.speed > 0.5) a.yaw = turnToward(a.yaw, Math.atan2(dx, dz), 12 * dt);
    } else {
      a.vel.set(0, 0, 0);
    }
  }

  private integrate(a: Actor, dt: number, _k: number): void {
    a.speed = Math.max(0, a.speed - 30 * dt);
    a.pos.addScaledVector(a.vel.setLength(a.speed), dt);
  }

  // ------------------------------------------------------------ the pass

  private throwBall(ev: ThrowEvent): void {
    const ctx = this.ctx;
    this.throwEvent = ev;
    this.perfect = ev.perfect;
    this.hasBall = false;
    ctx.qb.holdingBall = false;
    ctx.qb.setState('throw');
    ctx.ball.launch(ev.from, ev.velocity);
    const flatV = Math.hypot(ev.velocity.x, ev.velocity.z);
    if (flatV > 0.1) this.chaseDir.set(ev.velocity.x / flatV, 0, ev.velocity.z / flatV);
    ctx.ball.setTrailColor(ev.perfect ? 0xffe23a : ballTrailColor);
    ctx.hud.meter(null);
    ctx.hud.setReticle(false, false);
    ctx.hud.pocket(null);
    ctx.hud.coach(null);
    ctx.thrower.visible = false;
    ctx.hud.setMainButton('THROW', false);
    if (ev.perfect) ctx.labels.float(v1.copy(ev.from).setY(ev.from.y + 1.5), 'PERFECT!', ctx.camera, '#ffe23a');
    sound.throwBall();
    this.phase = 'flight';
    this.t = 0;
    for (const r of this.receivers) if (r.tag) r.tag.el.classList.remove('open');

    // Whoever can get there goes for the ball.
    const L = ev.landing;
    const arrive = this.playClock + ev.time;
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const r of this.receivers) {
      // Aiming right at a receiver (not leading him) still works: he comes
      // back to the ball, so measure from where he is now as well.
      const p = this.predict(r, ev.time);
      const d = Math.min(Math.hypot(p.x - L.x, p.z - L.z), Math.hypot(r.pos.x - L.x, r.pos.z - L.z) * 1.15);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best && bestD < Math.max(9, best.max * ev.time * 0.75)) {
      best.goTo = new Vector3(L.x, 0, L.z);
      best.goAt = arrive;
    }
    for (const a of this.defense) {
      if (a.role === 'dl') continue;
      const reach = a.max * Math.max(0, ev.time - this.diff.reaction * 0.8);
      const d = Math.hypot(a.pos.x - L.x, a.pos.z - L.z);
      if (d < reach + 2.5 && (a.role === 'safety' ? this.diff.safety : true)) {
        // They play the receiver's back shoulder, not the spot itself.
        const away = Math.hypot(a.pos.x - L.x, a.pos.z - L.z) || 1;
        a.goTo = new Vector3(L.x + ((a.pos.x - L.x) / away) * 1.7, 0, L.z + ((a.pos.z - L.z) / away) * 1.7);
        a.goAt = arrive;
      }
    }
  }

  /** Where a receiver will be in `seconds` if he keeps running his route. */
  private predict(r: Actor, seconds: number): Vector3 {
    const p = r.pos.clone();
    let left = seconds * r.max;
    let i = r.wp;
    while (left > 0 && r.path[i]) {
      const t = r.path[i] as Vector3;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d >= left) {
        p.x += ((t.x - p.x) / d) * left;
        p.z += ((t.z - p.z) / d) * left;
        left = 0;
      } else {
        p.copy(t);
        left -= d;
        i += 1;
      }
    }
    return p;
  }

  private updateFlight(dt: number): void {
    const ctx = this.ctx;
    this.playClock += dt;
    this.updateLines(dt, Math.min(1, this.playClock / this.pocketTime));
    const ball = ctx.ball;
    const prevBall = v2.copy(ball.position);
    const wasGrounded = ball.grounded;
    ball.update(dt, ctx.camera.position);
    if (this.t < 0.15) return;
    const bp = ball.position;

    // Swept test along the ball's path this frame: a steep, fast ball can
    // drop through catch height between two frames.
    if (!wasGrounded) {
      // A receiver who can reach the ball attacks it first; a defender close
      // by makes the catch harder (resolveCatch) but only wins it outright
      // when no receiver is in reach.
      let who: Actor | null = null;
      let wd = CATCH_RADIUS;
      let def: Actor | null = null;
      let dd = CATCH_RADIUS;
      const sx = bp.x - prevBall.x;
      const sz = bp.z - prevBall.z;
      const len2 = sx * sx + sz * sz;
      for (const a of [...this.receivers, ...this.defense]) {
        if (a.role === 'dl' || !a.body.root.visible) continue;
        const k = len2 > 1e-6 ? Math.max(0, Math.min(1, ((a.pos.x - prevBall.x) * sx + (a.pos.z - prevBall.z) * sz) / len2)) : 1;
        const y = prevBall.y + (bp.y - prevBall.y) * k;
        if (y <= 0.3 || y >= 3.5) continue;
        const d = Math.hypot(a.pos.x - (prevBall.x + sx * k), a.pos.z - (prevBall.z + sz * k));
        if (a.role === 'wr' && d < wd) {
          wd = d;
          who = a;
        } else if (a.role !== 'wr' && d < dd) {
          dd = d;
          def = a;
        }
      }
      who ??= def;
      if (who) {
        this.resolveCatch(who);
        return;
      }
    }
    if (ball.grounded || Math.abs(bp.x) > FIELD_HALF_WIDTH + 2) {
      const r = this.closestReceiver(bp);
      ctx.labels.float(v1.copy(bp).setY(2), 'INCOMPLETE', ctx.camera, '#ff8a8a');
      sound.miss();
      this.endPlay('incomplete', 0, this.z0, r);
    }
  }

  private closestReceiver(p: Vector3): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const r of this.receivers) {
      const d = r.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  private resolveCatch(who: Actor): void {
    const ctx = this.ctx;
    const d = this.diff;
    const bp = ctx.ball.position.clone();
    if (who.role === 'wr') {
      let nearest = Infinity;
      for (const a of this.defense) if (a.role !== 'dl') nearest = Math.min(nearest, Math.hypot(a.pos.x - who.pos.x, a.pos.z - who.pos.z));
      const contest = nearest < 2.4 ? (1 - nearest / 2.4) * (0.25 + 0.55 * d.ballSkill) : 0;
      // The card's catch rating decides it; an uncontested ball is easier.
      const chance = Math.min(0.99, catchChance(who.rating) + 0.12 + (this.perfect ? 0.06 : 0)) - contest;
      if (Math.random() < chance) {
        this.carrier = who;
        who.goTo = null;
        this.phase = 'carry';
        this.t = 0;
        sound.catchBall();
        ctx.labels.float(v1.copy(who.pos).setY(3.6), contest > 0.12 ? 'WHAT A CATCH!' : 'CAUGHT!', ctx.camera, '#7dffb0');
        if (this.state?.plays === 0) ctx.hud.coach('Caught! Now he runs for the end zone.');
        for (const a of this.defense) {
          a.goTo = null;
          if (a.role === 'dl') a.body.setPose('run');
        }
        for (const a of this.linemen) a.body.setPose('run');
        return;
      }
      ctx.labels.float(v1.copy(who.pos).setY(3.4), 'DROPPED!', ctx.camera, '#ff8a8a');
      sound.miss();
      ctx.ball.velocity.set((Math.random() - 0.5) * 4, 4, (Math.random() - 0.5) * 4);
      this.endPlay('incomplete', 0, this.z0, who);
      return;
    }
    // A defender got there first.
    if (Math.random() < 0.12 + 0.4 * d.ballSkill) {
      ctx.labels.float(v1.copy(who.pos).setY(3.6), 'INTERCEPTED!', ctx.camera, '#ff5a5a');
      who.body.setPose('celebrate');
      ctx.ball.hold(bp, who.yaw);
      sound.tackle();
      this.endPlay('interception', 0, this.z0);
      return;
    }
    ctx.labels.float(v1.copy(who.pos).setY(3.4), 'BROKEN UP!', ctx.camera, '#ff8a8a');
    sound.miss();
    ctx.ball.velocity.set((Math.random() - 0.5) * 6, 5, -3);
    this.endPlay('incomplete', 0, this.z0);
  }

  // ------------------------------------------------------------ after the catch

  private updateCarry(dt: number): void {
    const ctx = this.ctx;
    const c = this.carrier as Actor;
    this.playClock += dt;
    // Run downfield, sliding away from the nearest defender in front.
    let threat: Actor | null = null;
    let td = Infinity;
    for (const a of this.defense) {
      if (a.down || !a.body.root.visible) continue;
      const ahead = a.pos.z - c.pos.z;
      const d = Math.hypot(a.pos.x - c.pos.x, ahead);
      if (ahead > -1.5 && d < 9 && d < td) {
        td = d;
        threat = a;
      }
    }
    let dirX = 0;
    if (threat) dirX = threat.pos.x > c.pos.x ? -0.5 : 0.5;
    if (Math.abs(c.pos.x) > FIELD_HALF_WIDTH - 5) dirX -= Math.sign(c.pos.x) * 0.6;
    // Ball carriers run a touch slower than they ran their routes.
    const speed = c.max * 0.9 * this.rbBoost * Math.min(1, 0.75 + this.t * 0.5);
    this.steer(c, v1.set(c.pos.x + dirX * 4, 0, c.pos.z + 6), speed, dt, 30);
    c.body.setPose('carry');
    ctx.ball.hold(v2.set(c.pos.x - Math.cos(c.yaw) * 0.45, 1.55, c.pos.z + Math.sin(c.yaw) * 0.45), c.yaw);
    if (c.glow) c.glow.position.set(c.pos.x, 0.1, c.pos.z);

    // Pursuit.
    for (const a of this.defense) {
      if (a.down || !a.body.root.visible) continue;
      const d = Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z);
      const lead = Math.min(1.2, d / 14);
      const target = v1.set(c.pos.x + c.vel.x * lead, 0, c.pos.z + c.vel.z * lead);
      const burst = d < 7 ? 1.18 : 1;
      this.steer(a, target, c.max * 0.9 * this.diff.pursuit * (a.role === 'dl' ? 0.8 : 1) * burst, dt, 28);
      a.body.setPose('run');
      if (d < TACKLE_RADIUS) {
        a.body.setPose('dive');
        a.down = true;
        c.body.setPose('down');
        sound.tackle();
        const yards = Math.round((c.pos.z - this.z0) / YARD);
        ctx.labels.float(v1.copy(c.pos).setY(3), yards >= 0 ? `+${yards} YARDS` : `${yards} YARDS`, ctx.camera, '#ffffff');
        this.endPlay('complete', yards, c.pos.z);
        return;
      }
    }
    // Blockers jog along.
    for (const a of this.linemen) this.steer(a, v1.set(a.pos.x, 0, c.pos.z - 4), 9, dt, 15);
    for (const r of this.receivers) if (r !== c) this.steer(r, v1.set(r.pos.x, 0, c.pos.z + 2), r.max * 0.7, dt, 15);

    if (c.pos.z >= yardToZ(100)) {
      const yards = 100 - (this.state?.yardLine ?? 0);
      this.touchdown(c, yards);
      return;
    }
    if (Math.abs(c.pos.x) > FIELD_HALF_WIDTH) {
      const yards = Math.round((c.pos.z - this.z0) / YARD);
      ctx.labels.float(v1.copy(c.pos).setY(3), `OUT OF BOUNDS +${Math.max(0, yards)}`, ctx.camera, '#ffffff');
      this.endPlay('complete', yards, c.pos.z);
    }
  }

  private touchdown(c: Actor, yards: number): void {
    const ctx = this.ctx;
    c.body.setPose('celebrate');
    for (const a of this.offense) if (a !== c) a.body.setPose('celebrate');
    ctx.qb.setState('cheer');
    sound.play('cheer', 0.9);
    ctx.hud.callout('TOUCHDOWN!', '', '#ffe23a');
    const fx = STYLE_BY_ID[ctx.profile()?.styleEquipped.tdEffect ?? 'td-confetti'];
    this.effects.touchdown(fx?.id ?? 'td-confetti', fx?.colors ?? [0xffe23a], v1.set(c.pos.x, 0, yardToZ(100) + 5 * YARD));
    this.endPlay('touchdown', yards, c.pos.z);
  }

  // ------------------------------------------------------------ dead ball

  private endPlay(outcome: PlayOutcome, yards: number, spotZ: number, _focus: Actor | null = null): void {
    this.outcome = outcome;
    this.gained = yards;
    this.deadSpotZ = spotZ;
    this.phase = 'dead';
    this.t = 0;
    const ctx = this.ctx;
    ctx.hud.meter(null);
    ctx.hud.pocket(null);
    ctx.hud.setReticle(false, false);
    ctx.thrower.visible = false;
    ctx.thrower.cancel();
    ctx.hud.setMainButton('THROW', false);
    const st = this.state as MatchState;
    if (outcome === 'sack') ctx.hud.callout('SACKED!', `-${SACK_YARDS} yards`, '#ff5a5a');
    else if (outcome === 'interception') ctx.hud.callout('INTERCEPTED!', '', '#ff5a5a');
    else if (outcome === 'incomplete') ctx.hud.callout('INCOMPLETE', '', '#ffffff');
    else if (outcome === 'complete') {
      const first = yards >= st.toGo;
      ctx.hud.callout(first ? 'FIRST DOWN!' : `${yards >= 0 ? '+' : ''}${yards} YARDS`, '', first ? '#ffe23a' : '#ffffff');
      if (first) sound.play('cheer', 0.4);
    }
  }

  private updateDead(dt: number): void {
    const ctx = this.ctx;
    ctx.ball.update(dt, ctx.camera.position);
    for (const a of [...this.offense, ...this.defense]) {
      if (a.body.pose === 'dive' || a.body.pose === 'down' || a.body.pose === 'celebrate') {
        a.speed = 0;
        continue;
      }
      a.speed = Math.max(0, a.speed - 18 * dt);
      a.pos.addScaledVector(v1.copy(a.vel).setLength(a.speed), dt);
      if (a.speed < 1) a.body.setPose('idle');
    }
    if (this.outcome === 'interception' || this.outcome === 'touchdown') {
      // Keep the celebrating going until the server ends the game.
    }
    if (this.t > 1.9 && !this.resultSent) {
      this.resultSent = true;
      void this.deadSpotZ;
      ctx.send({ outcome: this.outcome, yards: this.gained, perfect: this.perfect });
      this.phase = 'waiting';
      this.t = 0;
    }
  }

  // ------------------------------------------------------------ visuals

  private syncBodies(dt: number): void {
    for (const a of [...this.offense, ...this.defense]) {
      if (!a.body.root.visible) continue;
      a.body.speed = a.speed;
      a.body.root.position.set(a.pos.x, 0, a.pos.z);
      a.body.root.rotation.y = a.yaw;
      a.body.update(dt);
      if (a.tag) a.tag.world.set(a.pos.x, 3.5, a.pos.z);
    }
    for (const r of this.receivers) if (r.glow) r.glow.visible = r.body.root.visible && this.phase !== 'idle';
    const c = this.phase === 'carry' ? this.carrier : null;
    if (c) this.trail.update(dt, c.pos, true);
    else this.trail.update(dt, v1.set(0, -50, 0), false);
    this.effects.update(dt);
    const qb = this.ctx.qb.root.position;
    this.heatTag.world.set(qb.x, 4.4, qb.z);
    if (this.phase === 'carry' || this.phase === 'dead' || this.phase === 'waiting') this.heatTag.visible = false;
  }

  private updateQbVisual(dt: number): void {
    const qb = this.ctx.qb;
    qb.root.position.set(this.qbX, 0, this.qbZ);
    if (this.phase === 'pocket' || this.phase === 'snap') {
      // Shift-lock: the quarterback faces where you look.
      qb.root.rotation.y = turnToward(qb.root.rotation.y, this.aimYaw, 12 * dt);
    } else if (this.phase === 'call' || this.phase === 'presnap') {
      qb.speed = 0;
      qb.root.rotation.y = 0;
    } else {
      qb.speed = 0;
    }
    if (qb.state === 'throw' && this.phase !== 'pocket') {
      // Hold the follow-through briefly, then relax.
      if (this.t > 0.7 && this.phase === 'flight') qb.setState('free');
    }
    qb.grounded = true;
    qb.update(dt);
  }

  private cameraFor(mode: 'call' | 'qb' | 'carry', snap = 0): void {
    const cam = this.ctx.camera;
    const z0 = this.z0;
    if (mode === 'call') {
      camTarget.set(0, 44, z0 - 24);
      lookTarget.set(0, 0, z0 + 13);
    } else if (mode === 'qb') {
      // Over the right shoulder, looking where the player aims.
      const fx = Math.sin(this.aimYaw);
      const fz = Math.cos(this.aimYaw);
      const cp = Math.cos(this.aimPitch);
      const ex = this.qbX - fz * 1.6;
      const ez = this.qbZ + fx * 1.6;
      const ey = 3.3;
      camTarget.set(ex - fx * cp * 8.5, Math.max(0.5, ey + Math.sin(this.aimPitch) * 8.5), ez - fz * cp * 8.5);
      lookTarget.set(ex + fx * cp * 20, ey - Math.sin(this.aimPitch) * 20, ez + fz * cp * 20);
      if (this.phase === 'flight') {
        // The camera chases the ball through the air (behind it, a little above).
        const ball = this.ctx.ball;
        const vx = ball.velocity.x;
        const vz = ball.velocity.z;
        const flat = Math.hypot(vx, vz);
        if (flat > 2) this.chaseDir.set(vx / flat, 0, vz / flat);
        const b = ball.position;
        camTarget.set(b.x - this.chaseDir.x * 8, Math.max(1.4, b.y + 2.8), b.z - this.chaseDir.z * 8);
        lookTarget.set(b.x + this.chaseDir.x * 3, b.y, b.z + this.chaseDir.z * 3);
      }
    } else {
      const c = this.carrier;
      if (c) {
        camTarget.set(c.pos.x * 0.85, 8, c.pos.z - 13);
        lookTarget.set(c.pos.x * 0.9, 1, c.pos.z + 8);
      }
    }
    if (snap) {
      cam.position.copy(camTarget);
      this.lookAt.copy(lookTarget);
      cam.lookAt(this.lookAt);
    }
  }

  private updateCamera(dt: number): void {
    const mode = this.phase === 'call' ? 'call' : this.phase === 'carry' || (this.phase !== 'presnap' && this.carrier) ? 'carry' : 'qb';
    const aiming = this.phase === 'snap' || this.phase === 'pocket';
    const turn = this.ctx.input.takeTurn();
    if (aiming) {
      // Look around the field with the mouse (or a touch drag).
      this.aimYaw = Math.max(-1.25, Math.min(1.25, this.aimYaw + turn.yaw));
      // Free look: up into the sky or down at the grass.
      this.aimPitch = Math.max(-1.2, Math.min(1.2, this.aimPitch + turn.pitch));
    }
    this.cameraFor(mode);
    const cam = this.ctx.camera;
    if (aiming) {
      // The view direction is exact so the centre reticle is exactly where the ball goes.
      cam.position.lerp(camTarget, 1 - Math.exp(-14 * dt));
      this.lookAt.copy(lookTarget);
      cam.lookAt(this.lookAt);
      return;
    }
    const rate = this.phase === 'presnap' ? 3.2 : this.phase === 'flight' ? 7 : mode === 'carry' ? 5 : 6;
    const k = 1 - Math.exp(-rate * dt);
    cam.position.lerp(camTarget, k);
    this.lookAt.lerp(lookTarget, k);
    cam.lookAt(this.lookAt);
  }
}

const turnToward = (from: number, to: number, maxStep: number): number => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
};

export const CATCH_Y = CATCH_HEIGHT;
