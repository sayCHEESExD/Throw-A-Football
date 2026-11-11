/**
 * The meta game around the field: rebirth, style items, goals, plays
 * (challenges), the free season pass, the spin wheel, the free gift, titles
 * and stage rewards. Everything is earned by playing; nothing is for sale.
 */
import type { PackId } from './cards.js';
import type { Rarity } from './cards.js';

// ---------------------------------------------------------------- rewards

export interface Reward {
  cash?: number;
  pack?: PackId;
  style?: string;
  passXp?: number;
}

export const rewardText = (r: Reward, money: (n: number) => string): string => {
  const parts: string[] = [];
  if (r.cash) parts.push(money(r.cash));
  if (r.pack) parts.push(`FREE ${PACK_NAMES[r.pack]}`);
  if (r.style) parts.push(STYLE_BY_ID[r.style]?.name ?? 'Style item');
  if (r.passXp) parts.push(`${r.passXp} Pass XP`);
  return parts.join(' + ');
};

const PACK_NAMES: Record<PackId, string> = {
  rookie: 'Rookie Pack',
  receiver: 'Rare Pack',
  lineman: 'Lineman Pack',
  backfield: 'Backfield Pack',
  defense: 'Defense Pack',
  epic: 'Epic Pack',
  legend: 'Legend Pack',
  limited: 'Limited Pack',
};

/** What beating a stage unlocks (shown before the game as "Win to unlock"). */
export const stageReward = (stage: number): Reward => {
  if (stage % 10 === 0) return { pack: 'legend' };
  if (stage % 5 === 0) return { pack: 'epic' };
  if (stage % 3 === 0) return { pack: 'lineman' };
  if (stage % 2 === 0) return { pack: 'rookie' };
  return { pack: 'receiver' };
};

// ---------------------------------------------------------------- rebirth

/** Stage you must have beaten to rebirth the n-th time (0-based count so far). */
export const rebirthStage = (rebirths: number): number => 5 * (rebirths + 1);
export const rebirthCost = (rebirths: number): number => Math.round(25_000 * Math.pow(4, rebirths));
/** Permanent money multiplier from rebirths. */
export const rebirthMultiplier = (rebirths: number): number => 1 + 0.5 * rebirths;
export const PVP_REBIRTHS = 1;

export const canRebirth = (rebirths: number, stage: number, cash: number): boolean =>
  stage > rebirthStage(rebirths) && cash >= rebirthCost(rebirths);

// ---------------------------------------------------------------- fan levels

/** "+2% money forever" per fan level above 1. */
export const fanMultiplier = (level: number): number => 1 + 0.02 * Math.max(0, level - 1);

// ---------------------------------------------------------------- style

export type StyleKind = 'trail' | 'ballTrail' | 'ballSkin' | 'tdEffect' | 'emote';

export const STYLE_KINDS: ReadonlyArray<{ id: StyleKind; label: string }> = [
  { id: 'trail', label: 'Trails' },
  { id: 'ballTrail', label: 'Ball Trails' },
  { id: 'ballSkin', label: 'Ball Skins' },
  { id: 'tdEffect', label: 'TD Effects' },
  { id: 'emote', label: 'Emotes' },
];

export type StyleSource =
  | { kind: 'start' }
  | { kind: 'cash'; price: number }
  | { kind: 'rebirth'; count: number }
  | { kind: 'index'; count: number }
  | { kind: 'pass'; tier: number }
  | { kind: 'daily'; streak: number }
  | { kind: 'stylePack' };

export interface StyleItem {
  readonly id: string;
  readonly kind: StyleKind;
  readonly name: string;
  readonly rarity: Rarity;
  readonly colors: readonly number[];
  readonly source: StyleSource;
  readonly blurb: string;
}

const S = (id: string, kind: StyleKind, name: string, rarity: Rarity, colors: number[], source: StyleSource, blurb: string): StyleItem => ({ id, kind, name, rarity, colors, source, blurb });

