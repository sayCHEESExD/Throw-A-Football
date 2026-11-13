import { Vector3 } from 'three';
import type { Room } from 'colyseus.js';
import {
  CLOSE_SERVER_MOVING,
  AD_DOUBLE_PLACEMENT,
  Anim,
  DEFAULT_APPEARANCE,
  DEFAULT_PROPORTIONS,
  HOME_TEAM,
  Msg,
  NO_UPGRADES,
  STYLE_BY_ID,
  TITLES,
  YARD,
  armStats,
  blockSeconds,
  cardRating,
  sanitizeAppearance,
  sanitizeProportions,
  visibleName,
  type ArmStats,
  type AvatarAppearance,
  type AvatarProportions,
  type MatchEndMessage,
  type MatchState,
  type PackOpenedMessage,
  type ProfileMessage,
  type PvpMessage,
  type RewardMessage,
  type SpinResultMessage,
  type ThrownMessage,
} from '@mctf/shared';
import { Engine } from '../core/Engine.js';
import { Stadium } from '../world/Stadium.js';
import { FieldLines } from '../world/FieldLines.js';
import { Ball, setBallSkin, setBallTrail } from '../world/Ball.js';
import { Avatar } from '../actors/Avatar.js';
import { Input } from '../input/Input.js';
import { Hud, type AdOffer, type BoardRow, type Settings } from '../ui/Hud.js';
import { AdLayout } from '../ui/AdLayout.js';
import { Labels, type Tag } from '../ui/Labels.js';
import { Thrower } from './Thrower.js';
import { Lobby } from './Lobby.js';
import { Match } from './Match.js';
import { sound } from '../audio/Sound.js';
import type { Bloxity } from '../bloxity/Bloxity.js';
import type { LegionAdScreenType } from '../bloxity/legionTypes.js';
import { lookFromLegion } from '../bloxity/avatarLook.js';
import { setEmoteClock } from '../animation/BloxityEmotes.js';
import type { LegionChatMessage } from '../bloxity/legionTypes.js';
import { guestId, joinRoom } from '../net/Net.js';
import { boxityEnvironment } from '../bloxity/environment.js';
import { clientConfig } from '../config/clientConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'game';

interface PlayerView {
  name: string;
  uid: string;
  look: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  inMatch: boolean;
  stage: number;
  level: number;
  touchdowns: number;
  emote: string;
  emoteAt: number;
  title: string;
}

interface Remote {
  avatar: Avatar;
  tag: Tag;
  look: string;
  target: Vector3;
  yaw: number;
}

const parseLook = (json: string): { appearance: AvatarAppearance; proportions: AvatarProportions } => {
  try {
    const raw = JSON.parse(json) as { appearance?: unknown; proportions?: unknown };
    return { appearance: sanitizeAppearance(raw.appearance), proportions: sanitizeProportions(raw.proportions) };
  } catch {
    return { appearance: DEFAULT_APPEARANCE, proportions: DEFAULT_PROPORTIONS };
  }
};

/** Wires the world, the network, the portal and the two modes together. */
export class Game {
  private readonly engine: Engine;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly labels = new Labels();
  private readonly stadium: Stadium;
  private readonly lines: FieldLines;
  private readonly thrower: Thrower;
  private readonly matchBall: Ball;
  private readonly me: Avatar;
  private readonly myTag: Tag;
  private readonly lobby: Lobby;
  private readonly match: Match;
  private readonly bloxity: Bloxity;
  private room: Room | null = null;
  private mode: 'lobby' | 'match' = 'lobby';
  private profile: ProfileMessage | null = null;
  private stats: ArmStats = armStats(NO_UPGRADES, YARD);
  private readonly remotes = new Map<string, Remote>();
  private last = performance.now();
  private paused = false;
  private serverOffset = 0;
  private myLook = { appearance: DEFAULT_APPEARANCE, proportions: DEFAULT_PROPORTIONS };
  private readonly ads: AdLayout;
  /** Remotes already in the room when we arrived (playerInRoom) vs. joining later (playerJoined). */
  private greeted = false;
  private reconnecting = false;
  /** The matchmaker (told environment's playUrl) the current room was resolved through. */
  private joinedPlayUrl = '';

