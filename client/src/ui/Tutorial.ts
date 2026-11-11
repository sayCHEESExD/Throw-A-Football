import { TUTORIAL_STEPS } from '@mctf/shared';
import { $, esc, html } from './dom.js';

interface Step {
  title: string;
  text: string;
  touchText?: string;
  /** Button label (none = waits for the action). */
  button?: string;
  /** What the button does: 'next' advances, otherwise the event it fires. */
  buttonDoes?: string;
  /** Element the yellow arrow points at. */
  target?: string;
  /** Event that completes the step. */
  on: string;
  /** Where the step shows. */
  where: 'lobby' | 'panel' | 'any';
}

const STEPS: readonly Step[] = [
  { title: 'WELCOME, QB!', text: "Throw, score and collect players. Let's go!", button: "LET'S GO!", buttonDoes: 'next', on: 'next', where: 'lobby' },
  { title: 'THROW!', text: 'Aim the circle at a golden ring. Click twice to throw through it!', touchText: 'Aim the circle at a golden ring. Tap THROW twice to throw through it!', on: 'ring', where: 'lobby' },
  { title: 'RING STREAK', text: 'Rings in a row build a streak and pay cash. Hit 3 in a row!', button: 'Skip', buttonDoes: 'next', on: 'streak3', where: 'lobby' },
  { title: 'GET STRONGER', text: 'Spend your cash! Click Upgrades.', button: 'Open it!', buttonDoes: 'open:upgrades', target: '[data-open="upgrades"]', on: 'open:upgrades', where: 'lobby' },
  { title: 'BUY ACCURACY', text: 'Buy an Accuracy upgrade for tighter spirals.', button: 'Next', buttonDoes: 'next', target: '.up-accuracy .buy', on: 'upgrade', where: 'panel' },
  { title: 'YOUR TEAM', text: 'Your players catch and block for you. Click Cards!', button: 'Open Cards!', buttonDoes: 'open:cards', target: '[data-open="cards"]', on: 'open:cards', where: 'lobby' },
  { title: 'EQUIP HIM!', text: 'Click Equip Best to put your best players in.', button: 'Equip Best!', buttonDoes: 'equipBest', target: '.equip-best', on: 'equipBest', where: 'panel' },
  { title: 'PLAY!', text: 'Click PLAY to start your first game!', button: 'Play!', buttonDoes: 'play', target: '.play-btn', on: 'play', where: 'lobby' },
  { title: "YOU'RE READY!", text: 'Win matches, collect players, get stronger!', button: 'OK', buttonDoes: 'next', on: 'next', where: 'lobby' },
];

/** The 9-step tutorial box with its bouncing arrow. */
export class Tutorial {
  private readonly box: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly tip: HTMLElement;
  private step = TUTORIAL_STEPS;
  private shown = -1;

  constructor(
    private readonly onAdvance: (step: number) => void,
    private readonly onButton: (does: string) => void,
    private readonly touch: boolean,
  ) {
    this.box = html(`<div class="tut hidden"><h3 class="t"></h3><p class="t"></p><div class="tut-foot"><span class="n t"></span><button class="btn green t tut-btn"></button><kbd class="hk tut-hk">Enter</kbd></div></div>`);
    this.arrow = html(
      `<div class="tut-arrow hidden"><svg viewBox="0 0 64 48" width="64" height="48"><path d="M4 16h30V4l26 20-26 20V32H4z" fill="#ffe23a" stroke="#0b0f22" stroke-width="4" stroke-linejoin="round"/></svg></div>`,
    );
    this.tip = html(`<div class="tip hidden"><b class="t">TIP</b><span class="t">Press Ctrl or C to free your mouse and click buttons.</span></div>`);
    document.body.append(this.box, this.arrow, this.tip);
    $(this.box, '.tut-btn').addEventListener('click', () => {
      const s = STEPS[this.step];
      if (!s?.buttonDoes) return;
      if (s.buttonDoes === 'next') this.advance();
      else this.onButton(s.buttonDoes);
    });
  }

  /** Enter presses the tutorial box's button (while it is showing). */
  pressButton(): boolean {
    const b = $(this.box, '.tut-btn');
    if (this.box.classList.contains('hidden') || b.classList.contains('hidden')) return false;
    b.click();
    return true;
  }

  get active(): boolean {
    return this.step < TUTORIAL_STEPS;
  }

  /** The server's saved step. */
  setStep(step: number): void {
    if (step > this.step || this.step >= TUTORIAL_STEPS) this.step = step;
  }

  restart(): void {
    this.step = 0;
  }

  /** Something happened in the game; completes the current step if it matches. */
  event(e: string): void {
    const s = STEPS[this.step];
    if (s && s.on === e) this.advance();
  }

  private advance(): void {
    this.step += 1;
    this.onAdvance(this.step);
  }

  /** Called every frame. */
  update(mode: 'lobby' | 'match', panel: string, locked: boolean): void {
    const s = this.active ? STEPS[this.step] : undefined;
    // Lobby steps wait until no menu is open; panel steps show over their menu.
    const visible = !!s && mode === 'lobby' && (s.where === 'any' || (s.where === 'panel' ? !!panel : !panel));
    this.box.classList.toggle('hidden', !visible);
    this.box.classList.toggle('low', !!s && s.where === 'panel');
    if (!visible || !s) {
      this.arrow.classList.add('hidden');
      this.tip.classList.add('hidden');
      return;
    }
    if (this.shown !== this.step) {
      this.shown = this.step;
      $(this.box, 'h3').textContent = s.title;
      $(this.box, 'p').innerHTML = esc(this.touch && s.touchText ? s.touchText : s.text);
      $(this.box, '.n').textContent = `${this.step + 1} / ${TUTORIAL_STEPS}`;
      const b = $(this.box, '.tut-btn');
      b.classList.toggle('hidden', !s.button);
      $(this.box, '.tut-hk').classList.toggle('hidden', !s.button || this.touch);
      b.textContent = s.button ?? '';
      this.box.classList.remove('pop');
      void this.box.offsetWidth;
      this.box.classList.add('pop');
    }
    // Point at the target.
    const el = s.target ? (document.querySelector(s.target) as HTMLElement | null) : null;
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0) {
      this.arrow.classList.remove('hidden');
      const right = r.left > window.innerWidth / 2;
      this.arrow.classList.toggle('flip', right);
      this.arrow.style.top = `${r.top + r.height / 2}px`;
      this.arrow.style.left = right ? `${r.left - 8}px` : `${r.right + 8}px`;
    } else {
      this.arrow.classList.add('hidden');
    }
    this.tip.classList.toggle('hidden', !(locked && !!s.target && s.where === 'lobby'));
  }
}
