import { Client, type Room } from 'colyseus.js';
import { ROOM_NAME, type JoinOptions } from '@mctf/shared';
import { clientConfig } from '../config/clientConfig.js';
import { GAME_SLUG } from '../bloxity/Bloxity.js';
import { locateRoom } from './RoomLocator.js';
import { takeDeepLinkRoom } from './deepLink.js';
import { logger } from '../util/logger.js';

const SCOPE = 'net';
/** A cold pod can take ~45 s to start; give up after a minute. */
const GIVE_UP_MS = 60_000;

/** A stable id for this browser, so a guest keeps their save. */
export const guestId = (): string => {
  const KEY = 'mctf.guest';
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
      id = `g${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `g${Math.random().toString(36).slice(2, 12)}`;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One matchmaker join: resolve a seat, then join through a NEW Client built
 * for that endpoint (each endpoint is pinned to one pod, so a Client is never
 * reused). Boxity's ticket on the request keeps parties and "Play with
 * friends" together; the game never picks a room itself.
 */
const matchmake = async (options: JoinOptions): Promise<Room> => {
  const sdk = window.Legion?.SDK;
  const resolve = sdk?.net?.resolveEndpoint;
  if (!resolve || !sdk.net) throw new Error('The Bloxity matchmaker is unavailable.');
  const { endpoint } = await resolve.call(sdk.net, GAME_SLUG);
  return new Client(endpoint).joinOrCreate(ROOM_NAME, options);
};

/**
 * Join a room. Locally that is the dev server's socket; everywhere else the
 * Bloxity matchmaker. A ?roomId= the page was opened with (Open Rooms' Join
 * button, a friend invite) is tried first, through the pod that holds it.
 * Failures retry with a backoff for up to a minute.
 */
export const joinRoom = async (options: JoinOptions, onRetry?: (attempt: number) => void): Promise<Room> => {
  const invited = takeDeepLinkRoom();

  if (!clientConfig.matchmaker) {
    const client = new Client(clientConfig.serverUrl);
    if (invited) {
      try {
        return await client.joinById(invited, options);
      } catch {
        /* gone or full: join normally */
      }
    }
    return client.joinOrCreate(ROOM_NAME, options);
  }

  if (invited) {
    const found = await locateRoom(GAME_SLUG, invited);
    if (found) {
      try {
        return await new Client(found.endpoint).joinById(found.roomId, options);
      } catch (error) {
        logger.warn(SCOPE, `invited room ${invited} refused (${String(error)}); matchmaking instead`);
      }
    }
  }

  const started = Date.now();
  let delay = 1000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await matchmake(options);
    } catch (error) {
      if (Date.now() - started + delay > GIVE_UP_MS) throw error;
      logger.warn(SCOPE, `join attempt ${attempt} failed (${String(error)}); retrying in ${delay} ms`);
      onRetry?.(attempt);
      await sleep(delay);
      delay = Math.min(8000, delay * 1.7);
    }
  }
};
