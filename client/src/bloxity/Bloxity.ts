import { loadBloxityEmotes } from '../animation/BloxityEmotes.js';
import { DEFAULT_BLOXITY_GAME_SLUG, LEADERBOARDS } from '@mctf/shared';
import { logger } from '../util/logger.js';
import type {
  LegionAdScreenHandle,
  LegionAdScreenOptions,
  LegionAdScreenType,
  LegionEquipped,
  LegionFriend,
  LegionPlayerEvent,
  LegionProportions,
  LegionChatMessage,
  LegionReservedArea,
  LegionRewardedResult,
  LegionSdk,
  LegionUser,
} from './legionTypes.js';

const SCOPE = 'bloxity';

/**
 * The slug this game is registered under on bloxity.io.
 *
 * Overridable at BUILD time by `VITE_BLOXITY_GAME_ID`, which is what the
 * deploy workflow passes - so a build for a differently-registered channel or
 * a renamed game needs no code change. The literal below is the value the game
 * is registered under today and is what a local `npm run dev` uses.
 *
 * Baked in at build time like every other Vite variable, so changing it means
 * rebuilding; there is no later step in which to inject it.
 */
export const GAME_SLUG =
  (import.meta.env['VITE_BLOXITY_GAME_ID'] as string | undefined)?.trim() ||
  DEFAULT_BLOXITY_GAME_SLUG;

/**
 * Every portal setting this game answers to.
 *
 * Registering a listener is also what makes the control APPEAR in the portal's
 * menu, so this list is a promise: each key here is genuinely wired to
 * something. `enable_chat` and `background_transparency` are the two that this
 * game has nothing to apply them to, and they are declared anyway because the
 * portal's chat and its overlay are drawn by the portal itself - the game only
 * has to say it supports them.
 */
export const SETTING_KEYS = [
  'master_volume',
  'music_volume',
  'graphics_quality',
  'show_fps',
  'camera_sensitivity',
  'enable_chat',
  'fullscreen',
  'background_transparency',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** What the game hands Bloxity so the bridge never reaches into the game. */
export interface BloxityHost {
  /** 0..1, from `master_volume`. */
  setMasterVolume(level: number): void;
  /** 0..1, from `music_volume`. */
  setMusicVolume(level: number): void;
  /** 'Low' | 'Medium' | 'High' | 'Ultra'. */
  setGraphicsQuality(level: string): void;
  setShowFps(show: boolean): void;
  /** A multiplier on the game's own tuned sensitivity. */
  setCameraSensitivity(scale: number): void;
  /** The portal asked for a respawn. */
  respawn(): void;
  /** The portal's pointer lock changed underneath us. */
  pointerLockChanged(locked: boolean): void;
  /** The portal's emote picker chose an emote: its catalogue id, unchecked. */
  playEmote(id: string): void;
  /** Cosmetics or proportions moved; re-dress the player. */
  avatarChanged(equipped: LegionEquipped, proportions: LegionProportions): void;
  /** A Boxity ad break started (true) or ended (false): pause and mute, then restore. */
  adBreak(active: boolean): void;
  /** A chat message in this room (sender verified by Boxity): bubble it over the sender. */
  chatMessage(message: LegionChatMessage): void;
}

/**
 * The Bloxity SDK, or null.
 *
 * EVERY call in this file goes through here. The SDK is a script from a
 * third-party CDN: it can be blocked, offline, or an older build without a
 * namespace this game uses. A game that threw in that case would be a game
 * that a blocked script takes offline, so the whole integration is written to
 * degrade to "no portal" rather than to fail.
 */
const sdk = (): LegionSdk | null => window.Legion?.SDK ?? null;

/** Run `body` if the SDK is there, and never let it throw into the game. */
const guard = <T>(what: string, body: (api: LegionSdk) => T): T | undefined => {
  const api = sdk();
  if (!api) return undefined;
  try {
    return body(api);
  } catch (error) {
    logger.warn(SCOPE, `${what} failed: ${String(error)}`);
    return undefined;
  }
};

const asFraction = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed / 100, 0), 1);
};