  constructor(canvas: HTMLCanvasElement, bloxity: Bloxity) {
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.bloxity = bloxity;
    bloxity.setHost({
      setMasterVolume: (v) => sound.setMaster(v),
      setMusicVolume: (v) => sound.setMusic(v),
      setGraphicsQuality: (q) => this.engine.setQuality(q),
      setShowFps: () => undefined,
      setCameraSensitivity: (s) => this.input.setSensitivity(s),
      respawn: () => {
        if (this.mode === 'lobby') this.lobby.enter();
      },
      pointerLockChanged: () => undefined,
      playEmote: (id) => {
        if (this.mode !== 'lobby') return;
        this.me.emoteId = id;
        this.me.emoteStart = Date.now() + this.serverOffset;
        this.room?.send(Msg.Emote, { id });
      },
      avatarChanged: (equipped, proportions) => {
        const look = lookFromLegion(equipped, proportions);
        this.myLook = look;
        this.me.setLook(look.appearance, look.proportions);
        this.room?.send(Msg.Avatar, look);
      },
      adBreak: (active) => {
        this.paused = active;
        sound.setPaused(active);
      },
      chatMessage: (m) => this.chatBubble(m),
    });
    this.bloxity.loadingStep('Building the stadium');
    this.ads = new AdLayout(bloxity, this.input.touch);
    setEmoteClock(() => Date.now() + this.serverOffset);

    const send = (type: string, m?: unknown): void => this.room?.send(type, m);
    this.hud = new Hud(
      {
        play: () => send(Msg.MatchStart),
        pvp: () => send(Msg.PvpQueue),
        pvpLeave: () => send(Msg.PvpLeave),
        quit: () => this.toLobby(),
        nextGame: () => {
          this.match.stop();
          send(Msg.MatchStart);
        },
        toLobby: (pack) => {
          this.toLobby();
          // "Click Practice to get a FREE pack": open the one just won.
          if (pack) send(Msg.OpenPack, { pack });
        },
        upgrade: (id, count) => send(Msg.Upgrade, { id, count }),
        claimDaily: () => send(Msg.Daily),
        claimStreak: (day) => send(Msg.ClaimStreak, { day }),
        primary: () => this.input.pressPrimary(),
        jump: () => this.input.pressJump(),
        sprint: (on) => {
          this.input.sprint = on;
        },
        openPack: (pack) => send(Msg.OpenPack, { pack }),
        buyPack: (pack) => send(Msg.BuyPack, { pack }),
        equip: (lineup) => send(Msg.Equip, { lineup }),
        equipBest: () => send(Msg.EquipBest),
        rebirth: () => send(Msg.Rebirth),
        styleEquip: (id) => send(Msg.StyleEquip, { id }),
        styleBuy: (id) => send(Msg.StyleBuy, { id }),
        stylePack: () => send(Msg.StylePack),
        claimGoal: (id) => send(Msg.ClaimGoal, { id }),
        claimPlay: (index) => send(Msg.ClaimPlay, { index }),
        claimPass: (tier) => send(Msg.ClaimPass, { tier }),
        spin: () => send(Msg.Spin),
        freeGift: () => send(Msg.FreeGift),
        title: (id) => send(Msg.Title, { id }),
        tutorial: (step) => send(Msg.Tutorial, { step }),
        replayTutorial: () => this.hud.tutorial.restart(),
        settings: (st) => this.applySettings(st),
        openBoxityBoard: bloxity.available ? () => bloxity.openLeaderboard('touchdowns') : null,
      },
      this.input.touch,
    );
    this.hud.setBoardSource(() => this.boardRows());
    this.applySettings(this.hud.settings);
    this.input.onLockChange((locked) => {
      this.hud.setLocked(locked);
      // Losing the mouse mid-throw cancels the throw: coming back never fires it.
      if (!locked && this.thrower?.charging) {
        this.thrower.cancel();
        this.hud.meter(null);
        if (this.mode === 'lobby') this.me.setState('free');
      }
    });
    this.hud.setShiftLock(this.input.shiftLock);
    this.hud.setShiftLockToggle(() => this.input.toggleShiftLock());
    this.input.onShiftLockChange((on, reason) => {
      this.hud.setShiftLock(on);
      if (reason === 'refused') this.hud.toast('Mouse lock is not available here: right-drag to look, click to throw.');
      else this.hud.toast(on ? 'Mouse lock ON' : 'Mouse lock OFF: right-drag to look');
    });

    const scene = this.engine.scene;
    this.stadium = new Stadium(scene, this.engine.isLow);
    this.stadium.setTheme(HOME_TEAM, null);
    this.lines = new FieldLines(scene);
    this.thrower = new Thrower(scene);
    this.matchBall = new Ball(scene);
    this.me = new Avatar();
    scene.add(this.me.root);
    this.myTag = this.labels.tag();
    this.myTag.visible = false;

    this.lobby = new Lobby({
      scene,
      camera: this.engine.camera,
      input: this.input,
      hud: this.hud,
      labels: this.labels,
      me: this.me,
      thrower: this.thrower,
      stats: () => this.stats,
      profile: () => this.profile,
      sendMove: (m) => this.room?.send(Msg.Move, m),
      sendThrow: (m) => this.room?.send(Msg.Throw, m),
      sendRing: (streak) => {
        this.room?.send(Msg.Ring, { streak });
        if (streak > 0) this.hud.tutorial.event('ring');
      },
      openShop: (pack) => this.hud.openShop(pack),
      boardRows: () => this.boardRows(),
      touch: this.input.touch,
    });
    this.match = new Match({
      scene,
      camera: this.engine.camera,
      input: this.input,
      hud: this.hud,
      labels: this.labels,
      qb: this.me,
      ball: this.matchBall,
      thrower: this.thrower,
      lines: this.lines,
      stadium: this.stadium,
      stats: () => this.stats,
      profile: () => this.profile,
      send: (r) => this.room?.send(Msg.MatchResult, r),
      touch: this.input.touch,
    });

    this.input.onKey((code) => {
      if (code === 'Escape') this.bloxity.showPortalMenu(false);
      if (code === 'Backspace' && this.mode === 'match') this.hud.requestQuit();
      this.hud.hotkey(code);
    });

    const equipped = this.bloxity.getEquipped();
    this.myLook = lookFromLegion(equipped, this.bloxity.getProportions());
    this.me.setLook(this.myLook.appearance, this.myLook.proportions);
  }

