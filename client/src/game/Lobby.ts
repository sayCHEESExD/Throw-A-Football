import {
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import {
  Anim,
  CARDS,
  FIELD_HALF_LENGTH,
  FIELD_HALF_WIDTH,
  GRAVITY,
  HOME_TEAM,
  JUMP_SPEED,
  SPRINT_SPEED,
  STYLE_BY_ID,
  WALK_SPEED,
  cardRating,
  type ArmStats,
  type MoveMessage,
  type PackId,
  type ProfileMessage,
  type ThrowMessage,
} from '@mctf/shared';
import type { Avatar } from '../actors/Avatar.js';
import { NpcBody } from '../actors/NpcBody.js';
import { Ball, ballTrailColor } from '../world/Ball.js';
import { LobbyProps } from '../world/LobbyProps.js';
import { Trail } from '../world/Trail.js';
import type { Input } from '../input/Input.js';
import type { Hud } from '../ui/Hud.js';
import type { Labels, Tag } from '../ui/Labels.js';
import type { AimTarget, Thrower, ThrowEvent } from './Thrower.js';
import { sound } from '../audio/Sound.js';

const BOUND_X = FIELD_HALF_WIDTH + 12;
const BOUND_Z = FIELD_HALF_LENGTH + 13;
const SEND_EVERY = 1 / 12;
/** Over-the-shoulder camera: how far right of the player and how high it looks from. */
const SHOULDER = 1.7;
const EYE = 2.9;

interface Ring {
  root: Group;
  base: Vector3;
  radius: number;
  sway: number;
  speed: number;
  glow: number;
}

interface FlyingBall {
  ball: Ball;
  local: boolean;
  scored: boolean;
  settled: boolean;
}

interface Follower {
  id: number;
  body: NpcBody;
  tag: Tag;
  pos: Vector3;
  yaw: number;
}

export interface BoardRow {
  name: string;
  touchdowns: number;
  stage: number;
  level: number;
  me: boolean;
  inMatch: boolean;
}

export interface LobbyContext {
  scene: Scene;
  camera: PerspectiveCamera;
  input: Input;
  hud: Hud;
  labels: Labels;
  me: Avatar;
  thrower: Thrower;
  stats(): ArmStats;
  profile(): ProfileMessage | null;
  sendMove(m: MoveMessage): void;
  sendThrow(m: ThrowMessage): void;
  sendRing(streak: number): void;
  /** Stepping onto a pack stand's pad. */
  openShop(pack: PackId): void;
  boardRows(): BoardRow[];
  touch: boolean;
}

const v1 = new Vector3();
const v2 = new Vector3();
const prev = new Vector3();
/** Beside and a little ahead of the player (x = left), clear of the over-the-shoulder camera. */
const FORMATION: ReadonlyArray<[number, number]> = [
  [3.4, 0.6],
  [6.2, -0.4],
  [-4.2, 1.4],
];

/** The shared practice field: walk around, throw through the rings. */
export class Lobby {
  readonly pos = new Vector3(0, 0, -22);
  private vy = 0;
  private grounded = true;
  private yaw = 0;
  private camYaw = 0;
  private camPitch = 0.06;
  private camDist = 9;
  private readonly rings: Ring[] = [];
  private readonly ringRoot = new Group();
  private readonly targets: AimTarget[] = [];
  private readonly balls: FlyingBall[] = [];
  private readonly followers: Follower[] = [];
  private followerKey = '';
  private readonly props: LobbyProps;
  private readonly trail: Trail;
  private streak = 0;
  private sendClock = 0;
  private boardClock = 0;
  private time = 0;
  private throwAnim = 0;
  private active = false;
  /** The ball the camera is chasing after your throw (null: over the shoulder). */
  private followBall: Ball | null = null;
  /** 0 = over the shoulder, 1 = chasing the ball. */
  private followW = 0;
  private followHold = 0;
  private readonly followDir = new Vector3(0, 0, 1);
  private readonly followPos = new Vector3();
  private readonly followLook = new Vector3();

  constructor(private readonly ctx: LobbyContext) {
    const mat = new MeshStandardMaterial({ color: 0xffc83a, emissive: 0x6a4300, roughness: 0.35, metalness: 0.4 });
    const spots: Array<[number, number, number, number, number]> = [
      // x, y, z, radius, sway speed
      [0, 5, 2, 3.2, 0],
      [-14, 6, 14, 2.8, 0.5],
      [14, 6, 14, 2.8, 0.5],
      [0, 8, 28, 2.6, 0.35],
      [-22, 7, 32, 2.4, 0.7],
      [22, 7, 32, 2.4, 0.7],
      [0, 10, 48, 2.6, 0.45],
      [-10, 4.5, -4, 2.6, 0],
    ];
    for (const [x, y, z, r, sp] of spots) {
      const root = new Group();
      const torus = new Mesh(new TorusGeometry(r, 0.38, 12, 40), mat);
      torus.castShadow = true;
      root.add(torus);
      root.position.set(x, y, z);
      this.ringRoot.add(root);
      this.rings.push({ root, base: new Vector3(x, y, z), radius: r, sway: Math.random() * 6, speed: sp, glow: 0 });
      this.targets.push({ center: root.position, radius: r - 0.3 });
    }
    ctx.scene.add(this.ringRoot);
    this.props = new LobbyProps(ctx.scene);
    this.trail = new Trail(ctx.scene);
  }

  enter(): void {
    this.active = true;
    this.ringRoot.visible = true;
    this.props.visible = true;
    this.pos.set((Math.random() - 0.5) * 14, 0, -22);
    this.yaw = 0;
    this.camYaw = 0;
    this.camPitch = 0.06;
    this.ctx.me.root.visible = true;
    this.ctx.me.root.rotation.set(0, 0, 0);
    this.ctx.me.setState('free');
    this.ctx.me.holdingBall = true;
    this.ctx.thrower.cancel();
    this.ctx.input.touchTurns = true;
    this.ctx.hud.setMainButton('THROW');
    this.setStreak(0, false);
    this.trail.clear();
    for (const f of this.followers) {
      f.pos.set(this.pos.x + (Math.random() - 0.5) * 6, 0, this.pos.z - 4);
      f.body.root.visible = true;
      f.tag.visible = true;
    }
    this.snapCamera();
  }

  leave(): void {
    this.active = false;
    this.ringRoot.visible = false;
    this.props.visible = false;
    this.ctx.thrower.cancel();
    this.ctx.hud.meter(null);
    this.ctx.hud.setReticle(false, false);
    this.trail.clear();
    for (const b of this.balls) b.ball.hide();
    for (const f of this.followers) {
      f.body.root.visible = false;
      f.tag.visible = false;
    }
  }

  /** Someone else's practice throw. */
  remoteThrow(m: ThrowMessage): void {
    if (!this.active) return;
    const fb = this.spare(false);
    fb.ball.setTrailColor(0x9ad8ff);
    fb.ball.launch(v1.set(m.ox, m.oy, m.oz), v2.set(m.vx, m.vy, m.vz));
  }

  private spare(local: boolean): FlyingBall {
    let fb = this.balls.find((b) => !b.ball.inFlight || b.ball.groundTime > 2.5);
    if (!fb) {
      if (this.balls.length < 10) {
        fb = { ball: new Ball(this.ctx.scene), local, scored: false, settled: false };
        this.balls.push(fb);
      } else {
        fb = this.balls[0] as FlyingBall;
      }
    }
    fb.local = local;
    fb.scored = false;
    fb.settled = false;
    return fb;
  }

  private setStreak(n: number, send: boolean): void {
    this.streak = n;
    this.ctx.hud.setRingStreak(n);
    if (send) this.ctx.sendRing(n);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    const { input, me, camera, thrower } = this.ctx;
    input.poll();
    this.syncFollowers();

    // Camera turn (mouse look while locked, right-drag otherwise, touch drag).
    const turn = input.takeTurn();
    this.camYaw += turn.yaw;
    // Free look: well up into the sky and down at your feet.
    this.camPitch = Math.max(-1.25, Math.min(1.25, this.camPitch + turn.pitch));
    this.camDist = Math.max(5, Math.min(18, this.camDist + turn.zoom * 1.2));

    // Move relative to the camera.
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const mx = -input.moveX;
    const my = input.moveY;
    const wx = fx * my + fz * mx;
    const wz = fz * my - fx * mx;
    const len = Math.hypot(wx, wz);
    const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * Math.min(1, len) * (thrower.charging ? 0.55 : 1);
    if (len > 0.05) {
      this.pos.x += (wx / len) * speed * dt;
      this.pos.z += (wz / len) * speed * dt;
    }
    // Shift-lock: with the mouse captured (or a throw coming) you face where you aim.
    const strafe = input.locked || thrower.charging || this.ctx.touch;
    if (strafe) this.yaw = turnToward(this.yaw, this.camYaw, 16 * dt);
    else if (len > 0.05) this.yaw = turnToward(this.yaw, Math.atan2(wx, wz), 12 * dt);
    this.pos.x = Math.max(-BOUND_X, Math.min(BOUND_X, this.pos.x));
    this.pos.z = Math.max(-BOUND_Z, Math.min(BOUND_Z, this.pos.z));
    if (input.takeJump() && this.grounded) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
      sound.play('jump', 0.6);
    }
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.grounded = true;
    }
    sound.steps(this.grounded ? speed : 0);

    // Avatar.
    me.root.position.copy(this.pos);
    me.root.rotation.y = this.yaw;
    me.speed = this.grounded ? speed : 0;
    me.grounded = this.grounded;
    me.update(dt);

    this.updateRings(dt);
    this.updateCamera(dt);

    // Aim at the centre reticle and throw.
    const stats = this.ctx.stats();
    me.handPosition(v1);
    const from = v1.clone();
    thrower.aimFromCenter(camera, from, stats, this.targets);
    thrower.update(dt, from, stats);
    this.ctx.hud.setReticle(!this.ctx.hud.panelOpen && !this.chasing, thrower.charging);
    if (thrower.charging) this.ctx.hud.meter(thrower.power, thrower.idealPower(from, stats), stats.perfectBand);
    else this.ctx.hud.meter(null);
    if (input.takePrimary() && !this.ctx.hud.panelOpen) {
      if (!thrower.charging) {
        thrower.start();
        me.setState('aim');
      } else {
        this.release(thrower.release(from, stats, stats.perfectBand));
      }
    }
    if (this.throwAnim > 0) {
      this.throwAnim -= dt;
      if (this.throwAnim <= 0) {
        me.setState('free');
        me.holdingBall = true;
      }
    }

    this.updateBalls(dt);
    this.updateFollowers(dt);
    this.trail.update(dt, this.pos, this.grounded && speed > WALK_SPEED * 0.6);

    const pack = this.props.update(dt, this.pos.x, this.pos.z);
    if (pack && !this.ctx.hud.panelOpen) this.ctx.openShop(pack);
    this.boardClock -= dt;
    if (this.boardClock <= 0) {
      this.boardClock = 2;
      this.drawBoards();
    }

    this.sendClock += dt;
    if (this.sendClock >= SEND_EVERY) {
      this.sendClock = 0;
      const anim = !this.grounded ? Anim.Jump : thrower.charging ? Anim.Aim : this.throwAnim > 0 ? Anim.Throw : speed > 1 ? Anim.Run : Anim.Idle;
      this.ctx.sendMove({ x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, anim });
    }
  }

  private release(ev: ThrowEvent): void {
    const me = this.ctx.me;
    me.setState('throw');
    me.holdingBall = false;
    this.throwAnim = 0.55;
    const fb = this.spare(true);
    fb.ball.setTrailColor(ev.perfect ? 0xffe23a : ballTrailColor);
    fb.ball.launch(ev.from, ev.velocity);
    this.followBall = fb.ball;
    this.followHold = 0;
    this.followDir.set(ev.velocity.x, 0, ev.velocity.z);
    if (this.followDir.lengthSq() < 1e-4) this.followDir.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    this.followDir.normalize();
    sound.throwBall();
    this.ctx.sendThrow({ ox: ev.from.x, oy: ev.from.y, oz: ev.from.z, vx: ev.velocity.x, vy: ev.velocity.y, vz: ev.velocity.z });
    if (ev.perfect) this.ctx.labels.float(v1.copy(ev.from).setY(ev.from.y + 1.4), 'PERFECT!', this.ctx.camera, '#ffe23a');
  }

  // ------------------------------------------------------------ style & team

  /** Re-read the equipped trail colours (called when the profile changes). */
  applyStyle(p: ProfileMessage): void {
    const trail = STYLE_BY_ID[p.styleEquipped.trail];
    this.trail.setColors(trail?.colors ?? [0xffffff]);
  }

  /** Your equipped receivers follow you around the practice field. */
  private syncFollowers(): void {
    const p = this.ctx.profile();
    if (!p) return;
    const ids = p.lineup.wr.slice(0, 3);
    const key = ids.join(',');
    if (key === this.followerKey) return;
    this.followerKey = key;
    for (const f of this.followers) {
      f.body.dispose();
      this.ctx.labels.remove(f.tag);
    }
    this.followers.length = 0;
    ids.forEach((id, i) => {
      const card = CARDS[id];
      if (!card) return;
      const body = new NpcBody(HOME_TEAM.colors, card.num, card.short.split(' ').pop() ?? card.short, id * 7 + 3);
      this.ctx.scene.add(body.root);
      const tag = this.ctx.labels.tag();
      this.ctx.labels.set(tag, `${card.short}<small>WR ${cardRating(id, p.cards[id] ?? 1)}</small>`);
      const off = FORMATION[i] as [number, number];
      const f: Follower = { id, body, tag, pos: new Vector3(this.pos.x + off[0], 0, this.pos.z + off[1]), yaw: this.yaw };
      body.root.visible = this.active;
      tag.visible = this.active;
      this.followers.push(f);
    });
  }

  private updateFollowers(dt: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.followers.forEach((f, i) => {
      const off = FORMATION[i] as [number, number];
      // Formation slot behind the player, turned with them.
      const tx = this.pos.x + off[0] * c + off[1] * s;
      const tz = this.pos.z - off[0] * s + off[1] * c;
      const dx = tx - f.pos.x;
      const dz = tz - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 30) f.pos.set(tx, 0, tz);
      const sp = d > 0.6 ? Math.min(SPRINT_SPEED * 1.05, d * 3.2) : 0;
      if (sp > 0) {
        f.pos.x += (dx / d) * sp * dt;
        f.pos.z += (dz / d) * sp * dt;
        f.yaw = turnToward(f.yaw, Math.atan2(dx, dz), 10 * dt);
      } else {
        f.yaw = turnToward(f.yaw, this.yaw, 4 * dt);
      }
      f.body.setPose(sp > 1 ? 'run' : 'idle');
      f.body.speed = sp;
      f.body.root.position.copy(f.pos);
      f.body.root.rotation.y = f.yaw;
      f.body.update(dt);
      f.tag.world.set(f.pos.x, 3.5, f.pos.z);
    });
  }

  private drawBoards(): void {
    const rows = this.ctx.boardRows();
    this.props.draw(
      0,
      [...rows].sort((a, b) => b.touchdowns - a.touchdowns).map((r) => ({ name: r.name, value: String(r.touchdowns), me: r.me })),
    );
    this.props.draw(
      1,
      [...rows].sort((a, b) => b.stage - a.stage).map((r) => ({ name: r.name, value: `Stage ${r.stage}`, me: r.me })),
    );
  }

  // ------------------------------------------------------------ rings & balls

  private updateRings(dt: number): void {
    for (const r of this.rings) {
      r.sway += dt * r.speed;
      r.root.position.set(r.base.x + Math.sin(r.sway) * 5 * Math.min(1, r.speed * 2), r.base.y + Math.sin(this.time * 1.3 + r.base.x) * 0.4, r.base.z);
      r.root.rotation.y = Math.sin(this.time * 0.5 + r.base.z) * 0.25;
      r.glow = Math.max(0, r.glow - dt * 2);
      const s = 1 + r.glow * 0.25;
      r.root.scale.setScalar(s);
    }
  }

  private updateBalls(dt: number): void {
    for (const fb of this.balls) {
      const b = fb.ball;
      if (!b.inFlight) continue;
      prev.copy(b.position);
      b.update(dt, this.ctx.camera.position);
      if (fb.local && !b.grounded) {
        for (const r of this.rings) {
          if (this.crosses(r, prev, b.position)) {
            fb.scored = true;
            r.glow = 1;
            this.setStreak(this.streak + 1, true);
            sound.ring(this.streak);
            this.ctx.labels.float(r.root.position, `x${this.streak}`, this.ctx.camera, '#ffe23a');
          }
        }
      }
      if (b.grounded && !fb.settled) {
        fb.settled = true;
        if (fb.local && !fb.scored && this.streak > 0) {
          this.setStreak(0, true);
          sound.miss();
        }
      }
      if (b.groundTime > 3) b.hide();
    }
  }

  /** Did the ball pass through the ring's opening between two frames? */
  private crosses(r: Ring, a: Vector3, b: Vector3): boolean {
    const ry = r.root.rotation.y;
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    const c = r.root.position;
    const da = (a.x - c.x) * nx + (a.z - c.z) * nz;
    const db = (b.x - c.x) * nx + (b.z - c.z) * nz;
    if (da * db > 0 || da === db) return false;
    const t = da / (da - db);
    const px = a.x + (b.x - a.x) * t - c.x;
    const py = a.y + (b.y - a.y) * t - c.y;
    const pz = a.z + (b.z - a.z) * t - c.z;
    return Math.hypot(px, py, pz) < r.radius * r.root.scale.x - 0.15;
  }

  // ------------------------------------------------------------ camera

  /** Where the over-the-shoulder camera wants to be. */
  private cameraGoal(out: Vector3, look: Vector3): void {
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    // Right of the player (screen right = -x when facing +z with this yaw convention).
    const rx = -fz;
    const rz = fx;
    look.set(this.pos.x + rx * SHOULDER, this.pos.y + EYE, this.pos.z + rz * SHOULDER);
    const cp = Math.cos(this.camPitch);
    out.set(look.x - fx * cp * this.camDist, look.y + Math.sin(this.camPitch) * this.camDist, look.z - fz * cp * this.camDist);
    if (out.y < 0.6) out.y = 0.6;
  }

  private snapCamera(): void {
    const look = new Vector3();
    this.cameraGoal(this.ctx.camera.position, look);
    this.ctx.camera.lookAt(look.addScaledVector(v2.set(Math.sin(this.camYaw), -Math.sin(this.camPitch), Math.cos(this.camYaw)), 10));
  }

  private updateCamera(dt: number): void {
    const cam = this.ctx.camera;
    const look = new Vector3();
    this.cameraGoal(v1, look);
    const dir = v2.set(Math.sin(this.camYaw) * Math.cos(this.camPitch), -Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    look.addScaledVector(dir, 20);

    // After your throw the camera chases the ball, holds a moment once it lands,
    // then eases back. Starting the next throw ends the chase at once.
    const b = this.followBall;
    if (b) {
      if (!b.inFlight || this.ctx.thrower.charging || this.ctx.hud.panelOpen) this.followBall = null;
      else if (b.grounded && (this.followHold += dt) > 0.8) this.followBall = null;
    }
    const chasing = this.followBall !== null;
    this.followW += ((chasing ? 1 : 0) - this.followW) * (1 - Math.exp(-(chasing ? 5 : 9) * dt));
    if (this.followW < 0.005) {
      this.followW = 0;
      // Position follows smoothly; the view direction is exact so the reticle never drifts.
      cam.position.lerp(v1, 1 - Math.exp(-18 * dt));
      cam.lookAt(look);
      return;
    }
    if (b && chasing) {
      if (b.velocity.x * b.velocity.x + b.velocity.z * b.velocity.z > 4) this.followDir.set(b.velocity.x, 0, b.velocity.z).normalize();
      this.followPos.copy(b.position).addScaledVector(this.followDir, -7.5);
      this.followPos.y = Math.max(1.2, b.position.y + 2.6);
      this.followLook.copy(b.position).addScaledVector(this.followDir, 3);
    }
    const w = this.followW * this.followW * (3 - 2 * this.followW);
    cam.position.lerp(v1, 1 - Math.exp(-18 * dt));
    cam.position.lerp(this.followPos, w);
    cam.lookAt(look.lerp(this.followLook, w));
  }

  /** True while the camera is (mostly) chasing a thrown ball: the reticle hides. */
  get chasing(): boolean {
    return this.followW > 0.4;
  }
}

const turnToward = (from: number, to: number, maxStep: number): number => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
};
