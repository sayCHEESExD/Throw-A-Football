/**
 * THE BOXITY ENVIRONMENT this deploy runs in, as Boxity hosting tells it.
 *
 * Hosting injects BLOXITY_ENV, BLOXITY_API_URL, BLOXITY_MATCHMAKER_URL,
 * BLOXITY_PORTAL_URL and BLOXITY_STATIC_URL on every deploy (prod or stage).
 * Every Boxity URL on the server is built from these; the production values
 * below are used only for a variable that is missing (local development).
 */
const told = (name: string, fallback: string): string => (process.env[name]?.trim() || fallback).replace(/\/+$/, '');

export const boxityServerEnv = {
  env: (process.env['BLOXITY_ENV']?.trim() || 'prod') as 'prod' | 'stage' | 'local',
  /** Which channel this pod serves (`prod` or `dev`), as Legion injects it. */
  channel: process.env['BLOXITY_CHANNEL']?.trim() || 'prod',
  apiUrl: told('BLOXITY_API_URL', 'https://api.bloxity.io'),
  matchmakerUrl: told('BLOXITY_MATCHMAKER_URL', 'https://play.bloxity.io'),
  portalUrl: told('BLOXITY_PORTAL_URL', 'https://bloxity.io'),
  staticUrl: told('BLOXITY_STATIC_URL', 'https://static.bloxity.io'),
} as const;
