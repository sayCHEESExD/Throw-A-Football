import { createHash } from 'node:crypto';
import { isValidAccountId } from '@mctf/shared';
import { boxityServerEnv } from '../config/boxityEnv.js';
import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'auth';

/**
 * Boxity's API for the environment this deploy runs in (prod or stage):
 * BLOXITY_API_URL, which Boxity hosting injects on every deploy. Only the
 * hosting platform sets a pod's environment, so this is not a player's knob.
 */
const bloxityApi = (): string => boxityServerEnv.apiUrl;

/**
 * The route the official Legion SDK verifies its own token with:
 *
 *   POST /v1/auth/game-token/verify
 *   Authorization: Bearer <token>
 *   { "gameSlug": "<game id>" }
 *
 * Read from the unminified SDK at sdk.bloxity.io/legion-sdk.js, and probed
 * live: no token -> 401 GAME_TOKEN_REQUIRED, a junk token -> 401
 * GAME_TOKEN_INVALID, an invented neighbour -> 404. A success reply is either
 * `{ user }` or the user itself, and the account id is `user._id`.
 */
const VERIFY_PATH = '/v1/auth/game-token/verify';

/** How long one ask may take before it counts as an outage. */
const TIMEOUT_MS = 6000;

/** How long a VERIFIED answer is remembered, capped at the token's own expiry. */
const VERIFIED_TTL_MS = 60_000;
/** How long a REJECTED answer is remembered: a rejected token stays rejected. */
const REJECTED_TTL_MS = 30_000;
/** Most cached answers, so a flood of junk tokens cannot grow the map for ever. */
const CACHE_LIMIT = 2000;

export type AuthOutcome =
  /** Bloxity answered 2xx with a usable `_id`. */
  | { readonly status: 'verified'; readonly accountId: string; readonly carriedFrom: readonly string[] }
  /** Bloxity said no: 401 or 403. The player is a guest. */
  | { readonly status: 'rejected' }
  /**
   * Bloxity could not be asked, or answered something this code does not
   * understand: timeout, network error, 5xx, an unexpected 4xx, a 2xx with
   * no id. NOT a verdict on the token - the player is a guest FOR NOW and
   * the caller re-asks on a backoff.
   */
  | { readonly status: 'unavailable' };

interface CacheEntry {
  readonly outcome: AuthOutcome;
  readonly until: number;
}

/** Cached by a HASH of the token, so the map never holds a usable credential. */
const cache = new Map<string, CacheEntry>();

/** The cache key, and the only form a token appears in a log. */
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 32);

/**
 * The `exp` claim of a JWT, in milliseconds, or null.
 *
 * READ ONLY FOR THE CACHE CAP. Nothing about the token is trusted from its
 * own contents: `JWT_SECRET` is the game's secret, not Bloxity's signing key,
 * so there is nothing a server could check a signature against. Bloxity is
 * asked every time the cache does not already hold Bloxity's answer.
 */
const tokenExpiry = (token: string): number | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

const remember = (hash: string, outcome: AuthOutcome, ttlMs: number): void => {
  if (ttlMs <= 0) return;
  if (cache.size >= CACHE_LIMIT) {
    // Drop the oldest quarter rather than scanning for expiries under load.
    let drop = Math.ceil(CACHE_LIMIT / 4);
    for (const key of cache.keys()) {
      if (drop-- <= 0) break;
      cache.delete(key);
    }
  }
  cache.set(hash, { outcome, until: Date.now() + ttlMs });
};

/**
 * Ask Bloxity whose token this is.
 *
 * FAILS CLOSED: only a 2xx carrying a valid string `_id` is "verified". Every
 * other answer is one of the two other outcomes, and the caller treats them
 * differently - a rejection is a guest, an outage is a guest who is re-asked
 * about later.
 */
export const verifyGameToken = async (token: string): Promise<AuthOutcome> => {
  const hash = tokenHash(token);
  const cached = cache.get(hash);
  if (cached) {
    if (cached.until > Date.now()) return cached.outcome;
    cache.delete(hash);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${bloxityApi()}${VERIFY_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ gameSlug: serverConfig.gameSlug }),
      signal: controller.signal,
    });
  } catch (error) {
    logger.warn(SCOPE, `bloxity unreachable for token ${hash}: ${String(error)}`);
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    let code = '';
    try {
      code = String(((await response.json()) as { code?: unknown })?.code ?? '');
    } catch {
      /* the status is the verdict */
    }
    logger.info(SCOPE, `token ${hash} rejected (${response.status}${code ? ` ${code}` : ''})`);
    const outcome: AuthOutcome = { status: 'rejected' };
    remember(hash, outcome, REJECTED_TTL_MS);
    return outcome;
  }

  if (!response.ok) {
    logger.warn(SCOPE, `bloxity answered ${response.status} for token ${hash}; treating as unavailable`);
    return { status: 'unavailable' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    logger.error(SCOPE, `bloxity 2xx was not JSON for token ${hash}: ${String(error)}`);
    return { status: 'unavailable' };
  }
  const body = (payload ?? {}) as { user?: unknown; _id?: unknown; carriedFrom?: unknown };
  const user = (body.user && typeof body.user === 'object' ? body.user : body) as { _id?: unknown };
  const accountId = user._id;
  if (!isValidAccountId(accountId)) {
    logger.error(SCOPE, `bloxity 2xx carried no usable _id for token ${hash}; treating as unavailable`);
    return { status: 'unavailable' };
  }

  // Boxity guest ids this browser played as before signing in (newest first, up to 5): their progress may follow.
  const carriedFrom = Array.isArray(body.carriedFrom) ? body.carriedFrom.filter((id): id is string => isValidAccountId(id) && id !== accountId).slice(0, 5) : [];
  const outcome: AuthOutcome = { status: 'verified', accountId, carriedFrom };
  const exp = tokenExpiry(token);
  const ttl = exp === null ? VERIFIED_TTL_MS : Math.min(VERIFIED_TTL_MS, exp - Date.now());
  remember(hash, outcome, ttl);
  return outcome;
};

/** For tests and diagnostics only. */
export const forgetVerifiedTokens = (): void => cache.clear();
