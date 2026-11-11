import { matchMaker } from '@colyseus/core';
import { ROOM_NAME } from '@mctf/shared';
import { logger } from './util/logger.js';

const SCOPE = 'reporter';

/** How often the matchmaker hears from this pod. */
const INTERVAL_MS = 2_000;

/** A report that takes longer than this is dropped; the next one follows in two seconds. */
const TIMEOUT_MS = 3_000;

/**
 * Tell the Bloxity matchmaker, every two seconds, which rooms this pod holds and how
 * full they are.
 *
 * It is how Bloxity knows a pod has players: it places new players on pods with room,
 * adds a pod when they are all full, keeps a busy pod alive and scales the game back to
 * zero once it is empty. Legion injects the four variables into every pod; without them
 * (a local `npm run dev`) reporting stays off. A failed report never touches the game:
 * it is logged once, and once more when reports recover.
 *
 * Returns a function that stops reporting.
 */
export const installRoomReporter = (): (() => void) => {
  const url = process.env['MATCHMAKER_REPORT_URL']?.trim();
  const token = process.env['BLOXITY_REPORT_TOKEN']?.trim();
  const gameId = process.env['BLOXITY_GAME_ID']?.trim();
  const podName = process.env['POD_NAME']?.trim();
  if (!url || !token || !gameId || !podName) {
    logger.info(SCOPE, 'matchmaker reporting off (not running on Bloxity)');
    return () => {};
  }

  const endpoint = `${url.replace(/\/+$/, '')}/${encodeURIComponent(gameId)}/rooms`;
  let failing = false;

  const report = async (): Promise<void> => {
    const rooms = await matchMaker.query({ name: ROOM_NAME });
    const body = {
      podName,
      players: rooms.reduce((total, room) => total + room.clients, 0),
      rooms: rooms.map((room) => ({
        colyseusRoomId: room.roomId,
        clients: room.clients,
        maxClients: room.maxClients,
        locked: Boolean(room.locked),
        private: Boolean(room.private),
      })),
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  };

  const timer = setInterval(() => {
    report().then(
      () => {
        if (!failing) return;
        failing = false;
        logger.info(SCOPE, 'matchmaker reports recovered');
      },
      (error: unknown) => {
        if (failing) return;
        failing = true;
        logger.warn(SCOPE, `matchmaker report failed: ${String(error)}`);
      },
    );
  }, INTERVAL_MS);
  timer.unref();

  logger.info(SCOPE, `reporting rooms to the matchmaker as ${podName}`);
  return () => clearInterval(timer);
};
