/**
 * Upgrades, rewards and levels. Earned only by playing; nothing is for sale.
 */
export type UpgradeId = 'accuracy' | 'strength' | 'money';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly name: string;
  readonly blurb: string;
  readonly maxRank: number;
  readonly baseCost: number;
  readonly growth: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'accuracy', name: 'Accuracy', blurb: 'Tighter spirals and a wider PERFECT zone', maxRank: 100, baseCost: 110, growth: 1.13 },
  { id: 'strength', name: 'Throw Strength', blurb: 'Throw farther and faster', maxRank: 100, baseCost: 170, growth: 1.14 },
  { id: 'money', name: 'Money Boost', blurb: 'More cash for everything', maxRank: 100, baseCost: 200, growth: 1.16 },
];

export type UpgradeRanks = Record<UpgradeId, number>;

export const NO_UPGRADES: UpgradeRanks = { accuracy: 0, strength: 0, money: 0 };

export const isUpgradeId = (v: unknown): v is UpgradeId => typeof v === 'string' && UPGRADES.some((u) => u.id === v);

export const upgradeCost = (id: UpgradeId, rank: number): number => {
  const def = UPGRADES.find((u) => u.id === id) as UpgradeDef;
  return Math.round(def.baseCost * Math.pow(def.growth, rank));
};

/** Every 10 ranks is a new tier. */
export const upgradeTier = (rank: number): number => Math.floor(rank / 10) + 1;

/** Buy amounts offered: x1, x10, x25 and MAX (0). */
export const BUY_AMOUNTS: readonly number[] = [1, 10, 25, 0];

/** How many ranks `count` buys from `rank` with `cash` (0 = as many as affordable), and their cost. */
export const bulkUpgrade = (id: UpgradeId, rank: number, cash: number, count: number): { ranks: number; cost: number } => {
  const def = UPGRADES.find((u) => u.id === id) as UpgradeDef;
  let ranks = 0;
  let cost = 0;
  const want = count <= 0 ? def.maxRank : count;
  while (ranks < want && rank + ranks < def.maxRank) {
    const next = upgradeCost(id, rank + ranks);
    if (cost + next > cash) break;
    cost += next;
    ranks += 1;
  }
  return { ranks, cost };
};

/** Cost of exactly `count` ranks (for the button label), ignoring cash. */
export const upgradeCostFor = (id: UpgradeId, rank: number, count: number): number => {
  const def = UPGRADES.find((u) => u.id === id) as UpgradeDef;
  let cost = 0;
  for (let i = 0; i < count && rank + i < def.maxRank; i += 1) cost += upgradeCost(id, rank + i);
  return cost;
};

export interface ArmStats {
  /** Max throw distance, world units. */
  readonly range: number;
  /** Horizontal ball speed, units/s. */
  readonly speed: number;
  /** Max aim error, degrees. */
  readonly spread: number;
  /** Half-width of the PERFECT band on the power meter (0..1). */
  readonly perfectBand: number;
  /** Extra seconds of pocket. */
  readonly pocketBonus: number;
  /** Cash multiplier. */
  readonly money: number;
}

export const armStats = (r: UpgradeRanks, yard: number, pocketBonus = 0): ArmStats => ({
  range: (36 + 0.6 * r.strength) * yard,
  speed: 30 + 0.35 * r.strength,
  spread: 3.2 * Math.pow(0.975, r.accuracy),
  perfectBand: Math.min(0.2, 0.055 + 0.0015 * r.accuracy),
  pocketBonus,
  money: 1 + 0.1 * r.money,
});

// ---------------------------------------------------------------- rewards

export const cashPerYard = (stage: number): number => 3 * (1 + 0.15 * (stage - 1));
export const COMPLETION_BONUS = 10;
export const PERFECT_BONUS = 6;
export const touchdownBonus = (stage: number): number => 150 + 60 * (stage - 1);
export const touchdownFans = (stage: number): number => 25 + 5 * stage;
export const ringReward = (streak: number): number => 2 * Math.min(streak, 25);

/** Fans needed to reach the next level from `level`. */
export const fansForLevel = (level: number): number => Math.round(60 * Math.pow(level, 1.4));

export const levelFromFans = (fans: number): { level: number; into: number; need: number } => {
  let level = 1;
  let left = Math.max(0, Math.floor(fans));
  while (left >= fansForLevel(level) && level < 999) {
    left -= fansForLevel(level);
    level += 1;
  }
  return { level, into: left, need: fansForLevel(level) };
};

// ------------------------------------------------------------------ daily

/** Hours between claims, and the hours after which a streak is lost. */
export const DAILY_COOLDOWN_HOURS = 20;
export const DAILY_GRACE_HOURS = 48;