export const STYLE_ITEMS: readonly StyleItem[] = [
  // Player trails: a ribbon behind you while you run and carry the ball.
  S('trail-classic', 'trail', 'Classic Trail', 'common', [0xffffff], { kind: 'start' }, 'A clean white streak.'),
  S('trail-flame', 'trail', 'Flame Trail', 'rare', [0xff7a1f, 0xffd23a], { kind: 'rebirth', count: 1 }, 'Leave fire behind you. Rebirth once.'),
  S('trail-frost', 'trail', 'Frost Trail', 'rare', [0x8fe6ff, 0xffffff], { kind: 'cash', price: 15_000 }, 'Ice-cold speed.'),
  S('trail-plasma', 'trail', 'Plasma Surge Trail', 'epic', [0xb45cff, 0x3ff2ff], { kind: 'index', count: 50 }, 'Collect 50 cards.'),
  S('trail-thunder', 'trail', 'Thunderbolt Trail', 'legendary', [0xffe23a, 0x5fb8ff], { kind: 'rebirth', count: 3 }, 'Rebirth three times.'),
  S('trail-galaxy', 'trail', 'Galaxy Drift Trail', 'mythic', [0x6b5cff, 0xff4fa3, 0x3ff2ff], { kind: 'stylePack' }, 'Stars behind you while you run and carry the ball.'),
  S('trail-aurora', 'trail', 'Aurora Trail', 'legendary', [0x3ff2a0, 0x5f8bff], { kind: 'pass', tier: 20 }, 'Season Pass tier 20.'),
  S('trail-pixel', 'trail', 'Pixel Dash Trail', 'epic', [0x5fe07a, 0xffe23a], { kind: 'daily', streak: 14 }, 'A 14-day streak.'),
  S('trail-victory', 'trail', 'Victory Trail', 'mythic', [0xffc531, 0xffffff], { kind: 'index', count: 150 }, 'Collect 150 cards.'),
  // Ball trails.
  S('btrail-classic', 'ballTrail', 'Classic Ball Trail', 'common', [0xffffff], { kind: 'start' }, 'The standard spiral streak.'),
  S('btrail-fire', 'ballTrail', 'Fireball Trail', 'rare', [0xff5a1f], { kind: 'cash', price: 8_000 }, 'Your passes burn.'),
  S('btrail-neon', 'ballTrail', 'Neon Trail', 'epic', [0x3ff2ff], { kind: 'pass', tier: 8 }, 'Season Pass tier 8.'),
  S('btrail-rainbow', 'ballTrail', 'Rainbow Trail', 'legendary', [0xff4f4f, 0xffe23a, 0x5fe07a, 0x3fa8ff, 0xb45cff], { kind: 'stylePack' }, 'Every colour, every throw.'),
  S('btrail-gold', 'ballTrail', 'Golden Trail', 'legendary', [0xffc531], { kind: 'rebirth', count: 2 }, 'Rebirth twice.'),
  S('btrail-void', 'ballTrail', 'Void Trail', 'mythic', [0x6b2bff], { kind: 'index', count: 100 }, 'Collect 100 cards.'),
  // Ball skins.
  S('ball-classic', 'ballSkin', 'Classic Ball', 'common', [0x8a4a22], { kind: 'start' }, 'Leather and laces.'),
  S('ball-gold', 'ballSkin', 'DHK Gold Ball', 'legendary', [0xffc531], { kind: 'cash', price: 60_000 }, 'Solid gold. Heavy? Not at all.'),
  S('ball-diamond', 'ballSkin', 'Diamond Ball', 'epic', [0x8fe6ff], { kind: 'pass', tier: 15 }, 'Season Pass tier 15.'),
  S('ball-nebula', 'ballSkin', 'Nebula Ball', 'mythic', [0x6b2bff], { kind: 'stylePack' }, 'Your football when you throw, carry and kick.'),
  S('ball-cosmic', 'ballSkin', 'Cosmic Ball', 'epic', [0x2b1f6b], { kind: 'daily', streak: 7 }, 'A 7-day streak.'),
  S('ball-glitch', 'ballSkin', 'Glitch Ball', 'rare', [0x3ff2a0], { kind: 'cash', price: 12_000 }, 'Definitely not a bug.'),
  S('ball-hologram', 'ballSkin', 'Hologram Ball', 'legendary', [0x5fe0ff], { kind: 'index', count: 200 }, 'Collect 200 cards.'),
  S('ball-love', 'ballSkin', 'Love Ball', 'rare', [0xff4fa3], { kind: 'stylePack' }, 'Throw with heart.'),
  // Touchdown effects.
  S('td-confetti', 'tdEffect', 'Confetti', 'common', [0xffe23a, 0xff4fa3, 0x3fa8ff], { kind: 'start' }, 'Classic celebration.'),
  S('td-fireworks', 'tdEffect', 'Fireworks', 'epic', [0xff5a1f, 0xffe23a], { kind: 'cash', price: 25_000 }, 'Light up the end zone.'),
  S('td-cash', 'tdEffect', 'Money Rain', 'legendary', [0x5fe07a], { kind: 'rebirth', count: 2 }, 'Make it rain. Rebirth twice.'),
  S('td-galaxy', 'tdEffect', 'Supernova', 'mythic', [0x6b5cff, 0x3ff2ff], { kind: 'stylePack' }, 'A star is born.'),
  S('td-hearts', 'tdEffect', 'Hearts', 'rare', [0xff4fa3, 0xffffff], { kind: 'pass', tier: 4 }, 'Season Pass tier 4.'),
  // Celebrations (touchdown emotes).
  S('emote-cheer', 'emote', 'Cheer', 'common', [0xffffff], { kind: 'start' }, 'Arms up!'),
  S('emote-spike', 'emote', 'Spike', 'uncommon', [0xffffff], { kind: 'cash', price: 5_000 }, 'Slam the ball down.'),
  S('emote-flex', 'emote', 'Flex', 'rare', [0xffffff], { kind: 'pass', tier: 12 }, 'Show the crowd.'),
  S('emote-dance', 'emote', 'End Zone Dance', 'epic', [0xffffff], { kind: 'stylePack' }, 'Bust a move.'),
  S('emote-rampage', 'emote', 'Rampage', 'mythic', [0xffffff], { kind: 'rebirth', count: 4 }, 'Put it in a celebration slot.'),
];

