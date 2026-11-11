/**
 * Server-side rules for the meta game: rewards, multipliers, plays
 * (challenges), style unlocks and titles. Pure functions over a Profile so
 * the room stays readable.
 */
import {
  CARDS,
  GOAL_SETS,
  PLAY_CHALLENGES,
  PLAY_SLOTS,
  STYLE_BY_ID,
  STYLE_ITEMS,
  YARD,
  armStats,
  cardsMultiplier,
  fanMultiplier,
  levelFromFans,
  playReward,
  rebirthMultiplier,
  uniqueCards,
  type GoalView,
  type PlayChallenge,
  type PlayStat,
  type Reward,
} from '@mctf/shared';
import type { Profile } from '../persistence/store.js';

/** Everything that multiplies game cash (heat is applied separately per play). */
export const moneyMultiplier = (p: Profile): number =>
  armStats(p.upgrades, YARD).money * cardsMultiplier(p.cards) * rebirthMultiplier(p.rebirths) * fanMultiplier(levelFromFans(p.fans).level);

export const fanLevel = (p: Profile): number => levelFromFans(p.fans).level;

/** Grant a reward; returns the names of style items newly unlocked. */
export const grantReward = (p: Profile, r: Reward): string[] => {
  const unlocked: string[] = [];
  if (r.cash) p.cash += Math.max(0, Math.round(r.cash));
  if (r.pack) p.packs[r.pack] = (p.packs[r.pack] ?? 0) + 1;
  if (r.passXp) p.passXp += Math.max(0, Math.round(r.passXp));
  if (r.style && STYLE_BY_ID[r.style] && !p.styleOwned.includes(r.style)) {
    p.styleOwned.push(r.style);
    unlocked.push(STYLE_BY_ID[r.style]!.name);
  }
  return unlocked;
};

// ---------------------------------------------------------------- plays

export const newPlay = (stage: number, avoid: readonly PlayStat[] = []): PlayChallenge => {
  const pool = PLAY_CHALLENGES.filter((c) => !avoid.includes(c.kind));
  const def = (pool.length ? pool : PLAY_CHALLENGES)[Math.floor(Math.random() * (pool.length || PLAY_CHALLENGES.length))]!;
  return { kind: def.kind, target: Math.max(1, Math.round(def.target(stage))), progress: 0, cash: playReward(stage) };
};

/** Keep PLAY_SLOTS challenges, all of different kinds. */
export const ensurePlays = (p: Profile): void => {
  while (p.plays.length < PLAY_SLOTS) p.plays.push(newPlay(p.stage, p.plays.map((c) => c.kind)));
  if (p.plays.length > PLAY_SLOTS) p.plays.length = PLAY_SLOTS;
};

/** Add progress; returns the challenges that just reached their target. */
export const progressPlays = (p: Profile, kind: PlayStat, amount: number): PlayChallenge[] => {
  if (amount <= 0) return [];
  const done: PlayChallenge[] = [];
  for (const c of p.plays) {
    if (c.kind !== kind || c.progress >= c.target) continue;
    c.progress = Math.min(c.target, c.progress + amount);
    if (c.progress >= c.target) done.push(c);
  }
  return done;
};

// ---------------------------------------------------------------- goals

export const goalView = (p: Profile): GoalView => {
  let top = 0;
  for (const id of Object.keys(p.cards)) {
    const c = CARDS[Number(id)];
    if (c && (p.cards[Number(id)] ?? 0) > 0) top = Math.max(top, ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'immortal', 'limited'].indexOf(c.rarity));
  }
  return {
    counters: p.counters,
    stage: p.stage,
    level: fanLevel(p),
    rebirths: p.rebirths,
    unique: uniqueCards(p.cards),
    bestRingStreak: p.bestRingStreak,
    topRarity: top,
  };
};

export const currentGoals = (p: Profile) => GOAL_SETS[Math.min(p.goalSet, GOAL_SETS.length - 1)]!;

// ---------------------------------------------------------------- style & titles

/** Unlock every style item whose condition is now met; returns new names. */
export const refreshStyle = (p: Profile): string[] => {
  const out: string[] = [];
  const unique = uniqueCards(p.cards);
  for (const s of STYLE_ITEMS) {
    if (p.styleOwned.includes(s.id)) continue;
    const src = s.source;
    const ok =
      (src.kind === 'rebirth' && p.rebirths >= src.count) ||
      (src.kind === 'index' && unique >= src.count) ||
      (src.kind === 'daily' && p.bestDailyStreak >= src.streak);
    if (ok) {
      p.styleOwned.push(s.id);
      out.push(s.name);
    }
  }
  return out;
};

export const titleUnlocked = (p: Profile, id: string): boolean => {
  const v = goalView(p);
  switch (id) {
    case 'rookie':
      return true;
    case 'collector':
      return v.unique >= 25;
    case 'reborn':
      return p.rebirths >= 1;
    case 'sharpshooter':
      return p.counters.perfects >= 100;
    case 'galactic':
      return v.topRarity >= 5;
    case 'hall':
      return p.rebirths >= 5;
    default:
      return false;
  }
};

/** Weighted pick of an index. */
export const weighted = (weights: readonly number[]): number => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
};
