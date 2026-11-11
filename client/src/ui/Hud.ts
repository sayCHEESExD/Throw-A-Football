import {
  CARDS,
  PACKS,
  PVP_REBIRTHS,
  RARITY,
  STYLE_BY_ID,
  cardsMultiplier,
  downLabel,
  fanMultiplier,
  levelFromFans,
  rebirthMultiplier,
  rewardText,
  stageInfo,
  stageReward,
  type Lineup,
  type MatchEndMessage,
  type MatchState,
  type PackId,
  type PackOpenedMessage,
  type ProfileMessage,
  type PvpMessage,
  type SpinResultMessage,
  type UpgradeId,
} from '@mctf/shared';
import iconAvatar from '../../../assets/ui/Avatar.png';
import iconShop from '../../../assets/ui/shop.png';
import iconPass from '../../../assets/ui/equipment.png';
import iconSpin from '../../../assets/ui/energy.png';
import iconDaily from '../../../assets/ui/Daily.png';
import iconPlays from '../../../assets/ui/Map.png';
import iconGift from '../../../assets/ui/gift.png';
import iconCards from '../../../assets/ui/inventory.png';
import iconIndex from '../../../assets/ui/Index.png';
import iconRebirth from '../../../assets/ui/rebirth.png';
import iconUpgrades from '../../../assets/ui/Upgrades.png';
import iconTeams from '../../../assets/ui/Role.png';
import iconPacks from '../../../assets/ui/mailbox.png';
import iconStyle from '../../../assets/ui/aura.png';
import iconSettings from '../../../assets/ui/Settings.png';
import iconPvp from '../../../assets/ui/Katana.png';
import iconCash from '../../../assets/ui/Bills.png';
import iconTrophy from '../../../assets/ui/trophy.png';
import { $, $$, cardHtml, esc, hex, html, money } from './dom.js';
import { PANELS, drawWheel, goalsHtml, goalsReady, type PanelUi } from './panels.js';
import { Tutorial } from './Tutorial.js';

export interface Settings {
  sound: boolean;
  volume: number;
  music: number;
  sensitivity: number;
  quality: 'low' | 'medium' | 'high';
  hints: boolean;
}

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const DEFAULT_SETTINGS: Settings = { sound: true, volume: 0.8, music: 0.5, sensitivity: 1, quality: COARSE ? 'medium' : 'high', hints: true };

export interface HudActions {
  play(): void;
  pvp(): void;
  pvpLeave(): void;
  quit(): void;
  nextGame(): void;
  /** Back to practice (opens the reward pack if one is waiting). */
  toLobby(openPack: PackId | null): void;
  upgrade(id: UpgradeId, count: number): void;
  claimDaily(): void;
  claimStreak(day: number): void;
  primary(): void;
  jump(): void;
  sprint(on: boolean): void;
  openPack(pack: PackId): void;
  buyPack(pack: PackId): void;
  equip(lineup: Lineup): void;
  equipBest(): void;
  rebirth(): void;
  styleEquip(id: string): void;
  styleBuy(id: string): void;
  stylePack(): void;
  claimGoal(id: string): void;
  claimPlay(index: number): void;
  claimPass(tier: number): void;
  spin(): void;
  freeGift(): void;
  title(id: string): void;
  tutorial(step: number): void;
  replayTutorial(): void;
  settings(s: Settings): void;
  /** Opens Boxity's own leaderboard panel; null outside Boxity. */
  openBoxityBoard: (() => boolean) | null;
}

/** An optional rewarded ad on the win screen. */
export interface AdOffer {
  label: string;
  /** Runs the ad; resolves to the message to show. */
  watch(): Promise<string>;
}

export interface BoardRow {
  name: string;
  touchdowns: number;
  stage: number;
  level: number;
  me: boolean;
  inMatch: boolean;
}

const SETTINGS_KEY = 'tf.settings';

const loadSettings = (): Settings => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

const lbtn = (open: string, icon: string, label: string, color: string, extra = ''): string =>
  `<button class="lbtn ${color} t" data-open="${open}"><img src="${icon}" alt=""><span>${label}</span>${extra}<i class="dot hidden">!</i></button>`;
const gbtn = (open: string, icon: string, label: string, color: string): string =>
  `<button class="gbtn ${color}" data-open="${open}"><img src="${icon}" alt=""><span class="t">${label}</span><i class="dot hidden">!</i></button>`;

/**
 * Keyboard shortcuts for every button on the lobby screen, so a player with
 * the mouse locked never has to free it (buttons inside menus have none:
 * opening a menu frees the mouse). The badge shows while the mouse is locked.
 */