export const STYLE_BY_ID: Record<string, StyleItem> = Object.fromEntries(STYLE_ITEMS.map((s) => [s.id, s]));
export const DEFAULT_STYLE: Record<StyleKind, string> = {
  trail: 'trail-classic',
  ballTrail: 'btrail-classic',
  ballSkin: 'ball-classic',
  tdEffect: 'td-confetti',
  emote: 'emote-cheer',
};
export const STARTER_STYLE: readonly string[] = Object.values(DEFAULT_STYLE);

/** A Style Pack: a random style item from the pack-only pool (or any you lack). */
export const STYLE_PACK_PRICE = 40_000;
export const STYLE_PACK_POOL: readonly string[] = STYLE_ITEMS.filter((s) => s.source.kind === 'stylePack').map((s) => s.id);

export const styleSourceText = (src: StyleSource, money: (n: number) => string): string => {
  switch (src.kind) {
    case 'start':
      return 'Owned from the start';
    case 'cash':
      return `Buy for ${money(src.price)}`;
    case 'rebirth':
      return `Rebirth ${src.count} time${src.count > 1 ? 's' : ''}`;
    case 'index':
      return `Collect ${src.count} cards`;
    case 'pass':
      return `Season Pass tier ${src.tier}`;
    case 'daily':
      return `Reach a ${src.streak}-day streak`;
    case 'stylePack':
      return 'Get it from a Style Pack';
  }
};

// ---------------------------------------------------------------- titles

export interface TitleDef {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly need: string;
}

export const TITLES: readonly TitleDef[] = [
  { id: 'rookie', label: 'ROOKIE', color: '#ffffff', need: 'Everyone starts here' },
  { id: 'collector', label: 'COLLECTOR', color: '#5fe07a', need: 'Collect 25 cards' },
  { id: 'reborn', label: 'REBORN', color: '#5fb8ff', need: 'Rebirth once' },
  { id: 'sharpshooter', label: 'SHARPSHOOTER', color: '#ffe23a', need: 'Throw 100 perfect passes' },
  { id: 'galactic', label: 'GALACTIC', color: '#b45cff', need: 'Own a Mythic card' },
  { id: 'hall', label: 'HALL OF FAMER', color: '#ffc531', need: 'Rebirth 5 times' },
];

// ---------------------------------------------------------------- counters

/** Lifetime counters goals, plays and titles read from. */
export interface Counters {
  wins: number;
  touchdowns: number;
  completions: number;
  perfects: number;
  yards: number;
  rings: number;
  packsOpened: number;
  upgradesBought: number;
  earned: number;
}

export const NO_COUNTERS: Counters = { wins: 0, touchdowns: 0, completions: 0, perfects: 0, yards: 0, rings: 0, packsOpened: 0, upgradesBought: 0, earned: 0 };

/** Everything a goal can measure. */
export interface GoalView {
  counters: Counters;
  stage: number;
  level: number;
  rebirths: number;
  unique: number;
  bestRingStreak: number;
  topRarity: number;
}

// ---------------------------------------------------------------- goals

