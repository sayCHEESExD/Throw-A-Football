/**
 * Bloxity emotes. The PORTAL draws the emote picker and sends the game a
 * catalogue id; the game plays it and replicates it. Ids are never hard-coded
 * (the catalogue grows without a game release) and ownership is never checked
 * here - Bloxity only sends ids the player is entitled to, and a second check
 * is how the two would drift apart. Only the id's SHAPE is checked: 24 hex
 * characters, a Mongo id.
 */
export const isBloxityEmoteId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);

export const BLOXITY_EMOTE = {
  /** Fewest milliseconds between two emotes from one player (spam guard). */
  minGapMs: 400,
  /** An emote the player never stops is cleared after this long. */
  maxMs: 30_000,
  /** Moving faster than this (units/s) stops it: an emote never fights the walk cycle. */
  stopSpeed: 1.5,
} as const;

export interface BloxityEmoteMessage {
  id: string;
}