  private get myName(): string {
    const user = this.bloxity.getUser() ?? this.bloxity.getGuest();
    return visibleName(user?.displayName || user?.username || '');
  }

  private joinOptions(): Parameters<typeof joinRoom>[0] {
    return {
      name: this.myName,
      playerId: guestId(),
      token: this.bloxity.getToken(),
      appearance: this.myLook.appearance,
      proportions: this.myLook.proportions,
    };
  }

  async connect(): Promise<void> {
    this.bloxity.loadingStep('Finding a server');
    const room = await joinRoom(this.joinOptions(), (n) => this.bloxity.loadingStep(`Finding a server (try ${n + 1})`));
    this.bindRoom(room);

    // Signing in mid-game never reconnects (that would leave a friends' room):
    // the server re-keys this session to the account instead.
    this.bloxity.onUserChanged((user) => {
      const token = this.bloxity.getToken();
      if (user && token) this.room?.send(Msg.SetAuth, { token });
    });

    // Embedded games are told their environment in the portal handshake, which
    // can land after this first join. If it moved us to another platform's
    // matchmaker, resolve again there and rejoin.
    this.bloxity.onEnvironmentChanged(() => {
      if (!clientConfig.matchmaker || boxityEnvironment().playUrl === this.joinedPlayUrl) return;
      const old = this.room;
      this.room = null;
      void old?.leave(true);
      void this.reconnect('Switching servers...');
    });

    this.lobby.enter();
    this.hud.setMode('lobby');
    sound.music(true);
    this.bloxity.loadingEnd();
    this.bloxity.gameplayStart();
  }