export type GoalStat = 'beat' | 'upgrades' | 'perfects' | 'level' | 'packs' | 'unique' | 'ringStreak' | 'rebirths' | 'completions' | 'touchdowns' | 'yards';

export interface GoalDef {
  readonly id: string;
  readonly text: string;
  readonly stat: GoalStat;
  readonly target: number;
  readonly reward: Reward;
}

export interface GoalSet {
  readonly name: string;
  readonly goals: readonly GoalDef[];
}

const G = (id: string, text: string, stat: GoalStat, target: number, reward: Reward): GoalDef => ({ id, text, stat, target, reward });

export const GOAL_SETS: readonly GoalSet[] = [
  {
    name: 'STARTER GOALS',
    goals: [
      G('s1', 'Beat Team 1', 'beat', 1, { cash: 300 }),
      G('s2', 'Buy an upgrade', 'upgrades', 1, { cash: 200 }),
      G('s3', 'Throw 4 perfect passes', 'perfects', 4, { cash: 400 }),
      G('s4', 'Reach Fan Lv 2', 'level', 2, { pack: 'rookie' }),
      G('s5', 'Beat Team 2', 'beat', 2, { pack: 'receiver' }),
    ],
  },
  {
    name: 'ROOKIE GOALS',
    goals: [
      G('r1', 'Open 3 packs', 'packs', 3, { cash: 1500 }),
      G('r2', 'Collect 20 cards', 'unique', 20, { pack: 'lineman' }),
      G('r3', 'Ring streak of 10', 'ringStreak', 10, { cash: 2000 }),
      G('r4', 'Complete 40 passes', 'completions', 40, { pack: 'backfield' }),
      G('r5', 'Beat Team 5', 'beat', 5, { pack: 'epic' }),
    ],
  },
  {
    name: 'PRO GOALS',
    goals: [
      G('p1', 'Rebirth once', 'rebirths', 1, { pack: 'epic' }),
      G('p2', 'Throw 60 perfect passes', 'perfects', 60, { cash: 25_000 }),
      G('p3', 'Collect 60 cards', 'unique', 60, { pack: 'limited' }),
      G('p4', 'Gain 3,000 yards', 'yards', 3000, { cash: 40_000 }),
      G('p5', 'Reach Fan Lv 15', 'level', 15, { pack: 'legend' }),
    ],
  },
  {
    name: 'LEGEND GOALS',
    goals: [
      G('l1', 'Rebirth 3 times', 'rebirths', 3, { pack: 'legend' }),
      G('l2', 'Score 150 touchdowns', 'touchdowns', 150, { cash: 500_000 }),
      G('l3', 'Collect 150 cards', 'unique', 150, { pack: 'limited' }),
      G('l4', 'Open 100 packs', 'packs', 100, { pack: 'legend' }),
      G('l5', 'Beat Team 40', 'beat', 40, { pack: 'limited' }),
    ],
  },
];

export const goalProgress = (g: GoalDef, v: GoalView): number => {
  switch (g.stat) {
    case 'beat':
      return v.stage - 1;
    case 'upgrades':
      return v.counters.upgradesBought;
    case 'perfects':
      return v.counters.perfects;
    case 'level':
      return v.level;
    case 'packs':
      return v.counters.packsOpened;
    case 'unique':
      return v.unique;
    case 'ringStreak':
      return v.bestRingStreak;
    case 'rebirths':
      return v.rebirths;
    case 'completions':
      return v.counters.completions;
    case 'touchdowns':
      return v.counters.touchdowns;
    case 'yards':
      return v.counters.yards;
  }
};

// ---------------------------------------------------------------- plays (challenges)

export type PlayStat = 'touchdowns' | 'completions' | 'earned' | 'perfects' | 'yards' | 'rings' | 'wins';

export interface PlayChallengeDef {
  readonly kind: PlayStat;
  readonly text: (n: number) => string;
  /** Target for a player at `stage`. */
  readonly target: (stage: number) => number;
}

