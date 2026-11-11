/**
 * Room, networking and movement constants shared by client and server.
 */
export const GAME_TITLE = 'Throw Football';
export const ROOM_NAME = 'football';
export const MAX_PLAYERS_PER_ROOM = 15;
export const DEFAULT_SERVER_PORT = 3081;
/**
 * The slug the game is registered under on Bloxity. Overridable at build time
 * (VITE_BLOXITY_GAME_ID) and run time (BLOXITY_GAME_ID).
 */
export const DEFAULT_BLOXITY_GAME_SLUG = 'throw-football';
export const SERVER_TICK_RATE = 15;
/**
 * WebSocket close code a draining pod (SIGTERM on a deploy or scale-down) sends
 * a player it is letting go. Unlike 1000/4000 it is not a deliberate leave, so
 * the client resolves the matchmaker again and rejoins on a fresh pod.
 */
export const CLOSE_SERVER_MOVING = 4205;

// Movement (world units per second). One yard is YARD units.
export const WALK_SPEED = 11;
export const SPRINT_SPEED = 17;
export const JUMP_SPEED = 12;
export const GRAVITY = 36;
/** The fastest a client may claim to move, with slack for latency spikes. */
export const MAX_CLAIMED_SPEED = SPRINT_SPEED * 2.2;
