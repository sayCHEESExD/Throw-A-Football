/**
 * The Bloxity SDK's shape, as this game uses it.
 *
 * The SDK ships as a plain script that installs `window.Legion`, with no types
 * of its own. These declarations are the CONTRACT this game codes against -
 * deliberately narrow: only what is actually called, so a change on their side
 * shows up as a type error here rather than as a runtime surprise in a
 * deployed build.
 *
 * Every member is optional at the call site through `sdk()` in `Bloxity.ts`,
 * because the script is loaded from a third-party CDN and may simply not be
 * there - offline, blocked, or an older build that predates a namespace.
 */

export interface LegionUser {
  readonly _id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly pfp?: string;
  readonly avatar?: string;
}

/**
 * A friend's presence.
 *
 * The status strings are spelled both ways in the wild - the docs say
 * `in-game`, the reference implementation emits `in_game` - so anything
 * reading this must accept both. `presenceLabel` in `BloxityPanel` is the one
 * place that decides.
 */
export interface LegionPresence {
  readonly status: 'online' | 'in-game' | 'in_game' | 'away' | 'offline';
  readonly currentGame?: string;
  readonly currentRoom?: string;
  readonly currentParty?: string;
  readonly gameSlug?: string;
  readonly gameName?: string;
  readonly lastSeen?: string;
}

export interface LegionFriend {
  readonly _id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly pfp?: string;
  readonly presence?: LegionPresence;
}

/** Equipped cosmetic ids. `'-1'`, `''`, `'undefined'` and null all mean NONE. */
export interface LegionEquipped {
  readonly hatId?: string | null;
  readonly backId?: string | null;
  readonly skinId?: string | null;
  readonly headId?: string | null;
  readonly armLId?: string | null;
  readonly armRId?: string | null;
  readonly legLId?: string | null;
  readonly legRId?: string | null;
  readonly torsoId?: string | null;
  readonly hairId?: string | null;
  readonly maskId?: string | null;
  readonly neckId?: string | null;
  readonly chestId?: string | null;
  readonly waistId?: string | null;
  readonly handId?: string | null;
  readonly shoesId?: string | null;
  readonly faceId?: string | null;
  readonly pantsId?: string | null;
  readonly shirtId?: string | null;
}

/** Avatar proportions. Every value is a multiplier defaulting to 1. */
export interface LegionProportions {
  readonly height: number;
  readonly shoulderWidth: number;
  readonly armLength: number;
  readonly legOffsetX: number;
  readonly torsoScaleX: number;
  readonly neckHeight: number;
  readonly headScale: number;
}

export interface LegionFriendRequestResult {
  readonly success: boolean;
  readonly status?: 'accepted' | 'pending';
  readonly error?: string;
}

/** What a player event carries. `respawn_request` carries nothing. */
export type LegionPlayerEvent =
  | 'respawn_request'
  | 'chat_message_sent'
  | 'pointer_lock_changed'
  /** The portal's emote picker chose an emote; data = its catalogue id (24 hex). */
  | 'play_emote';

export interface LegionSdk {
  init(options: { gameSlug: string }): void;

  auth?: {
    getUser(): LegionUser | null;
    /**
     * The portal's GUEST identity, and null once somebody is signed in.
     *
     * The portal gives every unauthenticated visitor a real name and a real
     * portrait - "Chicken 877" and a rendered thumbnail - rather than leaving
     * them anonymous. `getUser` returns null for those visitors, so a game
     * that only asked for the user showed a room full of people called
     * nothing. It is the exact mirror of `getUser`: exactly one of the two is
     * ever non-null.
     */
    getGuest?(): LegionUser | null;
    getToken(): string | null;
    isLoggedIn(): boolean;
    showAuthPopup(): Promise<LegionUser | null>;
    logout(): void;
    onUserChanged(callback: (user: LegionUser | null) => void): () => void;
    authenticateWithServer(url: string): Promise<unknown | null>;
  };

  avatar?: {
    getEquipped(): LegionEquipped;
    getProportions(): LegionProportions;
    setProportions(partial: Partial<LegionProportions>): Promise<unknown>;
    resetProportions(): Promise<unknown>;
    onAvatarChanged(callback: (equipped: LegionEquipped) => void): () => void;
    onProportionsChanged(
      callback: (proportions: LegionProportions) => void,
    ): () => void;
    showCustomizer(): void;
    hideCustomizer(): void;
    toggleCustomizer(): void;
    isCustomizerOpen(): boolean;
  };

  social?: {
    getFriends(): Promise<LegionFriend[]>;
    inviteFriend(userId: string): Promise<boolean>;
    getInviteFriendsLink(options?: {
      gameSlug?: string;
      roomId?: string;
      partyId?: string;
      baseUrl?: string;
      ref?: string;
    }): string;
    sendFriendRequest(userId: string): Promise<LegionFriendRequestResult>;
  };

