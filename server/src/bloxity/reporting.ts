import { LEADERBOARDS } from '@mctf/shared';
import { boxityServerEnv } from '../config/boxityEnv.js';
import type { Profile } from '../persistence/store.js';
import { logger } from '../util/logger.js';

/**
 * Boxity stat and leaderboard reporting, from state THIS SERVER owns.
 *
 * Rooms register the profile of every signed-in player they hold (guests are
 * never registered: they have no Boxity account to attach anything to). Every
 * value sent is read from those profiles, never from a client message.
 *
 * Both reporters do nothing at all without BLOXITY_REPORT_TOKEN and
 * BLOXITY_GAME_ID, which is what keeps local development quiet.
 */
const SCOPE = 'bloxity/report';
const STATS_EVERY_MS = 60_000;
const BOARDS_EVERY_MS = 15_000;
const BATCH = 200;
const TIMEOUT_MS = 8_000;

const credentials = (): { token: string; gameId: string } | null => {
  const token = process.env['BLOXITY_REPORT_TOKEN']?.trim();
  const gameId = process.env['BLOXITY_GAME_ID']?.trim();
  return token && gameId ? { token, gameId } : null;
};

/** "legion_<id>", with any "#m..." mode suffix stripped; null for non-accounts. */
const legionId = (accountId: string): string | null => {
  const raw = accountId.split('#m')[0]?.trim() ?? '';
  if (!raw) return null;
  return raw.startsWith('legion_') ? raw : `legion_${raw}`;
};

// ------------------------------------------------------------ live players

/** Signed-in players on this pod: account id -> their live profile. */
const live = new Map<string, Profile>();
/** Players who left since the last stats flush: their final values still go out. */
const departed = new Map<string, Profile>();

export const trackPlayer = (accountId: string, profile: Profile): void => {
  departed.delete(accountId);
  live.set(accountId, profile);
};

export const untrackPlayer = (accountId: string, profile: Profile): void => {
  live.delete(accountId);
  departed.set(accountId, profile);
};

// ------------------------------------------------------------ stats

const STAT_DEFINITIONS = [
  { key: 'touchdowns', label: 'Touchdowns', type: 'number', sortOrder: 1 },
  { key: 'highest_stage', label: 'Highest Stage', type: 'number', sortOrder: 2 },
  { key: 'completions', label: 'Completions', type: 'number', sortOrder: 3 },
  { key: 'best_ring_streak', label: 'Best Ring Streak', type: 'number', sortOrder: 4 },
  { key: 'cash', label: 'Cash', type: 'currency', sortOrder: 5 },
] as const;

const CEILING: Record<string, number> = { number: 1_000_000_000, seconds: 31_536_000_000, currency: 1_000_000_000_000, percent: 100 };

const statValues = (p: Profile): Record<string, number> => {
  const raw: Record<string, number> = {
    touchdowns: p.touchdowns,
    // `stage` is the NEXT stage to play; the highest one beaten is one less.
    highest_stage: Math.max(0, p.stage - 1),
    completions: p.completions,
    best_ring_streak: p.bestRingStreak,
    cash: p.cash,
  };
  const out: Record<string, number> = {};
  for (const def of STAT_DEFINITIONS) {
    const v = raw[def.key];
    // Omitted, never clamped: the high-water mark can never be lowered.
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= (CEILING[def.type] ?? 0)) out[def.key] = Math.floor(v);
  }
  return out;
};

const post = async (url: string, token: string, body: unknown, what: string): Promise<void> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text().catch(() => '');
    if (response.ok) logger.info(SCOPE, `${what} -> ${response.status} ${text.slice(0, 400)}`);
    else logger.warn(SCOPE, `${what} -> ${response.status} ${text.slice(0, 400)}`);
  } catch (error) {
    logger.warn(SCOPE, `${what} failed: ${String(error)}`);
  }
};

const flushStats = async (): Promise<void> => {
  const creds = credentials();
  if (!creds) return;
  const players: Array<{ userId: string; values: Record<string, number> }> = [];
  for (const [accountId, profile] of [...departed, ...live]) {
    const userId = legionId(accountId);
    if (!userId) continue;
    const values = statValues(profile);
    if (Object.keys(values).length) players.push({ userId, values });
  }
  departed.clear();
  if (!players.length) return;
  const url = `${boxityServerEnv.apiUrl}/v1/games/${encodeURIComponent(creds.gameId)}/stats`;
  for (let i = 0; i < players.length; i += BATCH) {
    await post(url, creds.token, { definitions: STAT_DEFINITIONS, players: players.slice(i, i + BATCH) }, `stats (${Math.min(BATCH, players.length - i)} players)`);
  }
};

// ------------------------------------------------------------ leaderboards

const pendingScores: Array<{ board: string; userId: string; score: number }> = [];

/** One touchdown by a signed-in player (the board adds them up). */
export const reportTouchdown = (accountId: string): void => {
  if (!credentials()) return;
  const userId = legionId(accountId);
  if (userId) pendingScores.push({ board: 'touchdowns', userId, score: 1 });
};

const flushBoards = async (): Promise<void> => {
  const creds = credentials();
  if (!creds || !pendingScores.length) return;
  const scores = pendingScores.splice(0, pendingScores.length);
  const url = `${boxityServerEnv.apiUrl}/v1/leaderboards/hosted/${encodeURIComponent(creds.gameId)}/report`;
  for (let i = 0; i < scores.length; i += BATCH) {
    await post(url, creds.token, { boards: LEADERBOARDS, scores: scores.slice(i, i + BATCH) }, `leaderboards (${Math.min(BATCH, scores.length - i)} scores)`);
  }
};

// ------------------------------------------------------------ lifecycle

/** Start both reporters. Returns the final flush for shutdown. */
export const installBloxityReporting = (): (() => Promise<void>) => {
  if (!credentials()) {
    logger.info(SCOPE, 'stats and leaderboard reporting off (not running on Bloxity)');
    return async () => undefined;
  }
  const stats = setInterval(() => void flushStats(), STATS_EVERY_MS);
  const boards = setInterval(() => void flushBoards(), BOARDS_EVERY_MS);
  stats.unref();
  boards.unref();
  logger.info(SCOPE, 'reporting stats every 60s and leaderboard scores every 15s');
  return async () => {
    clearInterval(stats);
    clearInterval(boards);
    await Promise.allSettled([flushStats(), flushBoards()]);
  };
};
