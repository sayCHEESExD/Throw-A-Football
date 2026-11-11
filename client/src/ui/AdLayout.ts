import type { Bloxity } from '../bloxity/Bloxity.js';
import type { LegionAdPosition, LegionAdScreenType, LegionReservedArea } from '../bloxity/legionTypes.js';

/**
 * Boxity's screen banners, and keeping the game's UI out of their way.
 *
 * Banners sit along the edges and corners. Two things keep them off the
 * game's menus and panels at every screen size:
 *  - the positions this game's own UI lives in are skipped per screen;
 *  - the areas Boxity reports as taken (`ui.onReservedAreasChange`) become
 *    CSS insets that the HUD and the panels are laid out inside.
 *
 * A screen is sent only when it actually changes (or the layout does, on a
 * resize), and never while a rewarded ad is pending.
 */
export class AdLayout {
  private current: LegionAdScreenType | null = null;
  private sentKey = '';
  private rewardPending = false;
  private resizeTimer = 0;

  constructor(private readonly bloxity: Bloxity, private readonly touch: boolean) {
    bloxity.onReservedAreasChange((areas) => this.applyInsets(areas));
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.send(true), 250);
    });
  }

  /** The screen the game is on now ('null' = gameplay, no banners). */
  set(screen: LegionAdScreenType | null): void {
    this.current = screen;
    this.send(false);
  }

  /** Wrap a rewarded ad: no screen calls until it resolves, then re-send. */
  async rewarded<T>(show: () => Promise<T>): Promise<T> {
    this.rewardPending = true;
    try {
      return await show();
    } finally {
      this.rewardPending = false;
      this.send(true);
    }
  }

  private options(screen: LegionAdScreenType): { skip: LegionAdPosition[] } {
    const small = Math.min(window.innerWidth, window.innerHeight) < 520;
    // The PLAY button / scoreboard live top-centre; the menu column middle-left.
    const skip: LegionAdPosition[] = ['top-center'];
    if (screen === 'menu' || screen === 'lobby') skip.push('middle-left');
    // Phones: the touch buttons own the bottom-right, the cash the bottom-left,
    // and side skyscrapers would cover half a landscape screen.
    if (this.touch) skip.push('bottom-right');
    if (small) skip.push('middle-left', 'middle-right', 'bottom-left');
    return { skip: [...new Set(skip)] };
  }

  private send(force: boolean): void {
    if (this.rewardPending) return;
    const screen = this.current;
    const key = screen ? `${screen}|${window.innerWidth}x${window.innerHeight}` : '';
    if (!force && key === this.sentKey) return;
    if (force && key === '' && this.sentKey === '') return;
    this.sentKey = key;
    if (screen) this.bloxity.adScreen(screen, this.options(screen));
    else this.bloxity.hideAdScreen();
  }

  /**
   * Turn the portal's occupied rectangles into layout variables.
   *
   * A rectangle that runs along most of an edge (a leaderboard-style
   * skyscraper, a full-width strip) becomes an inset for the whole HUD and
   * every panel. A box in a corner (Boxity's toolbar and chat, a 300x250)
   * only moves the HUD pieces anchored in that corner: `--res-tl` etc. is how
   * far down (top corners) or up (bottom corners) they must sit.
   */
  private applyInsets(areas: LegionReservedArea[]): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const v: Record<string, number> = { top: 0, right: 0, bottom: 0, left: 0, tl: 0, tr: 0, bl: 0, br: 0 };
    const grow = (key: string, size: number, cap: number): void => {
      v[key] = Math.max(v[key] ?? 0, Math.min(cap, size));
    };
    for (const a of areas ?? []) {
      if (!a || !(a.width > 0) || !(a.height > 0)) continue;
      const right = a.left + a.width;
      const bottom = a.top + a.height;
      if (a.height >= H * 0.5) {
        // A column along a side.
        if (a.left <= 8) grow('left', right, W * 0.3);
        else if (right >= W - 8) grow('right', W - a.left, W * 0.3);
        continue;
      }
      if (a.width >= W * 0.5) {
        // A strip along the top or bottom.
        if (a.top <= 8) grow('top', bottom, H * 0.3);
        else if (bottom >= H - 8) grow('bottom', H - a.top, H * 0.3);
        continue;
      }
      // A box: belongs to the corner its centre is nearest.
      const cx = a.left + a.width / 2 < W / 2 ? 'l' : 'r';
      const cy = a.top + a.height / 2 < H / 2 ? 't' : 'b';
      grow(`${cy}${cx}`, cy === 't' ? bottom : H - a.top, H * 0.6);
    }
    const root = document.documentElement.style;
    for (const [key, px] of Object.entries(v)) root.setProperty(`--res-${key}`, `${Math.round(px)}px`);
  }
}
