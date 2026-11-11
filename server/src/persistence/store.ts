import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient, type Collection } from 'mongodb';
import {
  DEFAULT_STYLE,
  NO_COUNTERS,
  NO_UPGRADES,
  STARTER_CARDS,
  STARTER_STYLE,
  TUTORIAL_STEPS,
  bestLineup,
  cleanLineup,
  type Counters,
  type Lineup,
  type PackId,
  type PlayChallenge,
  type StyleKind,
  type UpgradeRanks,
} from '@mctf/shared';
import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'store';

/** Everything saved about one player. */
export interface Profile {
  name: string;
  cash: number;
  fans: number;
  /** The next stage to play (1-based). */
  stage: number;
  upgrades: UpgradeRanks;
  touchdowns: number;
  completions: number;
  bestRingStreak: number;
  dailyStreak: number;
  /** Epoch ms of the last daily claim (0 = never). */
  dailyLast: number;
  bestDailyStreak: number;
  streakClaimed: number[];
  /** Card id -> copies owned. */
  cards: Record<number, number>;
  lineup: Lineup;
  packs: Partial<Record<PackId, number>>;
  rebirths: number;
  wins: number;
  counters: Counters;
  styleOwned: string[];
  styleEquipped: Record<StyleKind, string>;
  goalSet: number;
  goalsClaimed: string[];
  plays: PlayChallenge[];
  passXp: number;
  passClaimed: number[];
  spinAt: number;
  giftClaimed: boolean;
  tutorial: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Guest saves carried into an account are retired, never copied twice. */
  migratedTo?: string;
}

export const START_CASH = 0;

const starterCards = (): Record<number, number> => Object.fromEntries(STARTER_CARDS.map((id) => [id, 1]));

export const newProfile = (name: string): Profile => ({
  name,
  bestDailyStreak: 0,
  streakClaimed: [],
  cards: starterCards(),
  lineup: bestLineup(starterCards()),
  packs: {},
  rebirths: 0,
  wins: 0,
  counters: { ...NO_COUNTERS },
  styleOwned: [...STARTER_STYLE],
  styleEquipped: { ...DEFAULT_STYLE },
  goalSet: 0,
  goalsClaimed: [],
  plays: [],
  passXp: 0,
  passClaimed: [],
  spinAt: 0,
  giftClaimed: false,
  tutorial: 0,
  title: 'rookie',
  cash: START_CASH,
  fans: 0,
  stage: 1,
  upgrades: { ...NO_UPGRADES },
  touchdowns: 0,
  completions: 0,
  bestRingStreak: 0,
  dailyStreak: 0,
  dailyLast: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/** Fill in any field an older save is missing. */
export const upgradeProfile = (p: Profile): Profile => {
  const base = newProfile(p.name ?? 'Player');
  const old = (p.upgrades ?? {}) as Partial<UpgradeRanks>;
  const upgrades: UpgradeRanks = {
    accuracy: Math.max(0, Math.floor(old.accuracy ?? 0)),
    strength: Math.max(0, Math.floor(old.strength ?? 0)),
    money: Math.max(0, Math.floor(old.money ?? 0)),
  };
  const out: Profile = {
    ...base,
    ...p,
    upgrades,
    cards: p.cards && Object.keys(p.cards).length ? p.cards : base.cards,
    counters: { ...NO_COUNTERS, ...(p.counters ?? {}) },
    styleOwned: [...new Set([...STARTER_STYLE, ...(p.styleOwned ?? [])])],
    styleEquipped: { ...DEFAULT_STYLE, ...(p.styleEquipped ?? {}) },
  };
  out.lineup = cleanLineup(p.lineup ?? bestLineup(out.cards), out.cards);
  // Saves from before the tutorial existed already know how to play.
  if (p.tutorial === undefined && hasProgress(out)) out.tutorial = TUTORIAL_STEPS;
  if (p.counters === undefined) {
    out.counters.touchdowns = out.touchdowns;
    out.counters.completions = out.completions;
  }
  return out;
};

export const hasProgress = (p: Profile): boolean => p.cash > 0 || p.stage > 1 || p.fans > 0;

interface Backend {
  readonly kind: string;
  load(key: string): Promise<Profile | null>;
  save(key: string, profile: Profile): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** JSON file store for local development (and any pod without MONGODB_URI). */
class JsonBackend implements Backend {
  readonly kind = 'json';
  private data: Record<string, Profile> = {};
  private readonly file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'profiles.json');
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Profile>;
      } catch (error) {
        logger.error(SCOPE, `could not read ${this.file}; starting empty`, error);
      }
    }
  }

  async load(key: string): Promise<Profile | null> {
    const p = this.data[key];
    return p ? (JSON.parse(JSON.stringify(p)) as Profile) : null;
  }

  async save(key: string, profile: Profile): Promise<void> {
    this.data[key] = JSON.parse(JSON.stringify(profile)) as Profile;
    if (!this.timer) this.timer = setTimeout(() => this.writeNow(), 1500);
  }

  writeNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  async flush(): Promise<void> {
    this.writeNow();
  }

  async close(): Promise<void> {
    this.writeNow();
  }
}

/** The managed MongoDB every Bloxity pod is given (MONGODB_URI). */
class MongoBackend implements Backend {
  readonly kind = 'mongo';
  private client: MongoClient;
  private col: Collection<{ _id: string; profile: Profile; updatedAt: number }> | null = null;
  private pending = new Set<Promise<unknown>>();

  constructor(uri: string) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  }

  async open(): Promise<void> {
    await this.client.connect();
    this.col = this.client.db().collection('profiles');
  }

  async load(key: string): Promise<Profile | null> {
    if (!this.col) throw new Error('mongo not open');
    const doc = await this.col.findOne({ _id: key });
    return doc?.profile ?? null;
  }

  async save(key: string, profile: Profile): Promise<void> {
    if (!this.col) throw new Error('mongo not open');
    const op = this.col.updateOne({ _id: key }, { $set: { profile, updatedAt: Date.now() } }, { upsert: true });
    this.pending.add(op);
    try {
      await op;
    } finally {
      this.pending.delete(op);
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async close(): Promise<void> {
    await this.flush();
    await this.client.close();
  }
}

class ProfileStore {
  private backend: Backend = new JsonBackend(serverConfig.dataDir);

  get kind(): string {
    return this.backend.kind;
  }

  async open(): Promise<void> {
    if (!serverConfig.mongoUri) {
      logger.info(SCOPE, `JSON store at ${serverConfig.dataDir}`);
      return;
    }
    const mongo = new MongoBackend(serverConfig.mongoUri);
    try {
      await mongo.open();
      this.backend = mongo;
      logger.info(SCOPE, 'MongoDB store open');
    } catch (error) {
      logger.error(SCOPE, 'MongoDB unreachable; using the JSON store for now', error);
    }
  }

  load(key: string): Promise<Profile | null> {
    return this.backend.load(key);
  }

  async save(key: string, profile: Profile): Promise<void> {
    profile.updatedAt = Date.now();
    try {
      await this.backend.save(key, profile);
    } catch (error) {
      logger.error(SCOPE, `save failed for ${key}`, error);
    }
  }

  flush(): Promise<void> {
    return this.backend.flush();
  }

  close(): Promise<void> {
    return this.backend.close();
  }

  flushSync(): void {
    if (this.backend instanceof JsonBackend) this.backend.writeNow();
  }
}

export const profileStore = new ProfileStore();
