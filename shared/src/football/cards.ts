/**
 * Player cards, packs and the Index.
 *
 * Every card is generated from a fixed seed, so the client and the server
 * build exactly the same catalogue without sending it over the wire. A card
 * is referred to by its number (its index in CARDS). All names are invented.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'immortal' | 'limited';
export type CardPos = 'WR' | 'OL' | 'RB' | 'DEF';
export type CardSide = 'offense' | 'defense';

export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'immortal', 'limited'];

export interface RarityDef {
  readonly id: Rarity;
  readonly label: string;
  readonly color: string;
  /** Rating range for cards of this rarity. */
  readonly min: number;
  readonly max: number;
}

export const RARITY: Record<Rarity, RarityDef> = {
  common: { id: 'common', label: 'COMMON', color: '#b9c2d0', min: 58, max: 65 },
  uncommon: { id: 'uncommon', label: 'UNCOMMON', color: '#5fe07a', min: 66, max: 71 },
  rare: { id: 'rare', label: 'RARE', color: '#3fa8ff', min: 72, max: 78 },
  epic: { id: 'epic', label: 'EPIC', color: '#b45cff', min: 79, max: 84 },
  legendary: { id: 'legendary', label: 'LEGENDARY', color: '#ffc531', min: 85, max: 90 },
  mythic: { id: 'mythic', label: 'MYTHIC', color: '#ff4fa3', min: 91, max: 95 },
  immortal: { id: 'immortal', label: 'IMMORTAL', color: '#ff3b3b', min: 96, max: 99 },
  limited: { id: 'limited', label: 'LIMITED', color: '#3ff2d0', min: 90, max: 99 },
};

export const POSITION: Record<CardPos, { label: string; plural: string; side: CardSide; stat: string }> = {
  WR: { label: 'Wide Receiver', plural: 'Receivers', side: 'offense', stat: 'catch' },
  OL: { label: 'Lineman', plural: 'Linemen', side: 'offense', stat: 'block' },
  RB: { label: 'Running Back', plural: 'Running Backs', side: 'offense', stat: 'speed' },
  DEF: { label: 'Defender', plural: 'Defense', side: 'defense', stat: 'tackle' },
};

export interface CardDef {
  readonly id: number;
  readonly name: string;
  readonly short: string;
  readonly pos: CardPos;
  readonly rarity: Rarity;
  /** Base overall rating (58..99). */
  readonly rating: number;
  readonly num: number;
}

// ---------------------------------------------------------------- catalogue

const FIRST = [
  'Ace', 'Blake', 'Cade', 'Dante', 'Eli', 'Finn', 'Gage', 'Hank', 'Ike', 'Jace', 'Kobe', 'Lane', 'Milo', 'Nico', 'Otis',
  'Pax', 'Quinn', 'Rex', 'Sol', 'Tate', 'Uri', 'Vic', 'Wes', 'Xan', 'Yuri', 'Zeke', 'Arlo', 'Bo', 'Cruz', 'Dax', 'Enzo',
  'Flash', 'Gus', 'Hux', 'Jax', 'Knox', 'Leo', 'Mack', 'Nash', 'Ozzy', 'Rio', 'Saint', 'Theo', 'Vance', 'Wynn', 'Zion',
];
const LAST = [
  'Banks', 'Carver', 'Dale', 'Easton', 'Fischer', 'Gaines', 'Holt', 'Irving', 'Jensen', 'Kaplan', 'Lowe', 'Mercer', 'Nash',
  'Oduya', 'Pryor', 'Quill', 'Ramos', 'Sato', 'Trent', 'Upton', 'Vance', 'Webb', 'Yates', 'Zane', 'Abara', 'Brooks', 'Cruz',
  'Dorsey', 'Ellis', 'Flint', 'Grady', 'Hale', 'Ibarra', 'Jett', 'Kemp', 'Lyle', 'Moss', 'Nolan', 'Okafor', 'Pike', 'Reyes',
  'Stone', 'Tate', 'Vega', 'Wolfe', 'Young', 'Archer', 'Boone', 'Cole', 'Drake', 'Frost', 'Hayes', 'Knox', 'Lane', 'Park',
  'Rocket', 'Blaze', 'Thunder', 'Storm', 'Steele', 'Bolt', 'Swift', 'Fury', 'Hunter', 'Ridge', 'Vortex', 'Comet', 'Nova',
];

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** How many cards of each position and rarity exist (513 in all). */
const PLAN: ReadonlyArray<[CardPos, Rarity, number]> = [
  ['WR', 'common', 34], ['WR', 'uncommon', 30], ['WR', 'rare', 28], ['WR', 'epic', 24], ['WR', 'legendary', 18], ['WR', 'mythic', 12], ['WR', 'immortal', 8], ['WR', 'limited', 6],
  ['OL', 'common', 32], ['OL', 'uncommon', 28], ['OL', 'rare', 24], ['OL', 'epic', 20], ['OL', 'legendary', 14], ['OL', 'mythic', 10], ['OL', 'immortal', 6], ['OL', 'limited', 6],
  ['RB', 'common', 14], ['RB', 'uncommon', 12], ['RB', 'rare', 12], ['RB', 'epic', 10], ['RB', 'legendary', 9], ['RB', 'mythic', 6], ['RB', 'immortal', 4], ['RB', 'limited', 4],
  ['DEF', 'common', 29], ['DEF', 'uncommon', 26], ['DEF', 'rare', 24], ['DEF', 'epic', 20], ['DEF', 'legendary', 16], ['DEF', 'mythic', 12], ['DEF', 'immortal', 8], ['DEF', 'limited', 7],
];

