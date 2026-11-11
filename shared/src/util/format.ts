/** "$1.01K", "$20.2K", "$3.4M" - the cash pill's compact money. */
export const formatCash = (value: number): string => `$${formatCompact(value)}`;

export const formatCompact = (value: number): string => {
  const v = Math.floor(value);
  const abs = Math.abs(v);
  const units: [number, string][] = [
    [1e15, 'Q'],
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const n = v / size;
      const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
      return `${Number(n.toFixed(digits))}${suffix}`;
    }
  }
  return String(v);
};

export const isValidAccountId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** Clean a player-typed city name. */
export const cleanCityName = (raw: unknown, max: number): string =>
  String(raw ?? '')
    .replace(/[^\p{L}\p{N} '._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
