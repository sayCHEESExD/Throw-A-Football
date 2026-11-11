import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_BLOXITY_GAME_SLUG, DEFAULT_SERVER_PORT, SERVER_TICK_RATE } from '@mctf/shared';

/** Runtime server configuration, overridable by environment variables. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly tickRate: number;
  /** Milliseconds between state patches sent to clients. */
  readonly patchRateMs: number;
  /**
   * Directory holding the JSON dev store (`profiles.json`, `grants.json`),
   * and the legacy `profiles.json` a Mongo deployment imports on boot.
   */
  readonly dataDir: string;
  /**
   * The managed MongoDB Legion injects (`MONGODB_URI`), or '' to use the JSON
   * file in `dataDir`. Set on every Bloxity pod; unset on a laptop.
   */
  readonly mongoUri: string;
  /**
   * The game's slug on Bloxity: what a token is verified AGAINST. Legion
   * injects `BLOXITY_GAME_ID`; a local server falls back to the registered
   * slug.
   */
  readonly gameSlug: string;
  /** This process, for grant leases and logs. Legion injects `POD_NAME`. */
  readonly podName: string;
  /** Test cheats (the `dev` message). Only with MCTF_DEV_CHEATS=1 and never in production. */
  readonly devCheats: boolean;
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * `--port N` from the command line.
 *
 * Takes precedence over `PORT`, and the dev script passes it. That order
 * matters: a dev harness that hosts the CLIENT often exports `PORT` for its
 * own web server, and without an explicit override the game server silently
 * binds to the same port - which looks like a working server and a client that
 * cannot reach it. Managed hosts have no argv to pass, so `PORT` still wins in
 * production, which is exactly where it should.
 */
const portArgument = (): string | undefined => {
  const at = process.argv.indexOf('--port');
  return at >= 0 ? process.argv[at + 1] : undefined;
};

export const serverConfig: ServerConfig = {
  port: int(portArgument() ?? process.env['PORT'], DEFAULT_SERVER_PORT),
  host: process.env['HOST'] ?? '0.0.0.0',
  tickRate: SERVER_TICK_RATE,
  patchRateMs: 1000 / SERVER_TICK_RATE,
  // Relative to the server package, which is the working directory for both
  // `npm run dev` and `npm start`, so a restart finds the same file either way.
  dataDir: resolve(process.env['MCTF_DATA_DIR'] ?? 'data'),
  mongoUri: (process.env['MONGODB_URI'] ?? '').trim(),
  gameSlug: (process.env['BLOXITY_GAME_ID'] ?? '').trim() || DEFAULT_BLOXITY_GAME_SLUG,
  podName: (process.env['POD_NAME'] ?? '').trim() || `${hostname()}:${process.pid}`,
  devCheats: (process.env['MCTF_DEV_CHEATS'] === '1' || process.argv.includes('--dev-cheats')) && process.env['NODE_ENV'] !== 'production',
};