const asNumber = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asBool = (value: string): boolean => value === 'true';

/**
 * This game's whole relationship with the Bloxity portal.
 *
 * ONE module, and one subscription to `onUserChanged` inside it, which is the
 * single source of truth for who is signed in. Nothing else in the codebase
 * touches `window.Legion`: the renderer, the audio and the input layer are
 * handed values through `BloxityHost` and never learn a portal exists.
 *
 * The user object is deliberately NOT cached. `getUser()` is asked every time
 * it is needed, so a login that happens in another tab cannot leave this game
 * rendering a stale name.
 */
export class Bloxity {
  private host: BloxityHost;
  private readonly unsubscribes: (() => void)[] = [];

  private started = false;
  /** Listeners for the UI layer, so the panel does not subscribe separately. */
  private readonly userListeners = new Set<(user: LegionUser | null) => void>();

  constructor(host: BloxityHost) {
    this.host = host;
  }

  /**
   * Hand the bridge to the game once it exists. The SDK is started at boot,
   * before any asset loads (emotes must register then), so settings that
   * fired before the game was built are applied again here.
   */
  setHost(host: BloxityHost): void {
    this.host = host;
    guard('settings.triggerAll', (api) => api.settings?.triggerAll?.());
  }

  /** Opens Boxity's leaderboard panel; false outside Boxity. */
  openLeaderboard(board: string): boolean {
    return guard('leaderboard.open', (api) => api.leaderboard?.open?.(board) ?? false) ?? false;
  }

  /** True when the SDK script actually loaded. */
  get available(): boolean {
    return sdk() !== null;
  }

  get embedded(): boolean {
    return guard('portal.isEmbeddedInLegion', (api) =>
      api.portal?.isEmbeddedInLegion?.() ?? false,
    ) ?? false;
  }

  /**
   * Initialise ONCE, before any namespace is used.
   *
   * The slug is passed even when embedded, where the portal supplies one
   * anyway: standalone hosting is resolved by it, and
   * a build that only worked inside the iframe would be a build that stopped
   * working the moment it was hosted on its own domain.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const api = sdk();
    if (!api) {
      logger.warn(
        SCOPE,
        'SDK not present - running without the portal. Auth, friends, ' +
          'cosmetics are unavailable; the game itself is unaffected.',
      );
      // The auth UI still needs telling, or it would sit on "loading" for ever.
      this.emitUser(null);
      return;
    }

    guard('init', () => api.init({ gameSlug: GAME_SLUG }));
    // Leaderboards are declared in the browser even though the server reports
    // the scores: the declaration is what shows Boxity's trophy button.
    guard('leaderboard.define', (sdkApi) => sdkApi.leaderboard?.define?.(LEADERBOARDS));
    // Ad breaks, subscribed once right after init: Boxity may start one at any time.
    this.keep(guard('ads.onBreakStart', (sdkApi) => sdkApi.ads?.onBreakStart?.(() => this.host.adBreak(true))));
    this.keep(guard('ads.onBreakEnd', (sdkApi) => sdkApi.ads?.onBreakEnd?.(() => this.host.adBreak(false))));
    // Emotes: registered at BOOT, before any asset loads - the portal shows its
    // emote button only for games that have registered. The game builds no emote
    // UI of its own for these; it only plays what the portal sends.
    guard('game.registerFeature', (sdkApi) => sdkApi.game?.registerFeature?.('emotes'));
    void loadBloxityEmotes();
    logger.info(
      SCOPE,
      `SDK initialised as "${GAME_SLUG}" (${this.embedded ? 'embedded' : 'standalone'})`,
    );

    // Embedded games learn their environment from the portal handshake, which can land after init.
    this.keep(
      guard('onEnvironmentChanged', (sdkApi) =>
        sdkApi.onEnvironmentChanged?.((next) => {
          logger.info(SCOPE, `environment changed: ${String((next as { env?: string })?.env ?? '?')}`);
          for (const listener of this.environmentListeners) {
            try {
              listener();
            } catch (error) {
              logger.warn(SCOPE, `environment listener failed: ${String(error)}`);
            }
          }
        }),
      ),
    );

    this.watchUser();
    this.watchAvatar();
    this.watchSettings();
    this.watchPlayerEvents();
    this.watchChat();
  }

  /** THE chat subscription (subscribing is the opt-in), for the whole session. */
  private watchChat(): void {
    this.keep(
      guard('chat.onMessage', (api) =>
        api.chat?.onMessage?.((message) => {
          try {
            this.host.chatMessage(message);
          } catch (error) {
            logger.warn(SCOPE, `chat bubble failed: ${String(error)}`);
          }
        }),
      ),
    );
  }

