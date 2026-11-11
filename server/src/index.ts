import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@mctf/shared';
import { boxityServerEnv } from './config/boxityEnv.js';
import { serverConfig } from './config/serverConfig.js';
import { createHttpServer } from './httpServer.js';
import { installRoomReporter } from './legion-room-reporter.js';
import { installBloxityReporting } from './bloxity/reporting.js';
import { profileStore } from './persistence/store.js';
import { FootballRoom } from './rooms/FootballRoom.js';
import { logger } from './util/logger.js';

const SCOPE = 'server';

const boot = async (): Promise<void> => {
  await profileStore.open();
  // `gracefullyShutdown: false`: Colyseus would otherwise trap SIGTERM itself and
  // exit as soon as the rooms are disposed, racing the drain below (rooms let a
  // match in progress finish; see FootballRoom.onBeforeShutdown).
  const gameServer = new Server({ transport: new WebSocketTransport({ server: createHttpServer() }), greet: false, gracefullyShutdown: false });
  gameServer.define(ROOM_NAME, FootballRoom);
  await gameServer.listen(serverConfig.port, serverConfig.host);
  logger.info(SCOPE, `listening on ${serverConfig.host}:${serverConfig.port} room="${ROOM_NAME}" storage=${profileStore.kind} game=${serverConfig.gameSlug} env=${boxityServerEnv.env}`);
  const stopReporting = installRoomReporter();
  const flushBloxity = installBloxityReporting();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    stopReporting();
    logger.info(SCOPE, `received ${signal}, shutting down`);
    void (async () => {
      try {
        await gameServer.gracefullyShutdown(false);
      } catch (error) {
        logger.error(SCOPE, 'graceful shutdown failed:', error);
      }
      await flushBloxity();
      await profileStore.flush();
      await profileStore.close().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // What Colyseus' own handler did on a crash: log it, save everyone, exit.
  process.on('uncaughtException', (error) => {
    logger.error(SCOPE, 'uncaught exception:', error);
    shutdown('uncaughtException');
  });
};

process.on('exit', () => profileStore.flushSync());

boot().catch((error: unknown) => {
  logger.error(SCOPE, 'failed to start', error);
  process.exit(1);
});