const HOTKEYS: ReadonlyArray<{ sel: string; code: string; key: string }> = [
  { sel: '.play-btn', code: 'KeyP', key: 'P' },
  { sel: '.pvp-btn', code: 'KeyV', key: 'V' },
  { sel: '.wins', code: 'KeyL', key: 'L' },
  { sel: '[data-open="team"]', code: 'Digit1', key: '1' },
  { sel: '[data-open="shop"]', code: 'Digit2', key: '2' },
  { sel: '[data-open="pass"]', code: 'Digit3', key: '3' },
  { sel: '[data-open="spin"]', code: 'Digit4', key: '4' },
  { sel: '[data-open="daily"]', code: 'Digit5', key: '5' },
  { sel: '[data-open="plays"]', code: 'Digit6', key: '6' },
  { sel: '[data-open="gift"]', code: 'Digit7', key: '7' },
  { sel: '[data-open="cards"]', code: 'KeyE', key: 'E' },
  { sel: '[data-open="index"]', code: 'KeyI', key: 'I' },
  { sel: '[data-open="rebirth"]', code: 'KeyR', key: 'R' },
  { sel: '[data-open="upgrades"]', code: 'KeyU', key: 'U' },
  { sel: '.right-grid [data-open="teams"]', code: 'KeyT', key: 'T' },
  { sel: '[data-open="packs"]', code: 'KeyK', key: 'K' },
  { sel: '[data-open="style"]', code: 'KeyY', key: 'Y' },
  { sel: '[data-open="settings"]', code: 'KeyO', key: 'O' },
];