  private bindRoom(room: Room): void {
    this.room = room;
    this.joinedPlayUrl = boxityEnvironment().playUrl;
    this.greeted = false;
    logger.info(SCOPE, `joined room ${room.roomId}`);
    this.bloxity.updateRoom(room.roomId);

    room.onMessage(Msg.Profile, (p: ProfileMessage) => {
      this.profile = p;
      // Linemen from your lineup buy extra pocket time.
      const block = p.lineup.ol.reduce((sum, id) => sum + blockSeconds(cardRating(id, p.cards[id] ?? 1)), 0);
      this.stats = armStats(p.upgrades, YARD, block);
      this.hud.setProfile(p);
      this.applyStyle(p);
    });
    room.onMessage(Msg.PackOpened, (m: PackOpenedMessage) => {
      sound.play('cheer', 0.5);
      this.hud.packOpened(m);
    });
    room.onMessage(Msg.SpinResult, (m: SpinResultMessage) => this.hud.spinResult(m));
    room.onMessage(Msg.LevelUp, (m: { level: number }) => {
      sound.play('cheer', 0.6);
      this.hud.levelUp(m.level);
    });
    room.onMessage(Msg.PlayDone, (m: { text: string }) => this.hud.playDone(m.text));
    room.onMessage(Msg.Pvp, (m: PvpMessage) => this.hud.setPvp(m));
    room.onMessage(Msg.Reward, (r: RewardMessage) => {
      this.hud.cashPop(r.cash, r.text);
      sound.cash();
    });
    room.onMessage(Msg.Match, (m: MatchState) => {
      if (this.mode !== 'match') this.enterMatch();
      this.hud.setScoreboard(m);
      this.match.onState(m);
    });
    room.onMessage(Msg.MatchEnd, (end: MatchEndMessage) => {
      this.match.finish();
      setTimeout(() => this.hud.results(end, end.won && this.bloxity.adsAvailable() ? this.doubleOffer() : null), end.won ? 1200 : 500);
    });
    room.onMessage(Msg.Thrown, (m: ThrownMessage) => this.lobby.remoteThrow(m));
    room.onMessage(Msg.Toast, (m: { text: string }) => this.hud.toast(m.text));
    room.onLeave((code) => {
      logger.warn(SCOPE, `left room (${code})`);
      if (this.room !== room) return;
      this.room = null;
      // 1000 / 4000 are deliberate leaves; anything else is resolved again and rejoined.
      // A draining pod (deploy) sends CLOSE_SERVER_MOVING.
      if (code === CLOSE_SERVER_MOVING) void this.reconnect('Moving you to a new server...');
      else if (code !== 1000 && code !== 4000) void this.reconnect();
    });
  }

