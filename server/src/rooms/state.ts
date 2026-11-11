import { MapSchema, Schema, type } from '@colyseus/schema';

/** One player, as everyone in the room sees them. */
export class PlayerState extends Schema {
  @type('string') name = 'Guest';
  /** Verified Bloxity account id ('' for guests): chat bubbles are matched by it. */
  @type('string') uid = '';
  /** JSON avatar look: { appearance, proportions }. */
  @type('string') look = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  @type('uint8') anim = 0;
  /** In a game (and so not standing in the shared lobby). */
  @type('boolean') inMatch = false;
  /** The stage they are on, for the leaderboard. */
  @type('uint16') stage = 1;
  @type('uint16') level = 1;
  @type('uint32') touchdowns = 0;
  @type('uint16') ringStreak = 0;
  /** Title shown under the name ('rookie', 'collector', ...). */
  @type('string') title = 'rookie';
  @type('uint8') rebirths = 0;
  /** Bloxity emote catalogue id ('' = none) and when it started (server ms). */
  @type('string') emote = '';
  @type('float64') emoteAt = 0;
}

export class RoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
