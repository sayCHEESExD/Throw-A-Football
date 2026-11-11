import { devServerUrl } from '../bloxity/environment.js';

/**
 * Runtime configuration for the client.
 *
 * Which Boxity environment the page runs in is never decided here from a
 * hostname, the referrer or a build flag: the platform tells it (see
 * `bloxity/environment.ts`). The only direct game-server socket is the one the
 * LOCAL dev server injects; every deployed page joins through the Boxity
 * matchmaker (`Legion.SDK.net.resolveEndpoint`).
 */
export interface ClientConfig {
  /** A direct game-server socket, for LOCAL DEVELOPMENT only. Empty in every production build. */
  readonly serverUrl: string;
  /** True when joins go through the Boxity matchmaker (every deployed page). */
  readonly matchmaker: boolean;
  /** Verbose console diagnostics. */
  readonly debug: boolean;
  /** Cap on devicePixelRatio, to protect mobile GPUs. */
  readonly maxPixelRatio: number;
}

const serverUrl = devServerUrl();

export const clientConfig: ClientConfig = {
  serverUrl,
  matchmaker: serverUrl === '',
  debug: import.meta.env.DEV || import.meta.env['VITE_DEBUG'] === '1',
  maxPixelRatio: 2,
};
