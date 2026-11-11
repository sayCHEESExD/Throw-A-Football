/**
 * THE BOXITY ENVIRONMENT, as the PLATFORM tells it.
 *
 * Boxity runs as prod, stage and local, and one build of this game runs
 * unchanged in all three. The game never works out which one it is in from
 * its own hostname, the referrer, a build flag or a URL: the SDK knows
 * (`Legion.SDK.environment()`, filled from `window.BLOXITY_ENV` that Boxity
 * injects into the pages it serves, or from the portal handshake), and code
 * that runs before the SDK loads reads `window.BLOXITY_ENV` here. Every Boxity
 * URL in the client is built from this.
 *
 * NO Boxity hostname is written into the build. The production fallback is the
 * SDK's own (it returns prod when nothing is told), and the SDK is loaded by a
 * script tag before this bundle. Only a page where even the SDK failed to load
 * gets the empty URLs below - and there the matchmaker is unreachable anyway,
 * so the catalogue and portrait fetches built from them simply fail quietly.
 */
export interface BoxityEnvironment {
  readonly env: 'prod' | 'stage' | 'local';
  readonly apiUrl: string;
  readonly playUrl: string;
  readonly portalUrl: string;
  readonly staticUrl: string;
}

const UNTOLD: BoxityEnvironment = {
  env: 'prod',
  apiUrl: '',
  playUrl: '',
  portalUrl: '',
  staticUrl: '',
};

declare global {
  interface Window {
    BLOXITY_ENV?: Partial<BoxityEnvironment>;
  }
}

const trim = (url: unknown, fallback: string): string => (typeof url === 'string' && url.trim() ? url.trim().replace(/\/+$/, '') : fallback);

const normalise = (told: Partial<BoxityEnvironment> | null | undefined): BoxityEnvironment => {
  if (!told || typeof told !== 'object') return UNTOLD;
  const env = told.env === 'stage' || told.env === 'local' ? told.env : 'prod';
  return {
    env,
    apiUrl: trim(told.apiUrl, UNTOLD.apiUrl),
    playUrl: trim(told.playUrl, UNTOLD.playUrl),
    portalUrl: trim(told.portalUrl, UNTOLD.portalUrl),
    staticUrl: trim(told.staticUrl, UNTOLD.staticUrl),
  };
};

/** The told environment: the SDK's (prod when nothing is told) when it is loaded, else `window.BLOXITY_ENV`. */
export const boxityEnvironment = (): BoxityEnvironment => {
  try {
    const sdk = window.Legion?.SDK as { environment?: () => Partial<BoxityEnvironment> } | undefined;
    if (sdk && typeof sdk.environment === 'function') return normalise(sdk.environment());
  } catch {
    /* fall through to the page's own copy */
  }
  return normalise(window.BLOXITY_ENV);
};

/**
 * LOCAL DEVELOPMENT ONLY: the Vite dev server injects `window.RC_DEV_SERVER`
 * (see vite.config.ts, apply: 'serve'), and the game then talks straight to
 * the local Colyseus server. A production build never carries it, so every
 * deployed page joins through the Boxity matchmaker.
 */
export const devServerUrl = (): string => {
  const url = (window as Window & { RC_DEV_SERVER?: unknown }).RC_DEV_SERVER;
  return typeof url === 'string' ? url : '';
};