export const PLAY_CHALLENGES: readonly PlayChallengeDef[] = [
  { kind: 'touchdowns', text: (n) => `Score ${n} touchdown${n > 1 ? 's' : ''}`, target: (s) => 1 + Math.floor(s / 8) },
  { kind: 'completions', text: (n) => `Complete ${n} passes`, target: (s) => 3 + Math.floor(s / 3) },
  { kind: 'earned', text: (n) => `Earn $${n}`, target: (s) => Math.round(300 * Math.pow(1.35, s - 1) / 50) * 50 },
  { kind: 'perfects', text: (n) => `Throw ${n} perfect passes`, target: (s) => 2 + Math.floor(s / 4) },
  { kind: 'yards', text: (n) => `Gain ${n} yards`, target: (s) => 60 + 15 * s },
  { kind: 'rings', text: (n) => `Hit ${n} practice rings`, target: (s) => 5 + Math.floor(s / 2) },
  { kind: 'wins', text: (n) => `Win ${n} game${n > 1 ? 's' : ''}`, target: (s) => 1 + Math.floor(s / 10) },
];

export interface PlayChallenge {
  kind: PlayStat;
  target: number;
  progress: number;
  /** Cash reward. */
  cash: number;
}

export const PLAY_SLOTS = 3;
export const playReward = (stage: number): number => Math.round(250 * Math.pow(1.3, stage - 1));
export const playText = (p: PlayChallenge): string => (PLAY_CHALLENGES.find((c) => c.kind === p.kind) ?? PLAY_CHALLENGES[0]!).text(p.target);

// ---------------------------------------------------------------- season pass (free)

export const PASS_TIERS = 30;
export const PASS_XP_PER_TIER = 250;

export const passTier = (xp: number): number => Math.min(PASS_TIERS, Math.floor(xp / PASS_XP_PER_TIER));

export const passReward = (tier: number): Reward => {
  const style = STYLE_ITEMS.find((s) => s.source.kind === 'pass' && s.source.tier === tier);
  if (style) return { style: style.id };
  if (tier === PASS_TIERS) return { pack: 'limited' };
  if (tier % 10 === 0) return { pack: 'legend' };
  if (tier % 5 === 0) return { pack: 'epic' };
  if (tier % 3 === 0) return { pack: 'receiver' };
  return { cash: Math.round(500 * Math.pow(1.22, tier)) };
};

/** Pass XP for game events. */
export const PASS_XP = { completion: 5, touchdown: 40, win: 60, play: 50, ring: 1, daily: 80 } as const;

// ---------------------------------------------------------------- spin wheel (free)

export const SPIN_HOURS = 4;

export const SPIN_SEGMENTS: readonly Reward[] = [
  { cash: 500 },
  { pack: 'rookie' },
  { cash: 1500 },
  { passXp: 150 },
  { cash: 5000 },
  { pack: 'receiver' },
  { cash: 800 },
  { pack: 'epic' },
];
/** Relative odds of each segment. */
export const SPIN_WEIGHTS: readonly number[] = [26, 16, 18, 14, 8, 10, 26, 2];

// ---------------------------------------------------------------- daily rewards

export const dailyTrackReward = (day: number): Reward => {
  const d = ((Math.max(1, day) - 1) % 7) + 1;
  const scale = 1 + 0.25 * Math.floor((day - 1) / 7);
  const cash = [480, 720, 980, 1200, 1480, 1980, 3600][d - 1] as number;
  if (d === 7) return { cash: Math.round(cash * scale), pack: 'epic' };
  if (d === 3) return { cash: Math.round(cash * scale), pack: 'rookie' };
  if (d === 5) return { cash: Math.round(cash * scale), pack: 'receiver' };
  return { cash: Math.round(cash * scale) };
};

export const STREAK_MILESTONES: ReadonlyArray<{ day: number; reward: Reward; label: string }> = [
  { day: 14, reward: { style: 'trail-pixel' }, label: 'Uncommon' },
  { day: 30, reward: { pack: 'legend' }, label: 'Legendary' },
  { day: 60, reward: { pack: 'limited' }, label: 'Limited' },
  { day: 100, reward: { pack: 'limited', cash: 1_000_000 }, label: 'Immortal' },
];

// ---------------------------------------------------------------- free gift

export const freeGiftCash = (stage: number): number => Math.round(2560 * (1 + 0.3 * (stage - 1)));

// ---------------------------------------------------------------- heat (completion streak)

/** Label for a completion streak (null below 2). */
export const heatLabel = (streak: number): string | null => (streak < 2 ? null : streak < 5 ? `Warm x${streak}` : `Heat x${streak}`);
/** Cash multiplier from the streak: +10% per completion in a row, up to x2. */
export const heatMultiplier = (streak: number): number => Math.min(2, 1 + 0.1 * Math.max(0, streak - 1));

// ---------------------------------------------------------------- tutorial

export const TUTORIAL_STEPS = 9;
