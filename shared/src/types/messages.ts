/**
 * The wire protocol. Client -> server message names and payloads, then
 * server -> client.
 */
import type { AvatarAppearance, AvatarProportions } from './avatar.js';
import type { UpgradeId, UpgradeRanks } from '../football/progression.js';
import type { Lineup, PackId } from '../football/cards.js';
import type { Counters, PlayChallenge, Reward, StyleKind } from '../football/meta.js';

export const Msg = {
  // client -> server
  Move: 'move',
  Throw: 'throw',
  Ring: 'ring',
  MatchStart: 'match:start',
  MatchResult: 'match:result',
  MatchQuit: 'match:quit',
  Upgrade: 'upgrade',
  Daily: 'daily',
  Avatar: 'avatar',
  SetAuth: 'auth',
  Emote: 'emote',
  AdReward: 'ad:reward',
  OpenPack: 'pack:open',
  BuyPack: 'pack:buy',
  Equip: 'equip',
  EquipBest: 'equip:best',
  Rebirth: 'rebirth',
  StyleEquip: 'style:equip',
  StyleBuy: 'style:buy',
  StylePack: 'style:pack',
  ClaimGoal: 'goal:claim',
  ClaimPlay: 'play:claim',
  ClaimPass: 'pass:claim',
  ClaimStreak: 'streak:claim',
  Spin: 'spin',
  FreeGift: 'gift',
  Tutorial: 'tutorial',
  Title: 'title',
  PvpQueue: 'pvp:queue',
  PvpLeave: 'pvp:leave',
  // server -> client
  Profile: 'profile',
  Match: 'match',
  Reward: 'reward',
  Thrown: 'thrown',
  Toast: 'toast',
  MatchEnd: 'match:end',
  PackOpened: 'pack:opened',
  SpinResult: 'spin:result',
  LevelUp: 'levelup',
  PlayDone: 'play:done',
  Pvp: 'pvp',
} as const;

export interface JoinOptions {
  name?: string;
  playerId?: string;
  token?: string | null;
  appearance?: AvatarAppearance;
  proportions?: AvatarProportions;
}

/** Animation states replicated for remote avatars. */
export const Anim = {
  Idle: 0,
  Run: 1,
  Jump: 2,
  Aim: 3,
  Throw: 4,
  Cheer: 5,
} as const;

export interface MoveMessage {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
}

/** A practice throw in the lobby, replayed for everyone else. */
export interface ThrowMessage {
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface ThrownMessage extends ThrowMessage {
  id: string;
}

export type PlayOutcome = 'complete' | 'incomplete' | 'sack' | 'interception' | 'touchdown' | 'scramble';

export interface MatchResultMessage {
  outcome: PlayOutcome;
  /** Yards gained (negative for a loss). */
  yards: number;
  perfect?: boolean;
}

/** The authoritative state of the player's current game. */
export interface MatchState {
  active: boolean;
  stage: number;
  yardLine: number;
  down: number;
  toGo: number;
  playId: string;
  /** Plays run so far this game. */
  plays: number;
  /** Cash earned so far this game. */
  earned: number;
  /** Completions in a row (the Warm / Heat streak). */
  heat: number;
  /** Set in a PVP duel: the rival's name and progress. */
  pvp?: PvpProgress | null;
}

export interface PvpProgress {
  opponent: string;
  /** The rival's yard line and plays used. */
  theirYard: number;
  theirPlays: number;
}

/** Lobby PVP status for this player. */
export interface PvpMessage {
  state: 'idle' | 'queued' | 'matched' | 'locked';
  /** Players waiting in this room. */
  waiting: number;
  opponent?: string;
}

export interface MatchEndMessage {
  won: boolean;
  reason: 'touchdown' | 'downs' | 'interception' | 'quit' | 'pvp';
  stage: number;
  earned: number;
  fans: number;
  nextStage: number;
  /** What beating this stage unlocked (a pack, waiting in My Packs). */
  reward?: Reward | null;
  /** Plays (challenges) finished during this game. */
  playsDone: string[];
  pvp?: { won: boolean; opponent: string } | null;
}

export interface ProfileMessage {
  cash: number;
  fans: number;
  stage: number;
  upgrades: UpgradeRanks;
  touchdowns: number;
  completions: number;
  bestRingStreak: number;
  dailyStreak: number;
  /** Epoch ms when the daily reward can next be claimed (0 = now). */
  dailyAt: number;
  /** Streak milestones (days) already claimed. */
  streakClaimed: number[];
  /** Card id -> copies owned. */
  cards: Record<number, number>;
  lineup: Lineup;
  /** Unopened packs. */
  packs: Partial<Record<PackId, number>>;
  rebirths: number;
  wins: number;
  counters: Counters;
  styleOwned: string[];
  styleEquipped: Record<StyleKind, string>;
  /** Index of the current goal set and the goals claimed in it. */
  goalSet: number;
  goalsClaimed: string[];
  plays: PlayChallenge[];
  passXp: number;
  passClaimed: number[];
  /** Epoch ms when the next free spin is ready (0 = now). */
  spinAt: number;
  giftClaimed: boolean;
  /** Tutorial step reached (0..TUTORIAL_STEPS; TUTORIAL_STEPS = done). */
  tutorial: number;
  title: string;
}

export interface PackOpenedMessage {
  pack: PackId;
  card: number;
  copies: number;
  isNew: boolean;
}

export interface SpinResultMessage {
  segment: number;
  reward: Reward;
}

export interface RewardMessage {
  cash: number;
  text: string;
}

export interface UpgradeMessage {
  id: UpgradeId;
  /** Ranks to buy; 0 = as many as you can afford. */
  count: number;
}
