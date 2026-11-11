import { boxityEnvironment } from '../bloxity/environment.js';
import { logger } from '../util/logger.js';

const SCOPE = 'net/rooms';
const TIMEOUT_MS = 4000;

/** Where a named room can be joined. */
export interface RoomLocation {
  readonly roomId: string;
  /** The socket of the pod holding it (its relay), as a ws(s) URL. */
  readonly endpoint: string;
}

interface DirRow {
  [key: string]: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The Colyseus room id a directory row describes. */
const idOf = (row: DirRow): string => text(row['colyseusRoomId']) || text(row['roomId']) || text(row['id']);

/** The pod's relay a directory row names, as a ws(s) URL. */
const joinUrlOf = (row: DirRow): string => {
  const raw = text(row['joinUrl']) || text(row['endpoint']) || text(row['wsUrl']);
  if (!raw) return '';
  if (/^wss?:\/\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http/i, 'ws');
  // A path on the matchmaker's own host.
  return `${boxityEnvironment().playUrl.replace(/^http/i, 'ws')}${raw.startsWith('/') ? '' : '/'}${raw}`;
};

/**
 * RESOLVE A HOSTED ROOM BEFORE JOINING IT.
 *
 * A bare `joinById` on a hosted fleet lands on whichever pod the matchmaker
 * hands out, which holds the room only by coincidence. So the room is looked up
 * in the matchmaker's cross-pod directory, `GET {playUrl}/v1/dir/<hostingId>/list`
 * (the same list Boxity's Open Rooms shows), and joined through the relay its
 * row names. Gone, full or unreadable answers null: the caller then matchmakes
 * normally. Never throws.
 */
export const locateRoom = async (hostingId: string, roomId: string): Promise<RoomLocation | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${boxityEnvironment().playUrl}/v1/dir/${encodeURIComponent(hostingId)}/list`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { rooms?: DirRow[] };
    const row = (body.rooms ?? []).find((candidate) => idOf(candidate) === roomId);
    if (!row) {
      logger.info(SCOPE, `room ${roomId} is not listed (closed?); joining normally`);
      return null;
    }
    const clients = Number(row['clients'] ?? row['players'] ?? 0);
    const max = Number(row['maxClients'] ?? row['maxPlayers'] ?? 0);
    if (row['locked'] === true || (max > 0 && clients >= max)) {
      logger.info(SCOPE, `room ${roomId} is full; joining normally`);
      return null;
    }
    const endpoint = joinUrlOf(row);
    if (!endpoint) {
      logger.info(SCOPE, `room ${roomId} names no relay; joining normally`);
      return null;
    }
    return { roomId, endpoint };
  } catch (error) {
    logger.warn(SCOPE, `room directory unreadable (${String(error)}); joining normally`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** A live room of this game, as the matchmaker's cross-pod directory lists it. */
export interface DirectoryRoom {
  readonly id: string;
  readonly players: number;
  readonly max: number;
}

/**
 * Every live room of the game across all pods (`GET {playUrl}/v1/dir/<hostingId>/list`),
 * for the in-game Servers app. Empty when the directory cannot be read. Never throws.
 */
export const listRooms = async (hostingId: string): Promise<DirectoryRoom[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${boxityEnvironment().playUrl}/v1/dir/${encodeURIComponent(hostingId)}/list`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { rooms?: DirRow[] };
    return (body.rooms ?? [])
      .filter((row) => row['private'] !== true)
      .map((row) => ({ id: idOf(row), players: Number(row['clients'] ?? row['players'] ?? 0), max: Number(row['maxClients'] ?? row['maxPlayers'] ?? 15) }))
      .filter((row) => row.id);
  } catch (error) {
    logger.warn(SCOPE, `room directory unreadable (${String(error)})`);
    return [];
  } finally {
    clearTimeout(timer);
  }
};
