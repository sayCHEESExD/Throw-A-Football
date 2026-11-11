/**
 * Field geometry. The offense always attacks +Z.
 *
 * A yard line number runs 0 (own goal line) .. 100 (the goal line being
 * attacked). World Z for a yard line is (yardLine - 50) * YARD.
 */
export const YARD = 1.35;
export const FIELD_WIDTH_YARDS = 53.3;
export const FIELD_HALF_WIDTH = (FIELD_WIDTH_YARDS * YARD) / 2;
export const END_ZONE_YARDS = 10;
export const FIELD_HALF_LENGTH = (50 + END_ZONE_YARDS) * YARD;
/** Hash marks, yards from the middle of the field. */
export const HASH_YARDS = 6.2;

export const yardToZ = (yardLine: number): number => (yardLine - 50) * YARD;
export const zToYard = (z: number): number => z / YARD + 50;

/** Where a drive starts. */
export const DRIVE_START_YARD = 25;
export const FIRST_DOWN_YARDS = 10;
export const SACK_YARDS = 6;
export const MAX_DOWNS = 4;

/** The "1st and 10" / "3rd and Goal" label. */
export const downLabel = (down: number, toGo: number, yardLine: number): string => {
  const ord = ['1st', '2nd', '3rd', '4th'][Math.max(0, Math.min(3, down - 1))] ?? '1st';
  const goal = yardLine + toGo >= 100;
  return `${ord} and ${goal ? 'Goal' : Math.max(1, Math.round(toGo))}`;
};

/** The yard line as printed on the field ("OWN 25", "OPP 40", "50"). */
export const spotLabel = (yardLine: number): string => {
  const y = Math.round(yardLine);
  if (y === 50) return '50';
  return y < 50 ? `OWN ${y}` : `OPP ${100 - y}`;
};