  private async reconnect(message = 'Connection lost - reconnecting...'): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.hud.toast(message);
    if (this.mode === 'match') {
      this.match.stop();
      this.mode = 'lobby';
      this.stadium.setTheme(HOME_TEAM, null);
      this.hud.close();
      this.hud.setMode('lobby');
      this.lobby.enter();
    }
    for (const r of this.remotes.values()) {
      r.avatar.dispose();
      this.labels.remove(r.tag);
    }
    this.remotes.clear();
    try {
      this.bindRoom(await joinRoom(this.joinOptions()));
      this.hud.toast('Reconnected!');
    } catch (error) {
      logger.error(SCOPE, 'reconnect failed', error);
      this.hud.toast('Could not reconnect. Reload the page to play again.');
    } finally {
      this.reconnecting = false;
    }
  }

  /** The win screen's optional ad: the server doubles the earnings once it verifies the token. */
  private doubleOffer(): AdOffer {
    return {
      label: 'Watch an ad: 2x earnings',
      watch: async () => {
        const r = await this.ads.rewarded(() => this.bloxity.showRewarded(AD_DOUBLE_PLACEMENT));
        logger.info(SCOPE, 'rewarded ad result', r);
        if (r.status === 'completed' && r.rewardToken) {
          this.room?.send(Msg.AdReward, { token: r.rewardToken });
          return 'Thanks for watching! Your earnings are being doubled.';
        }
        switch (r.status) {
          case 'skipped':
            return 'The ad was skipped, so no bonus this time.';
          case 'no-fill':
            return 'No ad is available right now. Try again later.';
          case 'blocked':
            return 'An ad blocker stopped the ad.';
          case 'denied':
            return `Ads are not available${r.reason ? ` (${r.reason})` : ''}.`;
          case 'disabled':
            return 'Ads are turned off here.';
          default:
            return 'Something went wrong with the ad.';
        }
      },
    };
  }

  private applySettings(st: Settings): void {
    sound.setMuted(!st.sound);
    sound.setMaster(st.volume);
    sound.setMusic(st.music);
    this.input.setSensitivity(st.sensitivity);
    this.engine.setQuality(st.quality === 'low' ? 'Low' : st.quality === 'medium' ? 'Medium' : 'High');
  }

  /** The equipped ball skin, ball trail and run trail. */
  private applyStyle(p: ProfileMessage): void {
    setBallSkin(STYLE_BY_ID[p.styleEquipped.ballSkin]?.colors[0] ?? 0x8a4a22);
    setBallTrail(STYLE_BY_ID[p.styleEquipped.ballTrail]?.colors[0] ?? 0xffffff);
    this.lobby.applyStyle(p);
    this.match.applyStyle(p);
  }

  start(): void {
    const frame = (now: number): void => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (this.paused) return;
      this.tick(dt);
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ modes

  private enterMatch(): void {
    this.mode = 'match';
    this.lobby.leave();
    this.hud.setMode('match');
    this.hud.close();
    this.me.emoteId = '';
    this.me.setState('free');
    // The music keeps playing through matches.
    sound.music(true);
    sound.steps(0);
    for (const r of this.remotes.values()) {
      r.avatar.root.visible = false;
      r.tag.visible = false;
    }
  }

  private toLobby(): void {
    this.room?.send(Msg.MatchQuit);
    this.match.stop();
    this.mode = 'lobby';
    this.stadium.setTheme(HOME_TEAM, null);
    this.hud.setMode('lobby');
    this.lobby.enter();
    sound.music(true);
  }

  // ------------------------------------------------------------ frame

  /** Boxity screen ads follow what is on screen (sent only on change). */
  private adScreen(): LegionAdScreenType | null {
    const panel = this.hud.openPanel;
    if (panel === 'results') return 'results';
    if (panel && panel !== 'quit') return 'panel';
    return this.mode === 'lobby' && this.room ? 'menu' : null;
  }

  private tick(dt: number): void {
    this.ads.set(this.adScreen());
    // A menu frees the mouse; closing it lets the next click capture it again.
    this.input.setLockAllowed(!this.hud.panelOpen);
    this.hud.setLockPill(this.input.shiftLock && !this.input.locked && !this.hud.panelOpen && !!this.room);
    this.hud.frame();
    if (this.mode === 'lobby') {
      this.lobby.update(dt);
      this.match.updateEffects(dt);
    } else this.match.update(dt);
    this.syncRemotes(dt);
    this.myTag.visible = this.mode === 'lobby';
    this.myTag.world.copy(this.me.root.position).setY(this.me.root.position.y + 3.6);
    if (this.profile) this.labels.set(this.myTag, nameTag(this.myName, this.myLevel(), this.profile.title));
    this.labels.update(this.engine.camera, this.mode === 'lobby' ? 70 : 120);
    this.engine.render();
  }

  private myLevel(): number {
    const self = this.room?.state && this.players().get(this.room.sessionId);
    return self?.level ?? 1;
  }

  private players(): Map<string, PlayerView> {
    const out = new Map<string, PlayerView>();
    const state = this.room?.state as { players?: { forEach(cb: (p: PlayerView, key: string) => void): void } } | undefined;
    state?.players?.forEach((p, key) => out.set(key, p));
    return out;
  }

  private syncRemotes(dt: number): void {
    const room = this.room;
    if (!room) return;
    const seen = new Set<string>();
    for (const [id, p] of this.players()) {
      if (id === room.sessionId) continue;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        const avatar = new Avatar();
        this.engine.scene.add(avatar.root);
        avatar.root.position.set(p.x, p.y, p.z);
        r = { avatar, tag: this.labels.tag(), look: '', target: new Vector3(p.x, p.y, p.z), yaw: p.yaw };
        this.remotes.set(id, r);
        // Friend-join toasts: already here when we arrived, or joined after us.
        if (this.greeted) this.bloxity.playerJoined(p.name);
        else this.bloxity.playerInRoom(p.name);
      }
      if (p.look !== r.look) {
        r.look = p.look;
        const look = parseLook(p.look);
        r.avatar.setLook(look.appearance, look.proportions);
      }
      const show = this.mode === 'lobby' && !p.inMatch;
      r.avatar.root.visible = show;
      r.tag.visible = show;
      if (!show) continue;
      r.target.set(p.x, p.y, p.z);
      const a = r.avatar;
      const before = a.root.position.clone();
      const k = 1 - Math.exp(-12 * dt);
      a.root.position.lerp(r.target, k);
      if (a.root.position.distanceTo(r.target) > 25) a.root.position.copy(r.target);
      a.root.rotation.y = lerpAngle(a.root.rotation.y, p.yaw, k);
      const moved = before.distanceTo(a.root.position) / Math.max(dt, 1e-3);
      a.speed = p.anim === Anim.Run ? Math.max(6, Math.min(18, moved)) : 0;
      a.grounded = p.anim !== Anim.Jump;
      a.holdingBall = p.anim !== Anim.Throw;
      a.setState(p.anim === Anim.Aim ? 'aim' : p.anim === Anim.Throw ? 'throw' : 'free');
      a.emoteId = p.emote;
      a.emoteStart = p.emoteAt;
      a.update(dt);
      r.tag.world.copy(a.root.position).setY(a.root.position.y + 3.6);
      this.labels.set(r.tag, nameTag(p.name, p.level, p.title, p.stage));
    }
    this.greeted = true;
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      r.avatar.dispose();
      this.labels.remove(r.tag);
      this.remotes.delete(id);
    }
  }

  private boardRows(): BoardRow[] {
    const rows: BoardRow[] = [];
    for (const [id, p] of this.players()) {
      rows.push({ name: p.name, touchdowns: p.touchdowns, stage: p.stage, level: p.level, me: id === this.room?.sessionId, inMatch: p.inMatch });
    }
    return rows;
  }

  private chatBubble(m: LegionChatMessage): void {
    let target = m.isLocalPlayer ? this.me.root : null;
    if (!target) {
      for (const [id, p] of this.players()) {
        if (p.uid && p.uid === m.userId) target = this.remotes.get(id)?.avatar.root ?? null;
      }
    }
    if (!target || this.mode !== 'lobby') return;
    void import('three').then((three) => this.bloxity.attachChatBubble(three, target, m, 4.6));
  }
}

const lerpAngle = (a: number, b: number, k: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Name, level and title pill ("ROOKIE", "COLLECTOR", ...) over a player. */
const nameTag = (name: string, level: number, title: string, stage = 0): string => {
  const t = TITLES.find((x) => x.id === title) ?? TITLES[0]!;
  return `<span class="title-pill" style="color:${t.color}">${t.label}</span><br>${escapeHtml(name)}<small>Lv ${level}${stage ? ` · Stage ${stage}` : ''}</small>`;
};
