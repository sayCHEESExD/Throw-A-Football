import { serverConfig } from '../config/serverConfig.js';
import { boxityServerEnv } from '../config/boxityEnv.js';
import { logger } from '../util/logger.js';

const SCOPE = 'bloxity/ads';
const TIMEOUT_MS = 8_000;

/**
 * Verify a rewarded-ad token with Boxity before granting anything.
 *
 * The client only ever says "I watched an ad, here is the token"; the reward is
 * this server's to give, and only when Boxity answers `valid: true`. Each token
 * works once, for this game, within five minutes. Never throws: anything but a
 * clear yes is a no.
 */
export const verifyRewardToken = async (rewardToken: string): Promise<boolean> => {
  const base = boxityServerEnv.apiUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/v1/ads/reward/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameSlug: serverConfig.gameSlug, rewardToken }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as { valid?: unknown } | null;
    const valid = response.ok && body?.valid === true;
    logger.info(SCOPE, `reward verify -> ${response.status} valid=${valid}`);
    return valid;
  } catch (error) {
    logger.warn(SCOPE, `reward verify failed: ${String(error)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
};
