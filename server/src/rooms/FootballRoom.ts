import { randomUUID } from 'node:crypto';
import { Room, ServerError, type Client } from '@colyseus/core';
import {
  CLOSE_SERVER_MOVING,
  BLOXITY_EMOTE,
  CARDS,
  COMPLETION_BONUS,
  DAILY_COOLDOWN_HOURS,
  DAILY_GRACE_HOURS,
  DRIVE_START_YARD,
  FIRST_DOWN_YARDS,
  GOAL_SETS,
  MAX_CLAIMED_SPEED,
  MAX_DOWNS,
  MAX_PLAYERS_PER_ROOM,
  Msg,
  PACKS,
  PASS_XP,
  PERFECT_BONUS,
  PVP_REBIRTHS,
  SACK_YARDS,
  SPIN_HOURS,
  SPIN_SEGMENTS,
  SPIN_WEIGHTS,
  STREAK_MILESTONES,
  STYLE_BY_ID,
  STYLE_PACK_POOL,
  STYLE_PACK_PRICE,
  TITLES,
  TUTORIAL_STEPS,
  UPGRADES,
  YARD,
  armStats,
  bestLineup,
  bulkUpgrade,
  canRebirth,
  cashPerYard,
  cleanLineup,
  dailyTrackReward,
  freeGiftCash,
  goalProgress,
  heatMultiplier,
  isBloxityEmoteId,
  isPackId,
  isUpgradeId,
  levelFromFans,
  nextPlayId,
  passReward,
  passTier,
  playText,
  rebirthCost,
  rebirthStage,
  ringReward,
  rollPack,
  sanitizeAppearance,
  sanitizeProportions,
  stageReward,
  touchdownBonus,
  touchdownFans,
  type JoinOptions,
  type MatchEndMessage,
  type MatchResultMessage,
  type MatchState,
  type MoveMessage,
  type PackOpenedMessage,
  type PlayChallenge,
  type PlayOutcome,
  type ProfileMessage,
  type PvpMessage,
  type Reward,
  type RewardMessage,
  type SpinResultMessage,
  type ThrowMessage,
  type UpgradeMessage,
} from '@mctf/shared';
import { tokenHash, verifyGameToken } from '../auth/BloxityAuth.js';
import { verifyRewardToken } from '../bloxity/adRewards.js';
import { reportTouchdown, trackPlayer, untrackPlayer } from '../bloxity/reporting.js';
import { serverConfig } from '../config/serverConfig.js';
import {
  currentGoals,
  ensurePlays,
  fanLevel,
  goalView,
  grantReward,
  moneyMultiplier,
  newPlay,
  progressPlays,
  refreshStyle,
  titleUnlocked,
  weighted,
} from '../game/meta.js';
import { hasProgress, newProfile, profileStore, upgradeProfile, type Profile } from '../persistence/store.js';
import { logger } from '../util/logger.js';
import { PlayerState, RoomState } from './state.js';

const SCOPE = 'room';
const SAVE_EVERY_MS = 20_000;
const MAX_TOKEN = 8192;
/** How long a draining room lets a match in progress finish (Legion waits 10 min). */
const DRAIN_MS = 9 * 60_000;
/** The quickest a real play can go from snap to result. */
const MIN_PLAY_MS = 1800;
const MIN_RING_MS = 450;
const MIN_THROW_MS = 280;
const MIN_ACTION_MS = 120;
/** Lobby bounds (world units), generous. */
const LOBBY_BOUND = 260;

interface Session {
  key: string;
  guestKey: string;
  accountId: string | null;
  tokenHash: string;
  profile: Profile;
  match: MatchState;
  lastPlayAt: number;
  lastRingAt: number;
  lastThrowAt: number;
  lastMoveAt: number;
  lastEmoteAt: number;
  lastActionAt: number;
  dirty: boolean;
  savedAt: number;
  /** Cash from the last game won, doubled once by a verified rewarded ad. */
  lastWin: number;
  adPending: boolean;
  /** Plays (challenges) finished during the current game. */
  playsDone: string[];
  /** PVP rival's session id while a duel is on. */
  rival: string | null;
  rivalName: string;
}

interface Resolved {
  key: string;
  guestKey: string;
  accountId: string | null;
  tokenHash: string;
  profile: Profile;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const OUTCOMES: readonly PlayOutcome[] = ['complete', 'incomplete', 'sack', 'interception', 'touchdown', 'scramble'];
const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

const idleMatch = (): MatchState => ({
  active: false,
  stage: 1,
  yardLine: DRIVE_START_YARD,
  down: 1,
  toGo: FIRST_DOWN_YARDS,
  playId: '',
  plays: 0,
  earned: 0,
  heat: 0,
  pvp: null,
});

const cleanName = (raw: unknown, fallback: string): string => {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) : '';
  return name || fallback;
};

