/** Made-up names for the computer-controlled players. */
const FIRST = 'ABCDEFGHIJKLMNOPRSTVWZ';
const LAST = [
  'Banks', 'Carver', 'Dale', 'Easton', 'Fischer', 'Gaines', 'Holt', 'Irving', 'Jensen', 'Kaplan', 'Lowe', 'Mercer', 'Nash',
  'Oduya', 'Pryor', 'Quill', 'Ramos', 'Sato', 'Trent', 'Upton', 'Vance', 'Webb', 'Yates', 'Zane', 'Abara', 'Brooks', 'Cruz',
  'Dorsey', 'Ellis', 'Flint', 'Grady', 'Hale', 'Ibarra', 'Jett', 'Kemp', 'Lyle', 'Moss', 'Nolan', 'Okafor', 'Pike', 'Reyes',
  'Stone', 'Tate', 'Vega', 'Wolfe', 'Young', 'Archer', 'Boone', 'Cole', 'Drake', 'Frost', 'Hayes', 'Knox', 'Lane', 'Park',
];

export const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

export interface RosterEntry {
  name: string;
  short: string;
  num: number;
}

export const makeRoster = (seed: number, numbers: number[]): RosterEntry[] => {
  const r = seeded(seed);
  const used = new Set<string>();
  return numbers.map((num) => {
    let last = '';
    do last = LAST[Math.floor(r() * LAST.length)] as string;
    while (used.has(last) && used.size < LAST.length);
    used.add(last);
    const first = FIRST[Math.floor(r() * FIRST.length)] as string;
    return { name: `${first}. ${last}`, short: last, num };
  });
};
