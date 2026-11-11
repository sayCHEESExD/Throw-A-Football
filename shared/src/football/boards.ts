/**
 * Boxity leaderboards. The browser declares them (that shows Boxity's trophy
 * button); the server declares them again and reports the scores from state
 * it owns. Ids and settings are permanent once Boxity first sees them.
 */
export interface BoardDef {
  readonly id: string;
  readonly label: string;
  readonly order: 'desc' | 'asc';
  readonly mode: 'best' | 'sum' | 'latest';
  readonly format: 'number' | 'compact' | 'time';
  readonly reset: 'none' | 'daily' | 'weekly' | 'monthly';
}

/** Touchdowns scored: one per touchdown, resets every Monday, keeps All Time. */
export const TOUCHDOWN_BOARD: BoardDef = { id: 'touchdowns', label: 'Touchdowns', order: 'desc', mode: 'sum', format: 'number', reset: 'weekly' };

export const LEADERBOARDS: readonly BoardDef[] = [TOUCHDOWN_BOARD];

/** Rewarded-ad placement: double the cash from the game just won. */
export const AD_DOUBLE_PLACEMENT = 'double-earnings';