  settings?: {
    listen(key: string, callback: (value: string) => void): () => void;
    get(key: string): string;
    getAll(): Record<string, string>;
    onChanged(callback: (settings: Record<string, string>) => void): () => void;
    triggerAll(): void;
    refresh(): void;
  };

  game?: {
    loadingStep(text: string): void;
    loadingEnd(): void;
    gameplayStart(): void;
    gameplayEnd(): void;
    updateRoom(roomId: string, partyId?: string): void;
    playerJoined(username: string): void;
    playerInRoom(username: string): void;
    /** Opt into a portal-drawn capability ('emotes' shows the portal's emote button). */
    registerFeature?(feature: string): void;
  };

  player?: {
    onEvent(
      callback: (event: LegionPlayerEvent, data?: unknown) => void,
    ): () => void;
  };

  // No Gems / Bux API here on purpose: Rosemont sells nothing for real money. Everything is bought with
  // in-game cash, server-checked (BuyPass).

  /** Boxity-run ads: breaks, rewarded ads and edge banners per screen. */
  ads?: {
    isAvailable(): boolean;
    showRewarded(placement?: string): Promise<LegionRewardedResult>;
    screen(type: LegionAdScreenType, options?: LegionAdScreenOptions): LegionAdScreenHandle;
    hideScreen(): void;
    onBreakStart(callback: (info?: unknown) => void): () => void;
    onBreakEnd(callback: (info?: unknown) => void): () => void;
  };

  /** Screen areas the portal's own UI (and its banners) occupy. */
  ui?: {
    reservedAreas(): LegionReservedArea[];
    onReservedAreasChange(callback: (areas: LegionReservedArea[]) => void): () => void;
  };

  environment?(): { env: string; apiUrl: string; playUrl: string; portalUrl: string; staticUrl: string };
  onEnvironmentChanged?(callback: (env: { env: string }) => void): () => void;

  /** Boxity leaderboards: declared in the browser, scores submitted by this game's server. */
  leaderboard?: {
    define(boards: readonly unknown[]): void;
    /** Opens Boxity's leaderboard panel over the game; false outside Boxity. */
    open(board?: string): boolean;
  };

  /** Boxity's chat: the portal draws the UI, the game draws bubbles over heads. */
  chat?: {
    readonly bubbleSeconds: number;
    onMessage(callback: (message: LegionChatMessage) => void): () => void;
    bubbleText(message: LegionChatMessage): string;
    attachBubble(three: unknown, target: unknown, text: string, options?: { height?: number; scale?: number }): unknown;
  };

  portal?: {
    isInIframe(): boolean;
    isEmbeddedInLegion(): boolean;
    requestFullscreen(): void;
    exitFullscreen(): void;
    showMenu(lockCursorOnResume?: boolean): void;
  };

  /** The matchmaker: a seat on a game server pod with room, and the address to join it at. */
  net?: {
    resolveEndpoint(gameSlug: string): Promise<{ endpoint: string; roomId: string; cold: boolean }>;
  };

  api?: {
    get(path: string): Promise<unknown>;
    post(path: string, body?: unknown): Promise<unknown>;
    patch(path: string, body?: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
  };
}

export type LegionAdScreenType = 'menu' | 'lobby' | 'results' | 'panel' | 'gameplay';
export type LegionAdPosition = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type LegionAdSize = '300x250' | '728x90' | '300x600' | '320x50' | '320x100' | '160x600';

export interface LegionAdScreenOptions {
  skip?: LegionAdPosition[];
  sizes?: Partial<Record<LegionAdPosition, LegionAdSize>>;
}

export interface LegionAdScreenHandle {
  readonly state: string;
  hide(): void;
}

export interface LegionRewardedResult {
  /** 'completed' is the only status that earns the reward. */
  status: 'completed' | 'skipped' | 'no-fill' | 'blocked' | 'denied' | 'disabled' | 'error' | string;
  rewardToken?: string;
  reason?: string;
}

export interface LegionReservedArea {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    Legion?: { SDK?: LegionSdk };
  }
}

/** An id is only equipped if it is a real one. */
export const isEquippedId = (id: string | null | undefined): id is string =>
  id != null && id !== '' && id !== '-1' && id !== 'undefined';

/** One chat message in the player's room (sender verified, text filtered by Boxity). */
export interface LegionChatMessage {
  readonly userId: string;
  readonly username: string;
  readonly text: string;
  readonly isGif: boolean;
  readonly at: number;
  readonly isLocalPlayer: boolean;
}