export class FootballRoom extends Room<RoomState> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  private readonly sessions = new Map<string, Session>();
  private readonly pvpQueue: string[] = [];

  override onCreate(): void {
    this.setState(new RoomState());
    this.setPatchRate(1000 / serverConfig.tickRate);
    this.clock.setInterval(() => this.autosave(), 5000);

    this.onMessage(Msg.Move, (c, m: MoveMessage) => this.move(c, m));
    this.onMessage(Msg.Throw, (c, m: ThrowMessage) => this.practiceThrow(c, m));
    this.onMessage(Msg.Ring, (c, m: { streak?: unknown }) => this.ring(c, m));
    this.onMessage(Msg.MatchStart, (c) => this.matchStart(c));
    this.onMessage(Msg.MatchResult, (c, m: MatchResultMessage) => this.matchResult(c, m));
    this.onMessage(Msg.MatchQuit, (c) => this.matchQuit(c));
    this.onMessage(Msg.Upgrade, (c, m: Partial<UpgradeMessage>) => this.act(c, (s) => this.upgrade(c, s, m)));
    this.onMessage(Msg.Daily, (c) => this.act(c, (s) => this.daily(c, s)));
    this.onMessage(Msg.Avatar, (c, m: unknown) => this.avatar(c, m));
    this.onMessage(Msg.Emote, (c, m: { id?: unknown }) => this.emote(c, m));
    this.onMessage(Msg.AdReward, (c, m: { token?: unknown }) => void this.adReward(c, m));
    this.onMessage(Msg.SetAuth, (c, m: { token?: unknown }) => void this.setAuth(c, m));
    this.onMessage(Msg.OpenPack, (c, m: { pack?: unknown }) => this.act(c, (s) => this.openPack(c, s, m?.pack, false)));
    this.onMessage(Msg.BuyPack, (c, m: { pack?: unknown }) => this.act(c, (s) => this.openPack(c, s, m?.pack, true)));
    this.onMessage(Msg.Equip, (c, m: { lineup?: unknown }) => this.act(c, (s) => (s.profile.lineup = cleanLineup(m?.lineup, s.profile.cards))));
    this.onMessage(Msg.EquipBest, (c) => this.act(c, (s) => (s.profile.lineup = bestLineup(s.profile.cards))));
    this.onMessage(Msg.Rebirth, (c) => this.act(c, (s) => this.rebirth(c, s)));
    this.onMessage(Msg.StyleEquip, (c, m: { id?: unknown }) => this.act(c, (s) => this.styleEquip(s, m?.id)));
    this.onMessage(Msg.StyleBuy, (c, m: { id?: unknown }) => this.act(c, (s) => this.styleBuy(c, s, m?.id)));
    this.onMessage(Msg.StylePack, (c) => this.act(c, (s) => this.stylePack(c, s)));
    this.onMessage(Msg.ClaimGoal, (c, m: { id?: unknown }) => this.act(c, (s) => this.claimGoal(c, s, m?.id)));
    this.onMessage(Msg.ClaimPlay, (c, m: { index?: unknown }) => this.act(c, (s) => this.claimPlay(c, s, m?.index)));
    this.onMessage(Msg.ClaimPass, (c, m: { tier?: unknown }) => this.act(c, (s) => this.claimPass(c, s, m?.tier)));
    this.onMessage(Msg.ClaimStreak, (c, m: { day?: unknown }) => this.act(c, (s) => this.claimStreak(c, s, m?.day)));
    this.onMessage(Msg.Spin, (c) => this.act(c, (s) => this.spin(c, s)));
    this.onMessage(Msg.FreeGift, (c) => this.act(c, (s) => this.freeGift(c, s)));
    this.onMessage(Msg.Tutorial, (c, m: { step?: unknown }) =>
      this.act(c, (s) => (s.profile.tutorial = Math.max(s.profile.tutorial, clamp(Math.floor(num(m?.step)), 0, TUTORIAL_STEPS)))),
    );
    this.onMessage(Msg.Title, (c, m: { id?: unknown }) => this.act(c, (s) => this.setTitle(c, s, m?.id)));
    this.onMessage(Msg.PvpQueue, (c) => this.pvpJoin(c));
    this.onMessage(Msg.PvpLeave, (c) => this.pvpLeave(c.sessionId, true));
    this.onMessage('dev', (c, m: Record<string, unknown>) => this.dev(c, m));
  }

  /** Run a meta action (rate limited), then save and resend the profile. */
  private act(client: Client, fn: (s: Session) => unknown): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    const now = Date.now();
    if (now - s.lastActionAt < MIN_ACTION_MS) return;
    s.lastActionAt = now;
    fn(s);
    s.dirty = true;
    this.syncPublic(client.sessionId);
    this.sendProfile(client);
  }

  // ------------------------------------------------------------- joining

  override async onAuth(_client: Client, options: JoinOptions = {}): Promise<Resolved> {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) throw new ServerError(4001, 'room is full');
    const guestId = typeof options.playerId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(options.playerId) ? options.playerId : '';
    const token = typeof options.token === 'string' && options.token.length < MAX_TOKEN ? options.token : null;
    return this.resolve(guestId ? `g:${guestId}` : `g:anon-${randomUUID()}`, token, cleanName(options.name, 'Guest'));
  }

  private async resolve(guestKey: string, token: string | null, name: string): Promise<Resolved> {
    let accountId: string | null = null;
    let carried: readonly string[] = [];
    if (token) {
      const outcome = await verifyGameToken(token);
      if (outcome.status === 'verified') {
        accountId = outcome.accountId;
        carried = outcome.carriedFrom;
      }
    }
    // A reload rejoins before the old connection has saved: share its live profile.
    const live = (key: string): Profile | null => [...this.sessions.values()].find((s) => s.key === key)?.profile ?? null;
    if (accountId) {
      const key = `a:${accountId}`;
      const current = live(key);
      if (current) return { key, guestKey, accountId, tokenHash: token ? tokenHash(token) : '', profile: current };
      let profile = await profileStore.load(key);
      if (!profile) {
        // An account with no progress yet takes over this browser's guest save (once).
        for (const from of [guestKey, ...carried.map((id) => `a:${id}`)]) {
          const guest = await profileStore.load(from);
          if (guest && !guest.migratedTo && hasProgress(upgradeProfile(guest))) {
            profile = { ...guest, migratedTo: undefined };
            guest.migratedTo = key;
            await profileStore.save(from, guest);
            logger.info(SCOPE, `carried ${from} into ${key}`);
            break;
          }
        }
      }
      return { key, guestKey, accountId, tokenHash: token ? tokenHash(token) : '', profile: upgradeProfile(profile ?? newProfile(name)) };
    }
    const current = live(guestKey);
    if (current) return { key: guestKey, guestKey, accountId: null, tokenHash: '', profile: current };
    const profile = await profileStore.load(guestKey);
    return {
      key: guestKey,
      guestKey,
      accountId: null,
      tokenHash: '',
      profile: upgradeProfile(profile && !profile.migratedTo ? profile : newProfile(name)),
    };
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: Resolved): void {
    const resolved = auth ?? { key: `g:anon-${randomUUID()}`, guestKey: '', accountId: null, tokenHash: '', profile: newProfile('Guest') };
    const player = new PlayerState();
    player.name = cleanName(options.name, resolved.profile.name);
    resolved.profile.name = player.name;
    player.uid = resolved.accountId ?? '';
    player.look = this.lookJson(options);
    // Spawn spread around the lobby's practice line.
    player.x = (Math.random() - 0.5) * 20;
    player.z = -22 + Math.random() * 6;
    this.state.players.set(client.sessionId, player);
    ensurePlays(resolved.profile);
    this.sessions.set(client.sessionId, {
      key: resolved.key,
      guestKey: resolved.guestKey,
      accountId: resolved.accountId,
      tokenHash: resolved.tokenHash,
      profile: resolved.profile,
      match: idleMatch(),
      lastPlayAt: 0,
      lastRingAt: 0,
      lastThrowAt: 0,
      lastMoveAt: Date.now(),
      lastEmoteAt: 0,
      lastActionAt: 0,
      dirty: false,
      savedAt: Date.now(),
      lastWin: 0,
      adPending: false,
      playsDone: [],
      rival: null,
      rivalName: '',
    });
    if (resolved.accountId) trackPlayer(resolved.accountId, resolved.profile);
    this.syncPublic(client.sessionId);
    this.sendProfile(client);
    logger.info(SCOPE, `join ${client.sessionId} as ${resolved.key}`);
  }

  override async onLeave(client: Client): Promise<void> {
    const s = this.sessions.get(client.sessionId);
    this.pvpLeave(client.sessionId, false);
    if (s?.rival) this.rivalGone(client.sessionId, s);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (s?.accountId) untrackPlayer(s.accountId, s.profile);
    if (s) await profileStore.save(s.key, s.profile);
    logger.info(SCOPE, `leave ${client.sessionId}`);
  }

  /**
   * DRAIN on SIGTERM (a deploy or scale-down; Legion waits up to 10 minutes).
   * The room is already locked, so nobody new is seated here. Players in the
   * lobby are let go at once and players in a match as soon as it ends, with
   * CLOSE_SERVER_MOVING so their client resolves the matchmaker again and lands
   * on the fresh pod. Their saves happen in onLeave as usual.
   */
  override onBeforeShutdown(): void {
    const deadline = Date.now() + DRAIN_MS;
    logger.info(SCOPE, `draining ${this.roomId}: ${this.clients.length} player(s)`);
    const release = (): void => {
      const late = Date.now() >= deadline;
      for (const client of [...this.clients]) {
        if (late || !this.sessions.get(client.sessionId)?.match.active) client.leave(CLOSE_SERVER_MOVING);
      }
    };
    if (this.clients.length === 0) {
      void this.disconnect(CLOSE_SERVER_MOVING);
      return;
    }
    release();
    this.clock.setInterval(release, 1000);
  }

  override async onDispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => profileStore.save(s.key, s.profile)));
  }

  private lookJson(m: unknown): string {
    const raw = (m ?? {}) as { appearance?: unknown; proportions?: unknown };
    try {
      return JSON.stringify({ appearance: sanitizeAppearance(raw.appearance), proportions: sanitizeProportions(raw.proportions) });
    } catch {
      return '';
    }
  }

  private async setAuth(client: Client, m: { token?: unknown }): Promise<void> {
    const s = this.sessions.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    const token = typeof m?.token === 'string' && m.token.length < MAX_TOKEN ? m.token : null;
    if (!token || tokenHash(token) === s.tokenHash) return;
    const outcome = await verifyGameToken(token);
    if (outcome.status !== 'verified' || `a:${outcome.accountId}` === s.key) return;
    const key = `a:${outcome.accountId}`;
    await profileStore.save(s.key, s.profile);
    let profile = await profileStore.load(key);
    if (!profile) {
      // First sign-in: this guest's progress becomes the account's.
      profile = s.profile;
      await profileStore.save(s.key, { ...s.profile, migratedTo: key });
    }
    s.key = key;
    s.accountId = outcome.accountId;
    s.tokenHash = tokenHash(token);
    s.profile = upgradeProfile(profile);
    ensurePlays(s.profile);
    p.uid = outcome.accountId;
    trackPlayer(outcome.accountId, s.profile);
    await profileStore.save(key, s.profile);
    this.syncPublic(client.sessionId);
    this.sendProfile(client);
    logger.info(SCOPE, `${client.sessionId} signed in as ${key}`);
  }

  // ------------------------------------------------------------- lobby

  private move(client: Client, m: MoveMessage): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || !m) return;
    const x = num(m.x, NaN);
    const y = num(m.y, NaN);
    const z = num(m.z, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const now = Date.now();
    const dt = Math.max(0.05, (now - s.lastMoveAt) / 1000);
    s.lastMoveAt = now;
    // A claim faster than anyone can run is clamped toward it, not taken.
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    const allowed = MAX_CLAIMED_SPEED * dt + 2;
    const k = !p.inMatch && dist > allowed ? allowed / dist : 1;
    p.x = clamp(p.x + dx * k, -LOBBY_BOUND, LOBBY_BOUND);
    p.z = clamp(p.z + dz * k, -LOBBY_BOUND, LOBBY_BOUND);
    p.y = clamp(y, -5, 60);
    p.yaw = num(m.yaw);
    p.anim = clamp(Math.floor(num(m.anim)), 0, 15);
    if (p.emote && Math.hypot(dx, dz) / dt > BLOXITY_EMOTE.stopSpeed * 2) p.emote = '';
  }

  private practiceThrow(client: Client, m: ThrowMessage): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || !m || p.inMatch) return;
    const now = Date.now();
    if (now - s.lastThrowAt < MIN_THROW_MS) return;
    s.lastThrowAt = now;
    const v = [num(m.vx), num(m.vy), num(m.vz)];
    const speed = Math.hypot(v[0]!, v[1]!, v[2]!);
    if (speed > 120) return;
    const out = { id: client.sessionId, ox: p.x, oy: num(m.oy, p.y + 2), oz: p.z, vx: v[0]!, vy: v[1]!, vz: v[2]! };
    this.broadcast(Msg.Thrown, out, { except: client });
  }

  private ring(client: Client, m: { streak?: unknown }): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || p.inMatch) return;
    const claimed = Math.floor(num(m?.streak));
    if (claimed <= 0) {
      p.ringStreak = 0;
      return;
    }
    const now = Date.now();
    if (now - s.lastRingAt < MIN_RING_MS) return;
    s.lastRingAt = now;
    const streak = Math.min(claimed, p.ringStreak + 1);
    p.ringStreak = streak;
    if (streak > s.profile.bestRingStreak) s.profile.bestRingStreak = streak;
    s.profile.counters.rings += 1;
    s.profile.passXp += PASS_XP.ring;
    this.playProgress(client, s, 'rings', 1);
    const cash = Math.round(ringReward(streak) * moneyMultiplier(s.profile));
    this.pay(client, s, cash, `Ring streak x${streak}`);
  }

  // ------------------------------------------------------------- games

  private matchStart(client: Client, pvpStage = 0): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s) return;
    if (!pvpStage) this.pvpLeave(client.sessionId, false);
    if (!s.match.active || pvpStage) {
      s.lastWin = 0;
      s.playsDone = [];
      s.match = { ...idleMatch(), active: true, stage: pvpStage || s.profile.stage, playId: nextPlayId('') };
    }
    s.lastPlayAt = Date.now();
    p.inMatch = true;
    p.emote = '';
    this.sendMatch(client, s);
  }

  /** Send the player's game state (with the PVP rival's latest progress). */
  private sendMatch(client: Client, s: Session): void {
    if (s.rival) {
      const r = this.sessions.get(s.rival);
      s.match.pvp = { opponent: s.rivalName, theirYard: r?.match.yardLine ?? DRIVE_START_YARD, theirPlays: r?.match.plays ?? 0 };
    } else {
      s.match.pvp = null;
    }
    client.send(Msg.Match, s.match);
  }

  private matchResult(client: Client, m: MatchResultMessage): void {
    const s = this.sessions.get(client.sessionId);
    if (!s || !s.match.active || !m) return;
    const now = Date.now();
    if (now - s.lastPlayAt < MIN_PLAY_MS) {
      // Too quick to be a real play: resend the state so the client resyncs.
      this.sendMatch(client, s);
      return;
    }
    s.lastPlayAt = now;
    const outcome: PlayOutcome = OUTCOMES.includes(m.outcome) ? m.outcome : 'incomplete';
    const match = s.match;
    const pr = s.profile;
    const stats = armStats(pr.upgrades, YARD);
    const toGoal = 100 - match.yardLine;
    // The longest gain a single play can honestly produce from this spot.
    const maxGain = Math.min(toGoal, stats.range / YARD + 75);
    let yards = Math.round(clamp(num(m.yards), -20, maxGain));

    if (outcome === 'interception') {
      match.plays += 1;
      match.heat = 0;
      this.endMatch(client, s, false, 'interception');
      return;
    }
    if (outcome === 'incomplete') yards = 0;
    if (outcome === 'sack') yards = -SACK_YARDS;
    if (outcome === 'touchdown' && yards < toGoal) yards = Math.min(yards, toGoal - 1);
    yards = Math.max(yards, 1 - match.yardLine);

    match.plays += 1;
    let cash = 0;
    const caught = outcome === 'complete' || outcome === 'touchdown';
    match.heat = caught ? match.heat + 1 : outcome === 'scramble' && yards > 0 ? match.heat : 0;
    if (caught || outcome === 'scramble') {
      if (yards > 0) cash += yards * cashPerYard(match.stage);
      if (caught) {
        cash += COMPLETION_BONUS;
        pr.completions += 1;
        pr.counters.completions += 1;
        pr.passXp += PASS_XP.completion;
        this.playProgress(client, s, 'completions', 1);
      }
      if (m.perfect === true && caught) {
        cash += PERFECT_BONUS;
        pr.counters.perfects += 1;
        this.playProgress(client, s, 'perfects', 1);
      }
      if (yards > 0) {
        pr.counters.yards += yards;
        this.playProgress(client, s, 'yards', yards);
      }
    }
    cash = Math.round(cash * moneyMultiplier(pr) * heatMultiplier(match.heat));
    match.earned += cash;
    if (cash > 0) this.pay(client, s, cash, yards > 0 ? `+${yards} yards` : 'Catch', true);

    const spot = match.yardLine + yards;
    if (spot >= 100) {
      this.endMatch(client, s, true, 'touchdown');
      return;
    }
    match.yardLine = spot;
    match.toGo -= yards;
    if (match.toGo <= 0) {
      match.down = 1;
      match.toGo = Math.min(FIRST_DOWN_YARDS, 100 - spot);
    } else {
      match.down += 1;
      if (match.down > MAX_DOWNS) {
        this.endMatch(client, s, false, 'downs');
        return;
      }
    }
    match.playId = nextPlayId(match.playId);
    this.sendMatch(client, s);
  }

  private endMatch(client: Client, s: Session, won: boolean, reason: MatchEndMessage['reason']): void {
    const p = this.state.players.get(client.sessionId);
    const pr = s.profile;
    const stage = s.match.stage;
    const levelBefore = fanLevel(pr);
    let fans = 0;
    let reward: Reward | null = null;
    const rivalId = s.rival;
    if (won) {
      const bonus = Math.round(touchdownBonus(stage) * moneyMultiplier(pr));
      fans = touchdownFans(stage) * (rivalId ? 2 : 1);
      s.match.earned += bonus;
      pr.cash += bonus;
      pr.counters.earned += bonus;
      this.playProgress(client, s, 'earned', bonus);
      pr.fans += fans;
      pr.touchdowns += 1;
      pr.wins += 1;
      pr.counters.touchdowns += 1;
      pr.counters.wins += 1;
      pr.passXp += PASS_XP.win + PASS_XP.touchdown;
      this.playProgress(client, s, 'touchdowns', 1);
      this.playProgress(client, s, 'wins', 1);
      if (pr.stage === stage) {
        reward = stageReward(stage);
        grantReward(pr, reward);
        pr.stage = stage + 1;
      }
      if (s.accountId) reportTouchdown(s.accountId);
    }
    s.lastWin = won ? s.match.earned : 0;
    const end: MatchEndMessage = {
      won,
      reason,
      stage,
      earned: s.match.earned,
      fans,
      nextStage: pr.stage,
      reward,
      playsDone: [...s.playsDone],
      pvp: rivalId ? { won, opponent: s.rivalName } : null,
    };
    s.match = { ...s.match, active: false };
    s.dirty = true;
    if (p) p.anim = 0;
    this.syncPublic(client.sessionId);
    client.send(Msg.MatchEnd, end);
    this.levelCheck(client, levelBefore, pr);
    this.sendProfile(client);

    if (rivalId) {
      const r = this.sessions.get(rivalId);
      const rc = this.clients.find((c) => c.sessionId === rivalId);
      if (won && r && rc && r.match.active && r.rival === client.sessionId) {
        // First to score wins the duel: the rival's game is over.
        this.endMatch(rc, r, false, 'pvp');
      }
      // The duel is over for this player either way.
      s.rival = null;
      if (r && !r.match.active) r.rival = null;
    }
  }

  private rivalGone(id: string, s: Session): void {
    const r = s.rival ? this.sessions.get(s.rival) : undefined;
    if (r && r.rival === id) {
      r.rival = null;
      const rc = this.clients.find((c) => c.sessionId === s.rival);
      rc?.send(Msg.Toast, { text: `${this.state.players.get(id)?.name ?? 'Your rival'} left the duel. Finish the drive!` });
    }
    s.rival = null;
  }

  private matchQuit(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s) return;
    if (s.rival) this.rivalGone(client.sessionId, s);
    s.match = idleMatch();
    p.inMatch = false;
    p.x = (Math.random() - 0.5) * 16;
    p.z = -20;
  }

  // ------------------------------------------------------------- PVP

  private pvpJoin(client: Client): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    if (s.profile.rebirths < PVP_REBIRTHS) {
      client.send(Msg.Pvp, { state: 'locked', waiting: this.pvpQueue.length } satisfies PvpMessage);
      return;
    }
    if (s.match.active || this.pvpQueue.includes(client.sessionId)) return;
    const otherId = this.pvpQueue.find((id) => id !== client.sessionId && this.sessions.has(id));
    if (!otherId) {
      this.pvpQueue.push(client.sessionId);
      this.pvpBroadcast();
      return;
    }
    this.pvpLeave(otherId, false);
    const o = this.sessions.get(otherId) as Session;
    const oc = this.clients.find((c) => c.sessionId === otherId);
    if (!oc) return;
    const stage = Math.max(1, Math.min(s.profile.stage, o.profile.stage));
    s.rival = otherId;
    s.rivalName = this.state.players.get(otherId)?.name ?? 'Rival';
    o.rival = client.sessionId;
    o.rivalName = this.state.players.get(client.sessionId)?.name ?? 'Rival';
    client.send(Msg.Pvp, { state: 'matched', waiting: 0, opponent: s.rivalName } satisfies PvpMessage);
    oc.send(Msg.Pvp, { state: 'matched', waiting: 0, opponent: o.rivalName } satisfies PvpMessage);
    this.matchStart(client, stage);
    this.matchStart(oc, stage);
  }

  private pvpLeave(id: string, notify: boolean): void {
    const i = this.pvpQueue.indexOf(id);
    if (i < 0) return;
    this.pvpQueue.splice(i, 1);
    if (notify) this.clients.find((c) => c.sessionId === id)?.send(Msg.Pvp, { state: 'idle', waiting: this.pvpQueue.length } satisfies PvpMessage);
    this.pvpBroadcast();
  }

  private pvpBroadcast(): void {
    for (const id of this.pvpQueue) {
      this.clients.find((c) => c.sessionId === id)?.send(Msg.Pvp, { state: 'queued', waiting: this.pvpQueue.length } satisfies PvpMessage);
    }
  }

  // ------------------------------------------------------------- meta

  private upgrade(client: Client, s: Session, m: Partial<UpgradeMessage>): void {
    if (!isUpgradeId(m?.id)) return;
    const def = UPGRADES.find((u) => u.id === m.id)!;
    const rank = s.profile.upgrades[def.id] ?? 0;
    if (rank >= def.maxRank) return;
    const count = clamp(Math.floor(num(m.count, 1)), 0, def.maxRank);
    const { ranks, cost } = bulkUpgrade(def.id, rank, s.profile.cash, count);
    if (ranks <= 0) {
      client.send(Msg.Toast, { text: 'Not enough cash yet - go win some games!' });
      return;
    }
    s.profile.cash -= cost;
    s.profile.upgrades[def.id] = rank + ranks;
    s.profile.counters.upgradesBought += ranks;
  }

  private openPack(client: Client, s: Session, raw: unknown, buy: boolean): void {
    if (!isPackId(raw)) return;
    const pr = s.profile;
    const def = PACKS[raw];
    if (buy) {
      if (def.price <= 0) return;
      if (pr.cash < def.price) {
        client.send(Msg.Toast, { text: `You need ${money(def.price)} for the ${def.name}.` });
        return;
      }
      pr.cash -= def.price;
    } else {
      if ((pr.packs[raw] ?? 0) <= 0) return;
      pr.packs[raw] = (pr.packs[raw] ?? 1) - 1;
      if (!pr.packs[raw]) delete pr.packs[raw];
    }
    const card = rollPack(raw, Math.random);
    const isNew = !(pr.cards[card] ?? 0);
    pr.cards[card] = (pr.cards[card] ?? 0) + 1;
    pr.counters.packsOpened += 1;
    // A brand-new card that beats a starter in its slot goes straight into the lineup.
    if (isNew) {
      const best = bestLineup(pr.cards);
      const key = CARDS[card]!.pos === 'WR' ? 'wr' : CARDS[card]!.pos === 'OL' ? 'ol' : CARDS[card]!.pos === 'RB' ? 'rb' : 'def';
      if (pr.lineup[key].length < best[key].length) pr.lineup[key] = best[key];
    }
    const out: PackOpenedMessage = { pack: raw, card, copies: pr.cards[card]!, isNew };
    client.send(Msg.PackOpened, out);
  }

  private rebirth(client: Client, s: Session): void {
    const pr = s.profile;
    if (!canRebirth(pr.rebirths, pr.stage, pr.cash)) {
      client.send(Msg.Toast, { text: `Beat stage ${rebirthStage(pr.rebirths)} and save ${money(rebirthCost(pr.rebirths))} to rebirth.` });
      return;
    }
    pr.rebirths += 1;
    pr.cash = 0;
    pr.stage = 1;
    pr.upgrades = { accuracy: 0, strength: 0, money: 0 };
    pr.plays = [];
    ensurePlays(pr);
    client.send(Msg.Toast, { text: `REBIRTH ${pr.rebirths}! Money is now x${(1 + 0.5 * pr.rebirths).toFixed(1)} forever.` });
  }

  private styleEquip(s: Session, id: unknown): void {
    const item = typeof id === 'string' ? STYLE_BY_ID[id] : undefined;
    if (!item || !s.profile.styleOwned.includes(item.id)) return;
    s.profile.styleEquipped[item.kind] = item.id;
  }

  private styleBuy(client: Client, s: Session, id: unknown): void {
    const item = typeof id === 'string' ? STYLE_BY_ID[id] : undefined;
    if (!item || s.profile.styleOwned.includes(item.id) || item.source.kind !== 'cash') return;
    if (s.profile.cash < item.source.price) {
      client.send(Msg.Toast, { text: `You need ${money(item.source.price)} for ${item.name}.` });
      return;
    }
    s.profile.cash -= item.source.price;
    s.profile.styleOwned.push(item.id);
    s.profile.styleEquipped[item.kind] = item.id;
    client.send(Msg.Toast, { text: `Unlocked ${item.name}!` });
  }

  private stylePack(client: Client, s: Session): void {
    const pr = s.profile;
    if (pr.cash < STYLE_PACK_PRICE) {
      client.send(Msg.Toast, { text: `A Style Pack costs ${money(STYLE_PACK_PRICE)}.` });
      return;
    }
    const pool = STYLE_PACK_POOL.filter((id) => !pr.styleOwned.includes(id));
    if (!pool.length) {
      client.send(Msg.Toast, { text: 'You already own every Style Pack item!' });
      return;
    }
    pr.cash -= STYLE_PACK_PRICE;
    const id = pool[Math.floor(Math.random() * pool.length)]!;
    pr.styleOwned.push(id);
    client.send(Msg.Toast, { text: `Style Pack: ${STYLE_BY_ID[id]!.name}!` });
  }

  private claimGoal(client: Client, s: Session, id: unknown): void {
    const pr = s.profile;
    const set = currentGoals(pr);
    const goal = set.goals.find((g) => g.id === id);
    if (!goal || pr.goalsClaimed.includes(goal.id)) return;
    if (goalProgress(goal, goalView(pr)) < goal.target) return;
    pr.goalsClaimed.push(goal.id);
    this.reward(client, s, goal.reward, goal.text);
    if (set.goals.every((g) => pr.goalsClaimed.includes(g.id)) && pr.goalSet < GOAL_SETS.length - 1) {
      pr.goalSet += 1;
      pr.goalsClaimed = [];
      client.send(Msg.Toast, { text: `New goals: ${currentGoals(pr).name}` });
    }
  }

  private claimPlay(client: Client, s: Session, index: unknown): void {
    const pr = s.profile;
    const i = Math.floor(num(index, -1));
    const c = pr.plays[i];
    if (!c || c.progress < c.target) return;
    const cash = Math.round(c.cash * moneyMultiplier(pr));
    pr.passXp += PASS_XP.play;
    pr.plays[i] = newPlay(pr.stage, pr.plays.map((p) => p.kind));
    this.pay(client, s, cash, `Play done: ${playText(c)}`);
  }

  private claimPass(client: Client, s: Session, raw: unknown): void {
    const pr = s.profile;
    const tier = Math.floor(num(raw));
    if (tier < 1 || tier > passTier(pr.passXp) || pr.passClaimed.includes(tier)) return;
    pr.passClaimed.push(tier);
    this.reward(client, s, passReward(tier), `Season Pass tier ${tier}`);
  }

  private daily(client: Client, s: Session): void {
    const pr = s.profile;
    const now = Date.now();
    const since = now - pr.dailyLast;
    if (pr.dailyLast && since < DAILY_COOLDOWN_HOURS * 3600_000) return;
    pr.dailyStreak = pr.dailyLast && since <= DAILY_GRACE_HOURS * 3600_000 ? pr.dailyStreak + 1 : 1;
    pr.dailyLast = now;
    pr.bestDailyStreak = Math.max(pr.bestDailyStreak, pr.dailyStreak);
    pr.passXp += PASS_XP.daily;
    this.reward(client, s, dailyTrackReward(pr.dailyStreak), `Day ${pr.dailyStreak} reward`);
  }

  private claimStreak(client: Client, s: Session, raw: unknown): void {
    const pr = s.profile;
    const m = STREAK_MILESTONES.find((x) => x.day === Math.floor(num(raw)));
    if (!m || pr.dailyStreak < m.day || pr.streakClaimed.includes(m.day)) return;
    pr.streakClaimed.push(m.day);
    this.reward(client, s, m.reward, `${m.day}-day streak`);
  }

  private spin(client: Client, s: Session): void {
    const pr = s.profile;
    const now = Date.now();
    if (pr.spinAt > now) return;
    const segment = weighted(SPIN_WEIGHTS);
    const reward = SPIN_SEGMENTS[segment]!;
    pr.spinAt = now + SPIN_HOURS * 3600_000;
    grantReward(pr, reward);
    const out: SpinResultMessage = { segment, reward };
    client.send(Msg.SpinResult, out);
  }

  private freeGift(client: Client, s: Session): void {
    if (s.profile.giftClaimed) return;
    s.profile.giftClaimed = true;
    this.pay(client, s, freeGiftCash(s.profile.stage), 'Free Gift');
  }

  private setTitle(client: Client, s: Session, id: unknown): void {
    if (typeof id !== 'string' || !TITLES.some((t) => t.id === id)) return;
    if (!titleUnlocked(s.profile, id)) {
      client.send(Msg.Toast, { text: `Locked: ${TITLES.find((t) => t.id === id)!.need}` });
      return;
    }
    s.profile.title = id;
  }

  private avatar(client: Client, m: unknown): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const look = this.lookJson(m);
    if (look && look.length < 4000) p.look = look;
  }

  private emote(client: Client, m: { id?: unknown }): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || p.inMatch) return;
    const now = Date.now();
    if (now - s.lastEmoteAt < BLOXITY_EMOTE.minGapMs) return;
    s.lastEmoteAt = now;
    p.emote = isBloxityEmoteId(m?.id) ? m.id : '';
    p.emoteAt = now;
  }

  /** A rewarded ad finished: double the last win's cash, once, if Boxity says the token is real. */
  private async adReward(client: Client, m: { token?: unknown }): Promise<void> {
    const s = this.sessions.get(client.sessionId);
    if (!s || s.adPending || s.lastWin <= 0) return;
    const token = typeof m?.token === 'string' && m.token.length < MAX_TOKEN ? m.token : '';
    if (!token) return;
    const amount = s.lastWin;
    s.adPending = true;
    s.lastWin = 0;
    const valid = await verifyRewardToken(token);
    s.adPending = false;
    if (!this.sessions.has(client.sessionId)) return;
    if (!valid) {
      s.lastWin = amount;
      client.send(Msg.Toast, { text: 'The ad reward could not be confirmed.' });
      return;
    }
    this.pay(client, s, amount, 'Ad bonus: earnings doubled');
  }

  private dev(client: Client, m: Record<string, unknown>): void {
    if (!serverConfig.devCheats) return;
    const s = this.sessions.get(client.sessionId);
    if (!s || !m) return;
    const pr = s.profile;
    if (typeof m['cash'] === 'number') pr.cash += Math.max(0, m['cash']);
    if (typeof m['stage'] === 'number') pr.stage = Math.max(1, Math.floor(m['stage']));
    if (typeof m['rebirths'] === 'number') pr.rebirths = Math.max(0, Math.floor(m['rebirths']));
    if (typeof m['tutorial'] === 'number') pr.tutorial = clamp(Math.floor(m['tutorial']), 0, TUTORIAL_STEPS);
    if (typeof m['passXp'] === 'number') pr.passXp = Math.max(0, Math.floor(m['passXp']));
    if (typeof m['fans'] === 'number') pr.fans = Math.max(0, Math.floor(m['fans']));
    if (m['spin'] === true) pr.spinAt = 0;
    if (m['daily'] === true) pr.dailyLast = 0;
    const packs = m['packs'] as Record<string, unknown> | undefined;
    if (packs && typeof packs === 'object') {
      for (const [k, v] of Object.entries(packs)) if (isPackId(k) && typeof v === 'number') pr.packs[k] = Math.max(0, Math.floor(v));
    }
    this.syncPublic(client.sessionId);
    this.sendProfile(client);
  }

  // ------------------------------------------------------------- plumbing

  private reward(client: Client, s: Session, r: Reward, why: string): void {
    const levelBefore = fanLevel(s.profile);
    if (r.cash) {
      // Cash goes through pay() for the pop-up; the rest is granted silently.
      this.pay(client, s, r.cash, why);
    }
    const unlocked = grantReward(s.profile, { ...r, cash: 0 });
    if (r.pack) client.send(Msg.Toast, { text: `${why}: ${PACKS[r.pack].name} added to My Packs!` });
    for (const name of unlocked) client.send(Msg.Toast, { text: `Unlocked ${name}!` });
    this.levelCheck(client, levelBefore, s.profile);
  }

  private playProgress(client: Client, s: Session, kind: PlayChallenge['kind'], amount: number): void {
    for (const c of progressPlays(s.profile, kind, amount)) {
      const text = playText(c);
      s.playsDone.push(text);
      client.send(Msg.PlayDone, { text });
    }
  }

  private levelCheck(client: Client, before: number, pr: Profile): void {
    const after = fanLevel(pr);
    if (after > before) client.send(Msg.LevelUp, { level: after });
  }

  private pay(client: Client, s: Session, cash: number, text: string, inGame = false): void {
    if (cash <= 0) return;
    s.profile.cash += cash;
    if (inGame) {
      s.profile.counters.earned += cash;
      this.playProgress(client, s, 'earned', cash);
    }
    s.dirty = true;
    const reward: RewardMessage = { cash, text };
    client.send(Msg.Reward, reward);
    this.sendProfile(client);
  }

  private syncPublic(sessionId: string): void {
    const p = this.state.players.get(sessionId);
    const s = this.sessions.get(sessionId);
    if (!p || !s) return;
    p.stage = s.profile.stage;
    p.level = levelFromFans(s.profile.fans).level;
    p.touchdowns = s.profile.touchdowns;
    p.title = s.profile.title;
    p.rebirths = Math.min(255, s.profile.rebirths);
  }

  private sendProfile(client: Client): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    const pr = s.profile;
    for (const name of refreshStyle(pr)) client.send(Msg.Toast, { text: `Unlocked ${name}!` });
    ensurePlays(pr);
    const out: ProfileMessage = {
      cash: pr.cash,
      fans: pr.fans,
      stage: pr.stage,
      upgrades: { ...pr.upgrades },
      touchdowns: pr.touchdowns,
      completions: pr.completions,
      bestRingStreak: pr.bestRingStreak,
      dailyStreak: pr.dailyStreak,
      dailyAt: pr.dailyLast ? pr.dailyLast + DAILY_COOLDOWN_HOURS * 3600_000 : 0,
      streakClaimed: [...pr.streakClaimed],
      cards: { ...pr.cards },
      lineup: { wr: [...pr.lineup.wr], ol: [...pr.lineup.ol], rb: [...pr.lineup.rb], def: [...pr.lineup.def] },
      packs: { ...pr.packs },
      rebirths: pr.rebirths,
      wins: pr.wins,
      counters: { ...pr.counters },
      styleOwned: [...pr.styleOwned],
      styleEquipped: { ...pr.styleEquipped },
      goalSet: pr.goalSet,
      goalsClaimed: [...pr.goalsClaimed],
      plays: pr.plays.map((c) => ({ ...c })),
      passXp: pr.passXp,
      passClaimed: [...pr.passClaimed],
      spinAt: pr.spinAt,
      giftClaimed: pr.giftClaimed,
      tutorial: pr.tutorial,
      title: pr.title,
    };
    client.send(Msg.Profile, out);
  }

  private autosave(): void {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (!s.dirty || now - s.savedAt < SAVE_EVERY_MS) continue;
      s.dirty = false;
      s.savedAt = now;
      void profileStore.save(s.key, s.profile);
    }
  }
}