  /**
   * Show a chat message over a character: Boxity's own camera-facing bubble,
   * which replaces the previous one on that character and fades after
   * `bubbleSeconds`. Cosmetic: never throws.
   */
  attachChatBubble(three: unknown, target: unknown, message: LegionChatMessage, height: number): void {
    guard('chat.attachBubble', (api) => {
      const chat = api.chat;
      if (!chat) return;
      chat.attachBubble(three, target, chat.bubbleText(message), { height });
    });
  }

  // ------------------------------------------------------------------ auth

  getUser(): LegionUser | null {
    return guard('auth.getUser', (api) => api.auth?.getUser?.() ?? null) ?? null;
  }

  /**
   * Who the portal says an unauthenticated visitor is.
   *
   * Null once they sign in, when `getUser` answers instead. The portal names
   * its guests and draws them a portrait, so this is a REAL identity and not
   * a placeholder - which is why the game shows it rather than calling
   * everybody who has not logged in the same thing.
   *
   * Optional on the SDK, because older builds predate it.
   */
  getGuest(): LegionUser | null {
    return guard('auth.getGuest', (api) => api.auth?.getGuest?.() ?? null) ?? null;
  }

  getToken(): string | null {
    return guard('auth.getToken', (api) => api.auth?.getToken?.() ?? null) ?? null;
  }

  isLoggedIn(): boolean {
    return guard('auth.isLoggedIn', (api) => api.auth?.isLoggedIn?.() ?? false) ?? false;
  }

  async showAuthPopup(): Promise<LegionUser | null> {
    const result = guard('auth.showAuthPopup', (api) => api.auth?.showAuthPopup?.());
    return (await result) ?? null;
  }

  logout(): void {
    guard('auth.logout', (api) => api.auth?.logout?.());
  }

  /**
   * Subscribe to the auth state.
   *
   * Fans out from the ONE `onUserChanged` this class owns, and fires
   * immediately with the current state exactly as the SDK's own does - so a
   * subscriber written against this cannot tell the difference, and there is
   * still only one subscription to the SDK.
   */
  onUserChanged(callback: (user: LegionUser | null) => void): () => void {
    this.userListeners.add(callback);
    callback(this.getUser());
    return () => this.userListeners.delete(callback);
  }

  // ---------------------------------------------------------------- avatar

  getEquipped(): LegionEquipped {
    return guard('avatar.getEquipped', (api) => api.avatar?.getEquipped?.()) ?? {};
  }

  getProportions(): LegionProportions {
    return (
      guard('avatar.getProportions', (api) => api.avatar?.getProportions?.()) ?? {
        height: 1,
        shoulderWidth: 1,
        armLength: 1,
        legOffsetX: 1,
        torsoScaleX: 1,
        neckHeight: 1,
        headScale: 1,
      }
    );
  }

  async setProportions(partial: Partial<LegionProportions>): Promise<void> {
    await guard('avatar.setProportions', (api) => api.avatar?.setProportions?.(partial));
  }

  async resetProportions(): Promise<void> {
    await guard('avatar.resetProportions', (api) => api.avatar?.resetProportions?.());
  }

  showCustomizer(): void {
    guard('avatar.showCustomizer', (api) => api.avatar?.showCustomizer?.());
  }

  toggleCustomizer(): void {
    guard('avatar.toggleCustomizer', (api) => api.avatar?.toggleCustomizer?.());
  }

  // ---------------------------------------------------------------- social

  async getFriends(): Promise<LegionFriend[]> {
    const friends = await guard('social.getFriends', (api) => api.social?.getFriends?.());
    return friends ?? [];
  }