/** All DOM UI: lobby, match HUD, menus, tutorial and touch controls. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly lobby: HTMLElement;
  private readonly match: HTMLElement;
  private readonly touchPad: HTMLElement;
  private readonly reticle: HTMLElement;
  private profile: ProfileMessage | null = null;
  private modal: HTMLElement | null = null;
  private modalKind = '';
  private boardRows: () => BoardRow[] = () => [];
  private sprintOn = false;
  private meterEl: HTMLElement | null = null;
  private meterLabel: HTMLElement | null = null;
  private mode: 'lobby' | 'match' = 'lobby';
  private locked = false;
  private pvpState: PvpMessage = { state: 'idle', waiting: 0 };
  private readonly packQueue: PackOpenedMessage[] = [];
  private packShowing = false;
  readonly settings: Settings = loadSettings();
  readonly tutorial: Tutorial;
  private readonly ui: PanelUi;
  private seenTeam = false;
  private fitClock = 0;

  constructor(private readonly actions: HudActions, private readonly touch: boolean) {
    this.root = html(`<div class="hud"></div>`);
    document.body.appendChild(this.root);

    this.lobby = html(`<div class="hud lobby-hud">
      <div class="top-center">
        <div class="play-row"><button class="btn green play-btn t"><span class="ball"></span>PLAY</button><button class="btn pvp-btn t"><img src="${iconPvp}" alt="">PVP</button></div>
        <div class="level t"><span class="lv">Lv 1</span><div class="bar"><i></i><span class="fans">0/60 fans</span></div></div>
        <div class="pvp-status hidden"><span class="t"></span><button class="btn red t pvp-cancel">Cancel</button></div>
      </div>
      <div class="left-col">
        <button class="wins t" data-open="leaders" title="Leaderboard"><img src="${iconTrophy}" alt=""><span>0</span></button>
        ${lbtn('team', iconAvatar, 'My Team', 'pink', '<em class="new hidden">NEW</em>')}
        ${lbtn('shop', iconShop, 'Shop', 'red')}
        <div class="pass-row">${lbtn('pass', iconPass, 'SEASON PASS', 'purple small')}<button class="sq yellow t" data-open="spin"><img src="${iconSpin}" alt=""><span>SPIN</span><i class="dot hidden">!</i></button></div>
        ${lbtn('daily', iconDaily, 'Daily', 'blue')}
        ${lbtn('plays', iconPlays, 'Plays', 'orange')}
        ${lbtn('gift', iconGift, 'Free Gift', 'red')}
      </div>
      <div class="goals"></div>
      <div class="right-grid">
        ${gbtn('cards', iconCards, 'Cards', 'purple')}${gbtn('index', iconIndex, 'Index', 'teal')}
        ${gbtn('rebirth', iconRebirth, 'Rebirth', 'blue')}${gbtn('upgrades', iconUpgrades, 'Upgrades', 'orange')}
        ${gbtn('teams', iconTeams, 'Teams', 'green')}${gbtn('packs', iconPacks, 'Packs', 'teal')}
        ${gbtn('style', iconStyle, 'Style', 'pink')}${gbtn('settings', iconSettings, 'Settings', 'slate')}
      </div>
      <div class="streak-big t hidden">RING STREAK x0</div>
      <div class="mults"><span class="cm t">x1.00 Cards</span><span class="rm t">x1.0 Rebirth</span></div>
      <div class="stage-bar" data-open="teams"><span class="st t">Stage 1</span><span class="vs t">Rookie League vs ...</span>
        <div class="next-opp"><div class="no-h t">NEXT OPPONENT</div><div class="no-n t"></div><div class="no-s"></div><div class="no-w t"></div></div></div>
      <div class="hint t">${this.touch ? '' : 'Move <kbd>WASD</kbd> Throw <kbd>Click x2</kbd><br>Free mouse <kbd>Ctrl</kbd> / <kbd>C</kbd> Jump <kbd>Space</kbd>'}</div>
    </div>`);

    this.match = html(`<div class="hud match-hud hidden">
      <div class="board"><div class="team home t">YOU</div><div class="mid"><div class="dd t">1st and 10</div><div class="lg t">Rookie League · Stage 1</div></div><div class="team away t">OPP</div><button class="btn red quit t">Quit</button></div>
      <div class="pips t"><span>1</span><span>2</span><span>3</span><span>4</span></div>
      <div class="pvp-line t hidden"></div>
      <div class="pocket t hidden">POCKET<div class="bar"><i></i></div></div>
      <div class="callout t hidden"><div class="big"></div><div class="sub"></div></div>
      <div class="coach t hidden"><b>COACH</b><span></span></div>
      <div class="meter hidden"><div class="band"></div><div class="fill"></div></div>
      <div class="meter-label t hidden">POWER</div>
      <div class="banner t"><span class="st">Stage 1</span><span class="vs">Rookie League vs ...</span></div>
      <div class="hint t">${this.touch ? '' : 'Hike <kbd>Click</kbd><br>Quit <kbd>Backspace</kbd>'}</div>
    </div>`);

    const cash = html(`<div class="cash t"><img src="${iconCash}" alt=""><span>$0</span></div>`);
    this.reticle = html(`<div class="reticle hidden"><i></i></div>`);
    this.touchPad = html(`<div class="touch-pad">
      <button class="btn t" data-t="jump">JUMP</button>
      <button class="btn main t" data-t="main">THROW</button>
      <button class="btn t" data-t="sprint">RUN</button>
    </div>`);
    this.root.append(this.lobby, this.match, cash, this.reticle, html(`<div class="play-done"></div>`));
    if (touch) this.root.appendChild(this.touchPad);

    $(this.lobby, '.play-btn').addEventListener('click', () => {
      this.tutorial.event('play');
      actions.play();
    });
    $(this.lobby, '.pvp-btn').addEventListener('click', () => {
      if ((this.profile?.rebirths ?? 0) < PVP_REBIRTHS) {
        this.banner('Unlock PVP after 1 rebirth!');
        return;
      }
      actions.pvp();
    });
    $(this.lobby, '.pvp-cancel').addEventListener('click', () => actions.pvpLeave());
    $$(this.lobby, '[data-open]').forEach((b) => b.addEventListener('click', () => this.open(b.dataset['open'] as string)));
    this.lobby.addEventListener('click', (e) => {
      const g = (e.target as HTMLElement).closest('.claim-goal') as HTMLElement | null;
      if (g) actions.claimGoal(g.dataset['goal'] as string);
    });
    $(this.match, '.quit').addEventListener('click', () => this.confirmQuit());
    const press = (sel: string, fn: () => void): void => {
      $(this.touchPad, sel).addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    press('[data-t="main"]', () => actions.primary());
    press('[data-t="jump"]', () => actions.jump());
    press('[data-t="sprint"]', () => {
      this.sprintOn = !this.sprintOn;
      $(this.touchPad, '[data-t="sprint"]').classList.toggle('on', this.sprintOn);
      actions.sprint(this.sprintOn);
    });
    this.root.appendChild(html(`<div class="rotate t">Turn your phone sideways to play</div>`));

    this.ui = {
      tab: {},
      rerender: () => this.rerender(),
      open: (k) => this.open(k),
      close: () => this.close(),
      toast: (t) => this.toast(t),
      boardRows: () => this.boardRows(),
      settings: this.settings,
      setSetting: (k, v) => {
        this.settings[k] = v;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch {
          /* private mode: settings last this session */
        }
        this.applyHints();
        actions.settings(this.settings);
      },
      touch,
      focusPack: null,
      tutorialEvent: (e) => this.tutorial.event(e),
    };
    this.tutorial = new Tutorial(
      (step) => actions.tutorial(step),
      (does) => {
        if (does.startsWith('open:')) this.open(does.slice(5));
        else if (does === 'equipBest') {
          actions.equipBest();
          this.tutorial.event('equipBest');
        } else if (does === 'play') {
          this.tutorial.event('play');
          this.close();
          actions.play();
        }
      },
      touch,
    );
    this.applyHints();
    if (!touch) {
      for (const h of HOTKEYS) this.lobby.querySelector(h.sel)?.appendChild(html(`<kbd class="hk">${h.key}</kbd>`));
      this.lobby.querySelector('.pvp-cancel')?.appendChild(html(`<kbd class="hk">V</kbd>`));
    }
    document.body.classList.toggle('touch', touch);
    const rescale = (): void => this.rescale();
    window.addEventListener('resize', rescale);
    window.visualViewport?.addEventListener('resize', rescale);
    this.rescale();
  }

  /**
   * One HUD scale for the window: 1 at 1440x810, smaller on small windows
   * and phones, a little larger on big screens. Every HUD group scales from
   * its own anchor corner so nothing drifts into the middle or the corners.
   */
  private rescale(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.max(0.5, Math.min(1.25, Math.min(w / 1440, h / 810)));
    document.documentElement.style.setProperty('--s', s.toFixed(3));
    // Menus shrink on short or narrow windows so a whole panel fits on a phone.
    const pz = Math.max(0.5, Math.min(1, h / 760, w / 940));
    document.documentElement.style.setProperty('--pz', pz.toFixed(3));
    this.fitLeft();
  }

  /**
   * The left column lives between the top-left band Boxity keeps for its
   * toolbar and the cash in the bottom-left; when that gap is short (phones)
   * the column shrinks to fit instead of covering either.
   */
  private fitLeft(): void {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const s = Number(css.getPropertyValue('--s')) || 1;
    const tl = Math.max(parseFloat(css.getPropertyValue('--res-tl')) || 0, 64 * s);
    const col = this.lobby.querySelector('.left-col') as HTMLElement;
    const band = this.lobby.clientHeight - tl - 96 * s - 8;
    // A tall pill column first; if it would shrink too far, a compact 4x2 grid of icons.
    col.classList.remove('as-grid');
    let colH = col.offsetHeight;
    if (colH > 0 && band > 0 && band / colH < s * 0.75) {
      col.classList.add('as-grid');
      colH = col.offsetHeight;
    }
    const ls = colH > 0 && band > 0 ? Math.max(0.35, Math.min(s, band / colH)) : s;
    const value = ls.toFixed(3);
    if (root.style.getPropertyValue('--ls') !== value) root.style.setProperty('--ls', value);
  }

  /**
   * A key pressed while playing (WASD, Space, Ctrl/C and Backspace are taken
   * by movement and the mouse). Lobby buttons only; pressing a menu's key
   * again closes it.
   */
  hotkey(code: string): void {
    if (this.touch || this.packShowing) return;
    // Enter on a focused button already clicks it.
    if (code === 'Enter' && document.activeElement?.tagName === 'BUTTON') return;
    if (code === 'Enter' && this.tutorial.pressButton()) return;
    if (this.mode !== 'lobby') return;
    if (code === 'KeyG') {
      (this.lobby.querySelector('.claim-goal') as HTMLElement | null)?.click();
      return;
    }
    const h = HOTKEYS.find((x) => x.code === code);
    if (!h) return;
    const el = this.lobby.querySelector(h.sel) as HTMLElement | null;
    if (!el) return;
    if (this.modal) {
      // The same key closes the menu it opened; other keys switch menus.
      if (el.dataset['open'] === this.modalKind || (this.modalKind === 'leaders' && h.code === 'KeyL')) {
        this.close();
        return;
      }
      if (this.modalKind === 'results' || this.modalKind === 'quit') return;
    }
    if (h.code === 'KeyV' && this.pvpState.state === 'queued') {
      this.actions.pvpLeave();
      return;
    }
    el.click();
  }

  private applyHints(): void {
    document.body.classList.toggle('no-hints', !this.settings.hints);
  }

  // ------------------------------------------------------------ modes

  setMode(mode: 'lobby' | 'match'): void {
    this.mode = mode;
    this.lobby.classList.toggle('hidden', mode !== 'lobby');
    this.match.classList.toggle('hidden', mode !== 'match');
    $(this.touchPad, '[data-t="jump"]').classList.toggle('hidden', mode !== 'lobby');
    $(this.touchPad, '[data-t="sprint"]').classList.toggle('hidden', mode !== 'lobby');
    if (mode === 'match') this.close();
  }

  setMainButton(label: string, visible = true): void {
    const b = $(this.touchPad, '[data-t="main"]');
    b.textContent = label;
    b.classList.toggle('hidden', !visible);
  }

  setBoardSource(rows: () => BoardRow[]): void {
    this.boardRows = rows;
  }

  /** The centre reticle (where every throw goes). */
  setReticle(visible: boolean, charging: boolean): void {
    this.reticle.classList.toggle('hidden', !visible);
    this.reticle.classList.toggle('charging', charging);
  }

  /** Pointer-lock state, for the "free your mouse" tip. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    document.body.classList.toggle('mouse-locked', locked);
  }

  /** Called every frame. */
  frame(): void {
    // Boxity can change its reserved corners at any time; keep the left column fitted.
    if (this.mode === 'lobby' && (this.fitClock = (this.fitClock + 1) % 20) === 0) this.fitLeft();
    this.tutorial.update(this.mode, this.openPanel === 'results' ? 'results' : this.openPanel, this.locked);
  }

  // ------------------------------------------------------------ profile

  setProfile(p: ProfileMessage): void {
    const before = this.profile;
    this.profile = p;
    this.tutorial.setStep(p.tutorial);
    $(this.root, '.cash span').textContent = money(p.cash);
    const lv = levelFromFans(p.fans);
    $(this.lobby, '.lv').textContent = `Lv ${lv.level}`;
    ($(this.lobby, '.level .bar i') as HTMLElement).style.width = `${Math.round((lv.into / lv.need) * 100)}%`;
    $(this.lobby, '.fans').textContent = `${lv.into}/${lv.need} fans`;
    $(this.lobby, '.wins span').textContent = String(p.wins);
    $(this.lobby, '.cm').textContent = `x${cardsMultiplier(p.cards).toFixed(2)} Cards`;
    $(this.lobby, '.rm').textContent = `x${(rebirthMultiplier(p.rebirths) * fanMultiplier(lv.level)).toFixed(2)} Rebirth & Fans`;
    const info = stageInfo(p.stage);
    $(this.lobby, '.stage-bar .st').textContent = `Stage ${p.stage}`;
    $(this.lobby, '.stage-bar .vs').textContent = `${info.league} vs ${info.opponent.name}`;
    $(this.lobby, '.no-n').textContent = info.opponent.name;
    $(this.lobby, '.no-s').textContent = `Team ${p.stage} · ${info.league}`;
    $(this.lobby, '.no-w').textContent = `WIN TO UNLOCK: ${rewardText(stageReward(p.stage), money)}`;
    $(this.lobby, '.goals').innerHTML = goalsHtml(p);
    const pvpBtn = $(this.lobby, '.pvp-btn');
    pvpBtn.classList.toggle('locked', p.rebirths < PVP_REBIRTHS);
    // Red "!" badges for things waiting to be claimed.
    const dot = (open: string, on: boolean): void => {
      this.lobby.querySelector(`[data-open="${open}"] .dot`)?.classList.toggle('hidden', !on);
    };
    const now = Date.now();
    dot('daily', p.dailyAt <= now);
    dot('spin', p.spinAt <= now);
    dot('gift', !p.giftClaimed);
    dot('plays', p.plays.some((c) => c.progress >= c.target));
    dot('packs', Object.values(p.packs).some((n) => (n ?? 0) > 0));
    dot('pass', Array.from({ length: Math.floor(p.passXp / 250) }, (_, i) => i + 1).some((t) => t <= 30 && !p.passClaimed.includes(t)));
    dot('rebirth', p.stage > 5 * (p.rebirths + 1));
    dot('upgrades', false);
    dot('cards', false);
    $(this.lobby, '.new').classList.toggle('hidden', this.seenTeam);
    void goalsReady;
    if (this.modal && before && this.modalKind !== 'results' && this.modalKind !== 'quit' && this.modalKind !== 'spin') this.rerender();
  }

  cashPop(amount: number, text: string): void {
    const pop = html(`<div class="cash-pop t">+${money(amount)}<small>${esc(text)}</small></div>`);
    this.root.appendChild(pop);
    setTimeout(() => pop.remove(), 1500);
  }

  toast(text: string): void {
    const t = html(`<div class="toast t">${esc(text)}</div>`);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }

  /** A big gold banner in the middle ("YOU'RE READY!", "Unlock PVP after 1 rebirth!"). */
  banner(text: string, sub = ''): void {
    const b = html(`<div class="gold-banner"><div class="t">${esc(text)}</div>${sub ? `<small class="t">${esc(sub)}</small>` : ''}</div>`);
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2600);
  }

  levelUp(level: number): void {
    this.banner(`FAN LEVEL ${level}`, '+2% money forever');
  }

  playDone(text: string): void {
    const stack = $(this.root, '.play-done');
    const el = html(`<div class="pd t">Play done! ${esc(text)}</div>`);
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  setRingStreak(n: number): void {
    const s = $(this.lobby, '.streak-big');
    s.classList.toggle('hidden', n <= 0);
    s.textContent = `RING STREAK x${n}`;
    s.classList.remove('bump');
    void s.offsetWidth;
    s.classList.add('bump');
    if (n >= 3) this.tutorial.event('streak3');
  }

  setPvp(m: PvpMessage): void {
    this.pvpState = m;
    const box = $(this.lobby, '.pvp-status');
    box.classList.toggle('hidden', m.state !== 'queued');
    $(box, 'span').textContent = `Finding a rival... (${m.waiting} waiting)`;
    if (m.state === 'locked') this.banner('Unlock PVP after 1 rebirth!');
    if (m.state === 'matched' && m.opponent) this.banner('PVP DUEL!', `vs ${m.opponent}: first to score wins`);
  }

  // ------------------------------------------------------------ match

  setScoreboard(st: MatchState): void {
    const info = stageInfo(st.stage);
    $(this.match, '.dd').textContent = downLabel(st.down, st.toGo, st.yardLine);
    $(this.match, '.lg').textContent = `${info.league} · Stage ${st.stage}`;
    const away = $(this.match, '.team.away');
    away.textContent = st.pvp ? st.pvp.opponent.slice(0, 8).toUpperCase() : info.opponent.abbr;
    away.style.background = hex(info.opponent.colors.jersey);
    $(this.match, '.banner .st').textContent = `Stage ${st.stage}`;
    $(this.match, '.banner .vs').textContent = `${info.league} vs ${info.opponent.name}`;
    this.match.querySelectorAll('.pips span').forEach((el, i) => {
      el.classList.toggle('on', i + 1 === st.down);
      el.classList.toggle('done', i + 1 < st.down);
    });
    const pl = $(this.match, '.pvp-line');
    pl.classList.toggle('hidden', !st.pvp);
    if (st.pvp) pl.textContent = `PVP vs ${st.pvp.opponent}: they're at the ${100 - st.pvp.theirYard} after ${st.pvp.theirPlays} plays`;
  }

  callout(big: string | null, sub = '', color = '#ffffff', pop = true): void {
    const c = $(this.match, '.callout');
    if (big === null) {
      c.classList.add('hidden');
      return;
    }
    const b = $(c, '.big');
    const changed = b.textContent !== big;
    b.textContent = big;
    b.style.color = color;
    $(c, '.sub').textContent = sub;
    c.classList.remove('hidden');
    if (pop && changed) {
      c.classList.remove('pop');
      void c.offsetWidth;
      c.classList.add('pop');
    }
  }

  coach(text: string | null): void {
    const c = $(this.match, '.coach');
    c.classList.toggle('hidden', !text);
    if (text) $(c, 'span').textContent = text;
  }

  pocket(frac: number | null): void {
    const p = $(this.match, '.pocket');
    p.classList.toggle('hidden', frac === null);
    if (frac !== null) {
      const bar = $(p, '.bar i') as HTMLElement;
      bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      bar.style.background = frac > 0.5 ? 'var(--green)' : frac > 0.25 ? 'var(--gold)' : 'var(--red)';
    }
  }

  /** The power meter beside the player; it lives on the match HUD but the lobby uses it too. */
  meter(power: number | null, ideal = 0, band = 0.06): void {
    this.meterEl ??= $(this.match, '.meter');
    this.meterLabel ??= $(this.match, '.meter-label');
    const m = this.meterEl;
    const label = this.meterLabel;
    if (power === null) {
      m.classList.add('hidden');
      label.classList.add('hidden');
      return;
    }
    if (this.match.classList.contains('hidden')) {
      if (m.parentElement !== this.root) this.root.append(m, label);
    } else if (m.parentElement !== this.match) {
      this.match.append(m, label);
    }
    m.classList.remove('hidden');
    label.classList.remove('hidden');
    ($(m, '.fill') as HTMLElement).style.height = `${power * 100}%`;
    const b = $(m, '.band') as HTMLElement;
    b.classList.toggle('hidden', ideal > 1);
    b.style.bottom = `${Math.max(0, ideal - band) * 100}%`;
    b.style.height = `${(Math.min(1, ideal + band) - Math.max(0, ideal - band)) * 100}%`;
  }

  // ------------------------------------------------------------ panels

  close(): void {
    this.modal?.remove();
    this.modal = null;
    this.modalKind = '';
    this.ui.focusPack = null;
  }

  get panelOpen(): boolean {
    return this.modal !== null || this.packShowing;
  }

  /** Which panel is open ('' when none): drives Boxity's screen ads. */
  get openPanel(): string {
    if (this.packShowing) return 'pack';
    return this.modal ? this.modalKind : '';
  }

  private frame_(kind: string, title: string, theme: string, body: HTMLElement, closable = true, wide = false): HTMLElement {
    const m = html(`<div class="modal"><div class="panel theme-${theme} ${wide ? 'wide' : ''}"><h2 class="t">~${esc(title)}~</h2>${closable ? '<button class="xclose t">✕</button>' : ''}<div class="pbody"></div></div></div>`);
    $(m, '.pbody').appendChild(body);
    if (closable) {
      $(m, '.xclose').addEventListener('click', () => this.close());
      m.addEventListener('pointerdown', (e) => {
        if (e.target === m) this.close();
      });
    }
    return m;
  }

  private show(kind: string, title: string, theme: string, body: HTMLElement, closable = true, wide = false): HTMLElement {
    const scroll = this.modal && this.modalKind === kind ? ($(this.modal, '.pbody').scrollTop ?? 0) : 0;
    const grids = this.modal && this.modalKind === kind ? $$(this.modal, '.grid').map((g) => g.scrollTop) : [];
    this.modal?.remove();
    const m = this.frame_(kind, title, theme, body, closable, wide);
    document.body.appendChild(m);
    $(m, '.pbody').scrollTop = scroll;
    $$(m, '.grid').forEach((g, i) => (g.scrollTop = grids[i] ?? 0));
    this.modal = m;
    this.modalKind = kind;
    return m;
  }

  open(kind: string): void {
    const p = this.profile;
    if (!p || this.mode !== 'lobby') return;
    const build = PANELS[kind];
    if (!build) return;
    if (kind === 'team') this.seenTeam = true;
    const b = build(p, this.actions, this.ui);
    this.show(kind, b.title, b.theme, b.body, true, !!b.wide);
    this.tutorial.event(`open:${kind}`);
    if (kind === 'team') $(this.lobby, '.new').classList.add('hidden');
  }

  /** Open the Shop on a pack (a pack stand on the practice field). */
  openShop(pack: PackId): void {
    this.ui.focusPack = pack;
    this.open('shop');
    this.ui.focusPack = pack;
    this.modal?.querySelector('.shop-item.focus')?.scrollIntoView({ block: 'center' });
  }

  private rerender(): void {
    const p = this.profile;
    if (!p || !this.modal) return;
    const build = PANELS[this.modalKind];
    if (!build) return;
    const b = build(p, this.actions, this.ui);
    this.show(this.modalKind, b.title, b.theme, b.body, true, !!b.wide);
  }

  results(end: MatchEndMessage, ad: AdOffer | null = null): void {
    const info = stageInfo(end.stage);
    const next = stageInfo(end.nextStage);
    const title = end.reason === 'pvp' ? 'DUEL LOST' : end.won ? 'TOUCHDOWN!' : end.reason === 'interception' ? 'INTERCEPTED' : end.reason === 'quit' ? 'GAME OVER' : 'STOPPED!';
    const sub = end.pvp
      ? end.won
        ? `You beat ${end.pvp.opponent} in a PVP duel!`
        : `${end.pvp.opponent} scored first. Get them next time!`
      : end.won
        ? `You beat the ${info.opponent.name}! Next: ${next.opponent.name}`
        : end.reason === 'downs'
          ? 'Turnover on downs. Run it back!'
          : 'The defense picked it off. Try again!';
    const pack = end.reward?.pack ?? null;
    const body = html(`<div class="results">
      <p class="t sub">${esc(sub)}</p>
      <div class="stats t"><span>Earned</span><span class="green">+${money(end.earned)}</span>${end.won ? `<span>Fans</span><span>+${end.fans}</span>` : ''}<span>League</span><span>${esc(info.league)}</span>
      <span>Play</span><span>${end.playsDone.length ? 'Done! Claim it' : 'Keep going'}</span>${pack ? `<span>Unlocked</span><span class="gold">FREE ${esc(PACKS[pack].name)}</span>` : ''}</div>
      ${ad && end.won ? `<div class="center"><button class="btn gold t ad">${esc(ad.label)}</button></div><p class="ad-msg hidden"></p>` : ''}
      <div class="center"><button class="btn green t next">${end.won ? 'Next Game' : 'Try Again'}</button><button class="btn blue t lobby">Practice</button></div>
      ${pack ? '<div class="coach-line t"><b>COACH</b> Great game! Click Practice to get a FREE pack.</div>' : ''}
    </div>`);
    const m = this.show('results', title, end.won ? 'navy' : 'red', body, false);
    m.classList.add('results-modal');
    if (ad && end.won) {
      const button = $(m, '.ad') as HTMLButtonElement;
      const msg = $(m, '.ad-msg');
      button.addEventListener('click', () => {
        button.disabled = true;
        button.textContent = 'Loading ad...';
        void ad.watch().then((text) => {
          button.remove();
          msg.textContent = text;
          msg.classList.remove('hidden');
        });
      });
    }
    $(m, '.next').addEventListener('click', () => {
      this.close();
      this.actions.nextGame();
    });
    $(m, '.lobby').addEventListener('click', () => {
      this.close();
      this.actions.toLobby(pack);
    });
  }

  // ------------------------------------------------------------ pack opening & spin

  packOpened(m: PackOpenedMessage): void {
    this.packQueue.push(m);
    if (!this.packShowing) this.nextPack();
  }

  private nextPack(): void {
    const m = this.packQueue.shift();
    if (!m) {
      this.packShowing = false;
      return;
    }
    this.packShowing = true;
    const card = CARDS[m.card]!;
    const r = RARITY[card.rarity];
    const ov = html(`<div class="pack-open" style="--rc:${r.color}"><h2 class="t">${esc(PACKS[m.pack].name)}</h2>
      <div class="burst"></div><div class="flip">${cardHtml(m.card, m.copies, { big: true, isNew: m.isNew })}</div>
      <div class="rar-big t">${r.label}</div><p class="t">${m.isNew ? 'New card! It joined your collection.' : `Duplicate: card is now x${m.copies}.`} Click to continue</p></div>`);
    document.body.appendChild(ov);
    const done = (): void => {
      ov.remove();
      this.nextPack();
      if (this.modal) this.rerender();
    };
    setTimeout(() => ov.addEventListener('click', done), 400);
  }

  spinResult(m: SpinResultMessage): void {
    if (this.modalKind !== 'spin' || !this.modal) {
      this.toast(`Spin: ${rewardText(m.reward, money)}!`);
      return;
    }
    const wheel = $(this.modal, '.wheel') as HTMLCanvasElement;
    const n = 8;
    const target = Math.PI * 2 * 6 - (m.segment / n) * Math.PI * 2;
    const start = performance.now();
    const dur = 3200;
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      drawWheel(wheel, target * e);
      if (k < 1) requestAnimationFrame(step);
      else if (this.modal) {
        $(this.modal, '.spin-result').textContent = `You won ${rewardText(m.reward, money)}!`;
        setTimeout(() => this.rerender(), 1600);
      }
    };
    requestAnimationFrame(step);
  }

  /** Equipped style label for toasts. */
  styleName(id: string): string {
    return STYLE_BY_ID[id]?.name ?? id;
  }

  private confirmQuit(): void {
    const body = html(`<div><p>Your progress in this game will be lost.</p><div class="center"><button class="btn red t yes">Quit</button><button class="btn t no">Keep playing</button></div></div>`);
    const m = this.show('quit', 'Leave this game?', 'navy', body);
    $(m, '.yes').addEventListener('click', () => {
      this.close();
      this.actions.quit();
    });
    $(m, '.no').addEventListener('click', () => this.close());
  }

  requestQuit(): void {
    if (!this.match.classList.contains('hidden') && !this.modal) this.confirmQuit();
  }

  get pvp(): PvpMessage {
    return this.pvpState;
  }
}