const NUMBERS: Record<CardPos, number[]> = {
  WR: [1, 3, 4, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89],
  OL: [50, 51, 52, 53, 54, 55, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
  RB: [2, 5, 6, 8, 9, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 35],
  DEF: [20, 21, 22, 24, 31, 36, 40, 42, 44, 52, 54, 55, 56, 58, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99],
};

const build = (): CardDef[] => {
  const r = seeded(20251111);
  const out: CardDef[] = [];
  const used = new Set<string>();
  for (const [pos, rarity, count] of PLAN) {
    const def = RARITY[rarity];
    for (let i = 0; i < count; i += 1) {
      let first = '';
      let last = '';
      do {
        first = FIRST[Math.floor(r() * FIRST.length)] as string;
        last = LAST[Math.floor(r() * LAST.length)] as string;
      } while (used.has(first + last));
      used.add(first + last);
      // Ratings climb through the rarity's range so the best card is last.
      const rating = Math.round(def.min + ((def.max - def.min) * (i + r() * 0.8)) / Math.max(1, count - 1 + 0.8));
      const nums = NUMBERS[pos];
      out.push({ id: out.length, name: `${first} ${last}`, short: `${first[0]}. ${last}`, pos, rarity, rating: Math.min(def.max, rating), num: nums[Math.floor(r() * nums.length)] as number });
    }
  }
  return out;
};

export const CARDS: readonly CardDef[] = build();
export const CARD_COUNT = CARDS.length;

export const cardById = (id: number): CardDef | undefined => CARDS[id];

export const cardsOf = (pos: CardPos): CardDef[] => CARDS.filter((c) => c.pos === pos);

// ---------------------------------------------------------------- levels

/** Copies needed to reach each level (index = level - 1). */
export const LEVEL_COPIES: readonly number[] = [1, 2, 4, 8, 16, 32];
export const MAX_CARD_LEVEL = LEVEL_COPIES.length;

export const cardLevel = (copies: number): number => {
  let lv = 0;
  for (const need of LEVEL_COPIES) if (copies >= need) lv += 1;
  return Math.max(1, lv);
};

/** Rating including the level bonus (+1 per level above 1). */
export const cardRating = (id: number, copies: number): number => {
  const c = CARDS[id];
  return c ? Math.min(99, c.rating + cardLevel(copies) - 1) : 0;
};

/** A receiver's catch chance (0..1) from its rating. */
export const catchChance = (rating: number): number => Math.min(0.99, 0.7 + (rating - 58) * 0.0072);

/** The stat line shown on a card. */
export const cardStat = (pos: CardPos, rating: number): string => {
  if (pos === 'WR') return `${Math.round(catchChance(rating) * 100)}% catch`;
  if (pos === 'OL') return `+${(blockSeconds(rating)).toFixed(1)}s pocket`;
  if (pos === 'RB') return `+${Math.round((rating - 55) * 0.6)}% run`;
  return `${rating} tackle`;
};

/** Extra pocket seconds one lineman buys. */
export const blockSeconds = (rating: number): number => Math.max(0, (rating - 55) * 0.02);

// ---------------------------------------------------------------- lineup

export interface Lineup {
  wr: number[];
  ol: number[];
  rb: number[];
  def: number[];
}

export const LINEUP_SLOTS: Record<keyof Lineup, number> = { wr: 3, ol: 5, rb: 1, def: 3 };

const SLOT_POS: Record<keyof Lineup, CardPos> = { wr: 'WR', ol: 'OL', rb: 'RB', def: 'DEF' };

export const emptyLineup = (): Lineup => ({ wr: [], ol: [], rb: [], def: [] });

/** The best cards owned for every slot. */
export const bestLineup = (owned: Record<number, number>): Lineup => {
  const out = emptyLineup();
  for (const key of Object.keys(LINEUP_SLOTS) as Array<keyof Lineup>) {
    out[key] = Object.keys(owned)
      .map(Number)
      .filter((id) => CARDS[id]?.pos === SLOT_POS[key] && (owned[id] ?? 0) > 0)
      .sort((a, b) => cardRating(b, owned[b] ?? 1) - cardRating(a, owned[a] ?? 1))
      .slice(0, LINEUP_SLOTS[key]);
  }
  return out;
};

/** Keep only owned cards of the right position, no duplicates, within slot counts. */
export const cleanLineup = (raw: unknown, owned: Record<number, number>): Lineup => {
  const src = (raw ?? {}) as Partial<Record<keyof Lineup, unknown>>;
  const out = emptyLineup();
  for (const key of Object.keys(LINEUP_SLOTS) as Array<keyof Lineup>) {
    const list = Array.isArray(src[key]) ? (src[key] as unknown[]) : [];
    const seen = new Set<number>();
    for (const v of list) {
      const id = typeof v === 'number' ? Math.floor(v) : -1;
      if (seen.has(id) || !((owned[id] ?? 0) > 0) || CARDS[id]?.pos !== SLOT_POS[key]) continue;
      seen.add(id);
      out[key].push(id);
      if (out[key].length >= LINEUP_SLOTS[key]) break;
    }
  }
  return out;
};

/** Average overall of the equipped team (0 when empty). */
export const teamRating = (lineup: Lineup, owned: Record<number, number>): number => {
  const ids = [...lineup.wr, ...lineup.ol, ...lineup.rb, ...lineup.def];
  if (!ids.length) return 0;
  return Math.round(ids.reduce((s, id) => s + cardRating(id, owned[id] ?? 1), 0) / ids.length);
};

/** Cards collection multiplier: +1% money per unique card. */
export const cardsMultiplier = (owned: Record<number, number>): number => 1 + 0.01 * uniqueCards(owned);

export const uniqueCards = (owned: Record<number, number>): number => Object.values(owned).filter((n) => n > 0).length;

/** The cards every new player starts with: a full, weak team. */
export const STARTER_CARDS: readonly number[] = (() => {
  const pick = (pos: CardPos, n: number): number[] => CARDS.filter((c) => c.pos === pos && c.rarity === 'common').slice(0, n).map((c) => c.id);
  return [...pick('WR', 3), ...pick('OL', 5), ...pick('RB', 1), ...pick('DEF', 3)];
})();

// ---------------------------------------------------------------- packs

export type PackId = 'rookie' | 'receiver' | 'lineman' | 'backfield' | 'defense' | 'epic' | 'legend' | 'limited';

export interface PackDef {
  readonly id: PackId;
  readonly name: string;
  /** Cash price in the Shop; 0 = cannot be bought (earned only). */
  readonly price: number;
  readonly positions: readonly CardPos[];
  /** Odds per rarity, in percent. */
  readonly odds: Partial<Record<Rarity, number>>;
  readonly color: string;
  readonly blurb: string;
}

export const PACKS: Record<PackId, PackDef> = {
  rookie: { id: 'rookie', name: 'Rookie Pack', price: 600, positions: ['WR', 'OL', 'RB', 'DEF'], odds: { common: 62, uncommon: 28, rare: 9, epic: 1 }, color: '#5fb8ff', blurb: 'Any position. A good start.' },
  receiver: { id: 'receiver', name: 'Rare Receiver Pack', price: 2500, positions: ['WR'], odds: { rare: 74, epic: 21, legendary: 5 }, color: '#3fa8ff', blurb: 'A Rare or better wide receiver.' },
  lineman: { id: 'lineman', name: 'Lineman Pack', price: 2000, positions: ['OL'], odds: { uncommon: 40, rare: 45, epic: 13, legendary: 2 }, color: '#ff9d3b', blurb: 'Big bodies who buy you time.' },
  backfield: { id: 'backfield', name: 'Backfield Pack', price: 2000, positions: ['RB'], odds: { uncommon: 40, rare: 45, epic: 13, legendary: 2 }, color: '#5fe07a', blurb: 'Faster runs after the catch.' },
  defense: { id: 'defense', name: 'Defense Pack', price: 2000, positions: ['DEF'], odds: { uncommon: 40, rare: 45, epic: 13, legendary: 2 }, color: '#ff5f6d', blurb: 'Defenders for your collection.' },
  epic: { id: 'epic', name: 'Epic Pack', price: 18000, positions: ['WR', 'OL', 'RB', 'DEF'], odds: { epic: 72, legendary: 23, mythic: 5 }, color: '#b45cff', blurb: 'Epic or better, any position.' },
  legend: { id: 'legend', name: 'Legend Pack', price: 90000, positions: ['WR', 'OL', 'RB', 'DEF'], odds: { legendary: 70, mythic: 25, immortal: 5 }, color: '#ffc531', blurb: 'Legendary or better.' },
  limited: { id: 'limited', name: 'Limited Pack', price: 0, positions: ['WR', 'OL', 'RB', 'DEF'], odds: { limited: 100 }, color: '#3ff2d0', blurb: 'Limited cards. Earned only.' },
};

export const PACK_IDS = Object.keys(PACKS) as PackId[];
export const isPackId = (v: unknown): v is PackId => typeof v === 'string' && v in PACKS;

/** Roll one card from a pack with a 0..1 random source. */
export const rollPack = (pack: PackId, rand: () => number): number => {
  const def = PACKS[pack];
  const entries = Object.entries(def.odds) as Array<[Rarity, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  let rarity: Rarity = entries[0]![0];
  for (const [r, w] of entries) {
    if (roll < w) {
      rarity = r;
      break;
    }
    roll -= w;
  }
  const pool = CARDS.filter((c) => c.rarity === rarity && def.positions.includes(c.pos));
  return (pool[Math.floor(rand() * pool.length)] ?? CARDS[0]!).id;
};
