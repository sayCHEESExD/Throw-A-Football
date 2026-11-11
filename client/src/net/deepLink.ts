/**
 * THE ROOM A LINK ASKS FOR: an invite link or the store page's Join button
 * opens the game with `?roomId=<colyseus room id>` (Bloxity's
 * `getInviteFriendsLink` builds exactly that; the portal passes the query on to
 * the game's frame). Read once, validated, and consumed: a reconnect later in
 * the session must not drag the player back into a room they left.
 */
const ROOM_ID = /^[A-Za-z0-9_-]{4,32}$/;

let pending: string | null = null;
let read = false;

const readRoomId = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('roomId') ?? params.get('roomid');
    return raw && ROOM_ID.test(raw) ? raw : null;
  } catch {
    return null;
  }
};

/** The room the page was opened for, once; null after that (or without one). */
export const takeDeepLinkRoom = (): string | null => {
  if (!read) {
    read = true;
    pending = readRoomId();
  }
  const room = pending;
  pending = null;
  return room;
};
