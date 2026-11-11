/**
 * The playbook.
 *
 * Every play uses the same three eligible receivers. Slot 0 lines up wide
 * left, slot 1 is the tight end on the right, slot 2 is wide right; each slot
 * always draws its route in the same colour so a player learns who is who.
 *
 * A route is a list of waypoints in YARDS, relative to where that receiver
 * lines up (x = lateral, + is to the QB's right when facing downfield; z =
 * downfield). After the last waypoint the receiver keeps running in the
 * direction of the last leg, unless the route ends in a `hold` (a hitch or a
 * curl: he settles and waits for the ball).
 */
export interface RouteDef {
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly hold?: boolean;
}

export interface PlayDef {
  readonly id: string;
  readonly name: string;
  /** Alignment x (yards from the ball) for slots 0..2. */
  readonly align: readonly [number, number, number];
  readonly routes: readonly [RouteDef, RouteDef, RouteDef];
}

export const RECEIVER_SLOTS = 3;
/** Route colours for slots 0..2: cyan, yellow, pink. */
export const ROUTE_COLORS: readonly [number, number, number] = [0x38e8ff, 0xffe23a, 0xff5fc8];
export const RECEIVER_POSITIONS: readonly [string, string, string] = ['WR', 'TE', 'WR'];

const STD: readonly [number, number, number] = [-17, 6.5, 17];

export const PLAYBOOK: readonly PlayDef[] = [
  {
    id: 'slants',
    name: 'SLANTS',
    align: STD,
    routes: [
      { points: [[0, 3], [7, 10]] },
      { points: [[0, 4], [-6, 10]] },
      { points: [[0, 3], [-7, 10]] },
    ],
  },
  {
    id: 'posts',
    name: 'POSTS',
    align: STD,
    routes: [
      { points: [[0, 11], [7, 22]] },
      { points: [[0, 5], [8, 6]] },
      { points: [[0, 11], [-7, 22]] },
    ],
  },
  {
    id: 'smash',
    name: 'SMASH',
    align: STD,
    routes: [
      { points: [[0, 6], [0.5, 5]], hold: true },
      { points: [[0, 9], [8, 17]] },
      { points: [[0, 6], [-0.5, 5]], hold: true },
    ],
  },
  {
    id: 'flood',
    name: 'FLOOD',
    align: [-17, 6.5, 15],
    routes: [
      { points: [[0, 4], [18, 12], [26, 14]] },
      { points: [[0, 2], [9, 3]] },
      { points: [[0, 26]] },
    ],
  },
  {
    id: 'verts',
    name: 'VERTICALS',
    align: STD,
    routes: [
      { points: [[0, 30]] },
      { points: [[0, 30]] },
      { points: [[0, 30]] },
    ],
  },
  {
    id: 'mesh',
    name: 'MESH',
    align: [-15, 6.5, 15],
    routes: [
      { points: [[0, 2], [26, 5]] },
      { points: [[0, 7]], hold: true },
      { points: [[0, 4], [-26, 7]] },
    ],
  },
  {
    id: 'curls',
    name: 'CURLS',
    align: STD,
    routes: [
      { points: [[0, 10], [1, 8.5]], hold: true },
      { points: [[0, 3], [9, 4]] },
      { points: [[0, 10], [-1, 8.5]], hold: true },
    ],
  },
  {
    id: 'outs',
    name: 'OUTS',
    align: [-14, 6.5, 14],
    routes: [
      { points: [[0, 7], [-7, 7]] },
      { points: [[0, 11], [7, 11]] },
      { points: [[0, 7], [7, 7]] },
    ],
  },
  {
    id: 'sail',
    name: 'SAIL',
    align: [-17, 6.5, 17],
    routes: [
      { points: [[0, 6], [7, 12]] },
      { points: [[0, 9], [9, 13]] },
      { points: [[0, 22]] },
    ],
  },
  {
    id: 'drive',
    name: 'DRIVE',
    align: [-16, 6.5, 16],
    routes: [
      { points: [[0, 3], [24, 6]] },
      { points: [[0, 11], [-10, 12]] },
      { points: [[0, 12], [0, 10]], hold: true },
    ],
  },
];

export const playById = (id: string): PlayDef => PLAYBOOK.find((p) => p.id === id) ?? (PLAYBOOK[0] as PlayDef);

/**
 * The route's waypoints in yards relative to the line of scrimmage at the
 * ball, starting at the receiver's alignment, plus an extension leg (unless
 * it holds) so the drawn arrow shows where he keeps running.
 */
export const routePath = (play: PlayDef, slot: number, ballX: number, extend = 5): Array<[number, number]> => {
  const route = play.routes[slot] as RouteDef;
  const ax = (play.align[slot] as number) + ballX;
  const start: [number, number] = [ax, slot === 1 ? -1.2 : -0.6];
  const out: Array<[number, number]> = [start];
  for (const [dx, dz] of route.points) out.push([ax + dx, start[1] + dz]);
  if (!route.hold && extend > 0 && out.length >= 2) {
    const a = out[out.length - 2] as [number, number];
    const b = out[out.length - 1] as [number, number];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push([b[0] + ((b[0] - a[0]) / len) * extend, b[1] + ((b[1] - a[1]) / len) * extend]);
  }
  return out;
};

/** Pick the next play: random, never the same one twice in a row. */
export const nextPlayId = (previous: string, random: () => number = Math.random): string => {
  const pool = PLAYBOOK.filter((p) => p.id !== previous);
  return (pool[Math.floor(random() * pool.length)] ?? PLAYBOOK[0])!.id;
};