  /**
   * Invite a friend into THIS room.
   *
   * The room is published first, deliberately: an invite sent before the
   * portal knows which room we are in sends the friend to the game rather
   * than to the player, which is the whole point of the invite.
   */
  async inviteFriend(userId: string, roomId: string): Promise<boolean> {
    this.updateRoom(roomId);
    const sent = await guard('social.inviteFriend', (api) =>
      api.social?.inviteFriend?.(userId),
    );
    return sent ?? false;
  }

  getInviteLink(roomId: string): string {
    return (
      guard('social.getInviteFriendsLink', (api) =>
        api.social?.getInviteFriendsLink?.({ gameSlug: GAME_SLUG, roomId }),
      ) ?? ''
    );
  }

  async sendFriendRequest(userId: string): Promise<boolean> {
    const result = await guard('social.sendFriendRequest', (api) =>
      api.social?.sendFriendRequest?.(userId),
    );
    return result?.success ?? false;
  }

  // ------------------------------------------------------------------ ads

  /** True when Boxity can show a rewarded ad right now (false outside Boxity). */
  adsAvailable(): boolean {
    return guard('ads.isAvailable', (api) => api.ads?.isAvailable?.() ?? false) ?? false;
  }

  /** A rewarded ad. Grant ONLY on status 'completed' (the server verifies the token). */
  async showRewarded(placement: string): Promise<LegionRewardedResult> {
    try {
      const result = await guard('ads.showRewarded', (api) => api.ads?.showRewarded?.(placement));
      return result ?? { status: 'disabled' };
    } catch (error) {
      logger.warn(SCOPE, `rewarded ad failed: ${String(error)}`);
      return { status: 'error' };
    }
  }

  /** Edge banners for a screen; a new call replaces the last. Null outside Boxity. */
  adScreen(type: LegionAdScreenType, options: LegionAdScreenOptions): LegionAdScreenHandle | null {
    return guard('ads.screen', (api) => api.ads?.screen?.(type, options) ?? null) ?? null;
  }

  hideAdScreen(): void {
    guard('ads.hideScreen', (api) => api.ads?.hideScreen?.());
  }

  /** The areas the portal occupies (toolbar, chat, banners); fires at once, then on change. */
  onReservedAreasChange(callback: (areas: LegionReservedArea[]) => void): () => void {
    return guard('ui.onReservedAreasChange', (api) => api.ui?.onReservedAreasChange?.(callback)) ?? (() => undefined);
  }

  // ------------------------------------------------------------- lifecycle

  loadingStep(text: string): void {
    guard('game.loadingStep', (api) => api.game?.loadingStep?.(text));
  }

  loadingEnd(): void {
    guard('game.loadingEnd', (api) => api.game?.loadingEnd?.());
  }

  gameplayStart(): void {
    guard('game.gameplayStart', (api) => api.game?.gameplayStart?.());
  }

  gameplayEnd(): void {
    guard('game.gameplayEnd', (api) => api.game?.gameplayEnd?.());
  }

  /** The Colyseus room id, or '' in a menu. */
  updateRoom(roomId: string, partyId?: string): void {
    guard('game.updateRoom', (api) => api.game?.updateRoom?.(roomId, partyId));
  }

  playerJoined(username: string): void {
    guard('game.playerJoined', (api) => api.game?.playerJoined?.(username));
  }

  playerInRoom(username: string): void {
    guard('game.playerInRoom', (api) => api.game?.playerInRoom?.(username));
  }

  /** Hand ESC to the portal's own pause menu. */
  showPortalMenu(lockCursorOnResume = true): void {
    guard('portal.showMenu', (api) => api.portal?.showMenu?.(lockCursorOnResume));
  }

  dispose(): void {
    for (const off of this.unsubscribes) {
      try {
        off();
      } catch {
        /* an unsubscribe that throws must not stop the others */
      }
    }
    this.unsubscribes.length = 0;
    this.userListeners.clear();
    this.gameplayEnd();
  }

  // --------------------------------------------------------- subscriptions

  private readonly environmentListeners: (() => void)[] = [];

  /** Called when an embedded game is told its environment after init (the portal handshake). */
  onEnvironmentChanged(listener: () => void): void {
    this.environmentListeners.push(listener);
  }

  private keep(off: (() => void) | undefined): void {
    if (typeof off === 'function') this.unsubscribes.push(off);
  }

  private emitUser(user: LegionUser | null): void {
    for (const listener of this.userListeners) {
      try {
        listener(user);
      } catch (error) {
        logger.warn(SCOPE, `user listener failed: ${String(error)}`);
      }
    }
  }

  /**
   * THE auth subscription. There is exactly one, and this is it.
   *
   * It fires immediately with the current state and then on every login and
   * logout, which is why nothing else in the game needs to poll `getUser()` on
   * a timer or re-check it on a frame.
   */
  private watchUser(): void {
    this.keep(
      guard('auth.onUserChanged', (api) =>
        api.auth?.onUserChanged?.((user) => {
          logger.info(
            SCOPE,
            user ? `signed in as @${user.username}` : 'signed out',
          );
          this.emitUser(user);
          // Cosmetics belong to the account, so a new account is a new player.
          if (user) this.pushAvatar();
        }),
      ),
    );
  }

  private watchAvatar(): void {
    this.keep(
      guard('avatar.onAvatarChanged', (api) =>
        api.avatar?.onAvatarChanged?.(() => this.pushAvatar()),
      ),
    );
    this.keep(
      guard('avatar.onProportionsChanged', (api) =>
        api.avatar?.onProportionsChanged?.(() => this.pushAvatar()),
      ),
    );
  }

  private pushAvatar(): void {
    this.host.avatarChanged(this.getEquipped(), this.getProportions());
  }

  /**
   * Register every setting, and apply it.
   *
   * `listen` fires immediately with the current value, so registering IS
   * applying - there is no separate "read them all at startup" pass to fall
   * out of step with the listeners.
   */
  private watchSettings(): void {
    for (const key of SETTING_KEYS) {
      this.keep(
        guard(`settings.listen(${key})`, (api) =>
          api.settings?.listen?.(key, (value) => this.applySetting(key, value)),
        ),
      );
    }
    // A belt to the braces: some portal builds only deliver values on demand.
    guard('settings.triggerAll', (api) => api.settings?.triggerAll?.());
  }

  private applySetting(key: SettingKey, value: string): void {
    switch (key) {
      case 'master_volume':
        this.host.setMasterVolume(asFraction(value, 0.8));
        break;
      case 'music_volume':
        this.host.setMusicVolume(asFraction(value, 0.8));
        break;
      case 'graphics_quality':
        this.host.setGraphicsQuality(value);
        break;
      case 'show_fps':
        this.host.setShowFps(asBool(value));
        break;
      case 'camera_sensitivity':
        this.host.setCameraSensitivity(asNumber(value, 1));
        break;
      case 'fullscreen':
        guard('portal.fullscreen', (api) => {
          if (asBool(value)) api.portal?.requestFullscreen?.();
          else api.portal?.exitFullscreen?.();
        });
        break;
      case 'enable_chat':
      case 'background_transparency':
        // Declared so the portal shows the control; the portal owns the chat
        // panel and the overlay it draws, so there is nothing to apply here.
        break;
    }
  }

  private watchPlayerEvents(): void {
    this.keep(
      guard('player.onEvent', (api) =>
        api.player?.onEvent?.((event: LegionPlayerEvent, data?: unknown) => {
          switch (event) {
            case 'respawn_request':
              this.host.respawn();
              break;
            case 'pointer_lock_changed':
              this.host.pointerLockChanged(data === true);
              break;
            case 'play_emote':
              // Cosmetic: an unknown id is ignored downstream, and nothing here may throw.
              try {
                if (typeof data === 'string') this.host.playEmote(data);
              } catch (error) {
                logger.warn(SCOPE, `play_emote failed: ${String(error)}`);
              }
              break;
            case 'chat_message_sent':
              // The portal draws the chat; bubbles arrive through chat.onMessage.
              break;
          }
        }),
      ),
    );
  }
}
