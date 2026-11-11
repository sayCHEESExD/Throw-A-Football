import { createServer, type Server } from 'node:http';
import { matchMaker } from '@colyseus/core';
import { ROOM_NAME } from '@mctf/shared';
import { profileStore } from './persistence/store.js';

/** One HTTP server for the WebSocket upgrade and the host's /health probe. */
export const createHttpServer = (): Server =>
  createServer((request, response) => {
    if (request.method === 'GET' && (request.url ?? '').split('?')[0] === '/health') {
      void (async () => {
        let rooms = 0;
        let players = 0;
        try {
          const live = await matchMaker.query({ name: ROOM_NAME });
          rooms = live.length;
          for (const room of live) players += room.clients;
        } catch {
          /* a health probe never fails on a count */
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, room: ROOM_NAME, rooms, players, storage: profileStore.kind }));
      })();
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });
