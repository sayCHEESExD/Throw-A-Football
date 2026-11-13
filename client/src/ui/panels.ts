/**
 * Every menu: Cards, Index, Upgrades, Style, Packs / Shop, Daily, Free
 * Gift, Plays, My Team, Teams, Rebirth, Settings, Season Pass, Spin and the
 * server leaderboard. Each builder returns the panel body; the Hud wraps it
 * in the themed frame.
 */
import {
  BUY_AMOUNTS,
  CARDS,
  CARD_COUNT,
  GOAL_SETS,
  LINEUP_SLOTS,
  PACKS,
  PACK_IDS,
  PASS_TIERS,
  PASS_XP_PER_TIER,
  POSITION,
  PVP_REBIRTHS,
  RARITIES,
  RARITY,
  SPIN_SEGMENTS,
  STREAK_MILESTONES,
  STYLE_ITEMS,
  STYLE_KINDS,
  STYLE_PACK_POOL,
  STYLE_PACK_PRICE,
  TITLES,
  UPGRADES,
  YARD,
  armStats,
  bulkUpgrade,
  canRebirth,
  cardRating,
  cardsMultiplier,
  dailyTrackReward,
  freeGiftCash,
  goalProgress,
  levelFromFans,
  passReward,
  passTier,
  playText,
  rebirthCost,
  rebirthMultiplier,
  rebirthStage,
  rewardText,
  stageInfo,
  stageReward,
  styleSourceText,
  teamRating,
  uniqueCards,
  upgradeCostFor,
  upgradeTier,
  type CardPos,
  type GoalView,
  type Lineup,
  type PackId,
  type ProfileMessage,
  type StyleItem,
  type StyleKind,
  type UpgradeId,
} from '@mctf/shared';
import { $, $$, cardHtml, countdown, esc, hex, html, money } from './dom.js';
import type { BoardRow, HudActions, Settings } from './Hud.js';
import iconCash from '../../../assets/ui/Bills.png';
import iconGift from '../../../assets/ui/gift.png';
import iconUpgrades from '../../../assets/ui/Upgrades.png';
import iconEnergy from '../../../assets/ui/energy.png';
import iconRun from '../../../assets/ui/run.png';
import iconRebirth from '../../../assets/ui/rebirth.png';
import iconTrophy from '../../../assets/ui/trophy.png';

export interface PanelUi {
  /** Remembered tabs / filters per panel. */
  tab: Record<string, string>;
  rerender(): void;
  open(kind: string): void;
  close(): void;
  toast(text: string): void;
  boardRows(): BoardRow[];
  settings: Settings;
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void;
  touch: boolean;
  /** Pack to highlight when the Shop opens from a pack stand. */
  focusPack: PackId | null;
  /** Tutorial notification: a panel was opened / a button used. */
  tutorialEvent(e: string): void;
}

export interface Built {
  title: string;
  theme: string;
  body: HTMLElement;
  wide?: boolean;
}

const tabs = (items: ReadonlyArray<[string, string]>, active: string): string =>
  `<div class="tabs">${items.map(([id, label]) => `<button class="tab t ${id === active ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>`;

const bindTabs = (body: HTMLElement, ui: PanelUi, key: string): void => {
  $$(body, '[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.tab[key] = b.dataset['tab'] as string;
      ui.rerender();
    }),
  );
};

const goalView = (p: ProfileMessage): GoalView => {
  let top = 0;
  for (const id of Object.keys(p.cards)) {
    const c = CARDS[Number(id)];
    if (c) top = Math.max(top, RARITIES.indexOf(c.rarity));
  }
  return { counters: p.counters, stage: p.stage, level: levelFromFans(p.fans).level, rebirths: p.rebirths, unique: uniqueCards(p.cards), bestRingStreak: p.bestRingStreak, topRarity: top };
};

export const goalsReady = (p: ProfileMessage): number => {
  const set = GOAL_SETS[Math.min(p.goalSet, GOAL_SETS.length - 1)]!;
  const v = goalView(p);
  return set.goals.filter((g) => !p.goalsClaimed.includes(g.id) && goalProgress(g, v) >= g.target).length;
};

/** The STARTER GOALS box on the lobby HUD. */
export const goalsHtml = (p: ProfileMessage): string => {
  const set = GOAL_SETS[Math.min(p.goalSet, GOAL_SETS.length - 1)]!;
  const v = goalView(p);
  const done = set.goals.filter((g) => p.goalsClaimed.includes(g.id)).length;
  const rows = set.goals
    .map((g) => {
      const claimed = p.goalsClaimed.includes(g.id);
      const prog = Math.min(g.target, goalProgress(g, v));
      const ready = !claimed && prog >= g.target;
      const reward = rewardText(g.reward, money);
      return `<div class="goal ${claimed ? 'done' : ''}"><span class="box">${claimed || ready ? '✓' : ''}</span><span class="gt">${esc(g.text)}${!claimed && !ready && g.target > 1 ? ` <i>${formatNum(prog)}/${formatNum(g.target)}</i>` : ''}</span>${
        ready ? `<button class="btn green t claim-goal" data-goal="${g.id}">CLAIM</button>` : `<span class="gr ${claimed ? 'claimed' : ''}">${claimed ? 'Claimed' : esc(reward)}</span>`
      }</div>`;
    })
    .join('');
  return `<div class="gh t">${set.name} <b>${done}/${set.goals.length}</b></div>${rows}`;
};

const formatNum = (n: number): string => (n >= 10000 ? money(n).slice(1) : String(Math.floor(n)));

// ---------------------------------------------------------------- cards

const SLOT_OF: Record<CardPos, keyof Lineup> = { WR: 'wr', OL: 'ol', RB: 'rb', DEF: 'def' };

export const toggleEquip = (p: ProfileMessage, id: number): Lineup => {
  const c = CARDS[id]!;
  const key = SLOT_OF[c.pos];
  const next: Lineup = { wr: [...p.lineup.wr], ol: [...p.lineup.ol], rb: [...p.lineup.rb], def: [...p.lineup.def] };
  const list = next[key];
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
  else if (list.length < LINEUP_SLOTS[key]) list.push(id);
  else {
    // Full: replace the weakest in that slot.
    let worst = 0;
    list.forEach((x, i) => {
      if (cardRating(x, p.cards[x] ?? 1) < cardRating(list[worst]!, p.cards[list[worst]!] ?? 1)) worst = i;
    });
    list[worst] = id;
  }
  return next;
};

const cardsPanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const side = ui.tab['cards'] ?? 'offense';
  const filter = ui.tab['cardsPos'] ?? 'all';
  const positions: CardPos[] = side === 'offense' ? ['WR', 'OL', 'RB'] : ['DEF'];
  const equipped = new Set([...p.lineup.wr, ...p.lineup.ol, ...p.lineup.rb, ...p.lineup.def]);
  const ids = Object.keys(p.cards)
    .map(Number)
    .filter((id) => {
      const c = CARDS[id];
      return c && positions.includes(c.pos) && (filter === 'all' || c.pos === filter);
    })
    .sort((x, y) => Number(equipped.has(y)) - Number(equipped.has(x)) || cardRating(y, p.cards[y]!) - cardRating(x, p.cards[x]!));
  const chips = side === 'offense' ? ['all', 'WR', 'OL', 'RB'] : ['all', 'DEF'];
  const body = html(`<div>
    <div class="row-bar">${tabs([['offense', 'Offense'], ['defense', 'Defense']], side)}
      <div class="chips">${chips.map((c) => `<button class="chip t ${c === filter ? 'on' : ''}" data-pos="${c}">${c === 'all' ? 'All' : c}</button>`).join('')}</div>
      <button class="btn green t equip-best">Equip Best</button></div>
    <div class="lineup-strip t">Team rating <b>${teamRating(p.lineup, p.cards)}</b> · ${p.lineup.wr.length}/3 WR · ${p.lineup.ol.length}/5 OL · ${p.lineup.rb.length}/1 RB · ${p.lineup.def.length}/3 DEF <span class="mult">Cards x${cardsMultiplier(p.cards).toFixed(2)}</span></div>
    <div class="grid cards-grid">${ids.map((id) => cardHtml(id, p.cards[id]!, { equipped: equipped.has(id) })).join('') || '<p>No cards here yet. Open packs to collect players!</p>'}</div>
    <p class="hint-line">Click a card to equip or unequip it. Duplicates level cards up.</p>
  </div>`);
  bindTabs(body, ui, 'cards');
  $$(body, '[data-pos]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.tab['cardsPos'] = b.dataset['pos'] as string;
      ui.rerender();
    }),
  );
  $(body, '.equip-best').addEventListener('click', () => {
    a.equipBest();
    ui.tutorialEvent('equipBest');
  });
  $$(body, '[data-card]').forEach((el) => el.addEventListener('click', () => a.equip(toggleEquip(p, Number(el.dataset['card'])))));
  return { title: 'Cards', theme: 'purple', body, wide: true };
};

// ---------------------------------------------------------------- index

const INDEX_TABS: ReadonlyArray<[string, string]> = [
  ['WR', 'Receivers'],
  ['OL', 'Linemen'],
  ['RB', 'Backs'],
  ['DEF', 'Defense'],
  ['balls', 'Balls'],
  ['trails', 'Trails'],
];

const indexPanel = (p: ProfileMessage, _a: HudActions, ui: PanelUi): Built => {
  const tab = ui.tab['index'] ?? 'WR';
  let grid = '';
  let footer = '';
  let frac = 0;
  if (tab === 'balls' || tab === 'trails') {
    const kind: StyleKind = tab === 'balls' ? 'ballSkin' : 'trail';
    const items = STYLE_ITEMS.filter((s) => s.kind === kind);
    const owned = items.filter((s) => p.styleOwned.includes(s.id));
    grid = items.map((s) => styleTile(s, p.styleOwned.includes(s.id), p.styleEquipped[s.kind] === s.id)).join('');
    const next = items.find((s) => !p.styleOwned.includes(s.id));
    footer = `${tab === 'balls' ? 'Balls' : 'Trails'}: ${owned.length} unlocked.${next ? ` Next: ${styleSourceText(next.source, money)}` : ' All unlocked!'}`;
    frac = owned.length / items.length;
  } else {
    const pos = tab as CardPos;
    const all = CARDS.filter((c) => c.pos === pos).sort((x, y) => y.rating - x.rating);
    const got = all.filter((c) => (p.cards[c.id] ?? 0) > 0).length;
    grid = all.map((c) => ((p.cards[c.id] ?? 0) > 0 ? cardHtml(c.id, p.cards[c.id]!) : cardHtml(c.id, 0, { locked: true }))).join('');
    footer = `${POSITION[pos].plural}: ${got}/${all.length} collected. All cards: ${uniqueCards(p.cards)}/${CARD_COUNT}`;
    frac = uniqueCards(p.cards) / CARD_COUNT;
  }
  const body = html(`<div>
    <div class="row-bar">${tabs(INDEX_TABS, tab)}<span class="mult big t">Cards x${cardsMultiplier(p.cards).toFixed(2)}</span></div>
    <div class="grid cards-grid">${grid}</div>
    <div class="index-foot"><div class="t">${esc(footer)}</div><div class="pbar"><i style="width:${Math.round(frac * 100)}%"></i><span class="t">${Math.round(frac * 100)}%</span></div></div>
    <p class="hint-line">Every card you collect adds +1% money forever.</p>
  </div>`);
  bindTabs(body, ui, 'index');
  return { title: 'Index', theme: 'teal', body, wide: true };
};

// ---------------------------------------------------------------- upgrades

const UPGRADE_LINES: Record<UpgradeId, (r: number) => string[]> = {
  accuracy: (r) => {
    const s = armStats({ accuracy: r, strength: 0, money: 0 }, YARD);
    return [`Spread ${s.spread.toFixed(2)}°`, `Perfect zone ${(s.perfectBand * 200).toFixed(0)}%`];
  },
  strength: (r) => {
    const s = armStats({ accuracy: 0, strength: r, money: 0 }, YARD);
    return [`Range ${Math.round(s.range / YARD)} yards`, `Speed ${s.speed.toFixed(1)}`];
  },
  money: (r) => [`x${(1 + 0.1 * r).toFixed(1)} money`],
};

const upgradesPanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const amount = Number(ui.tab['buy'] ?? 1);
  const rows = UPGRADES.map((u) => {
    const rank = p.upgrades[u.id] ?? 0;
    const maxed = rank >= u.maxRank;
    const plan = amount === 0 ? bulkUpgrade(u.id, rank, p.cash, 0) : { ranks: Math.min(amount, u.maxRank - rank), cost: upgradeCostFor(u.id, rank, amount) };
    const to = rank + Math.max(1, plan.ranks);
    const before = UPGRADE_LINES[u.id](rank);
    const after = UPGRADE_LINES[u.id](to);
    const can = !maxed && plan.ranks > 0 && p.cash >= plan.cost;
    const icon = u.id === 'accuracy' ? iconEnergy : u.id === 'strength' ? iconRun : iconCash;
    return `<div class="up-row up-${u.id}">
      <img src="${icon}" alt=""><span class="tier t">TIER ${upgradeTier(rank)}</span>
      <div class="grow"><div class="name t">${u.name} <span class="rank">Rank ${rank}${maxed ? '' : ` &gt; ${to}`}</span></div>
      ${before.map((l, i) => `<div class="desc">${l}${maxed ? '' : ` &gt; <b>${after[i]}</b>`}</div>`).join('')}</div>
      <button class="btn ${can ? 'green' : ''} t buy" data-up="${u.id}" ${can ? '' : 'disabled'}>${maxed ? 'MAX' : `${money(plan.cost || upgradeCostFor(u.id, rank, 1))}<small>+${Math.max(1, plan.ranks)}</small>`}</button>
    </div>`;
  }).join('');
  const body = html(`<div>
    <div class="row-bar"><span class="sub t">Throw better, earn more!</span><div class="chips">${BUY_AMOUNTS.map((n) => `<button class="chip t ${n === amount ? 'on' : ''}" data-amt="${n}">${n === 0 ? 'MAX' : `x${n}`}</button>`).join('')}</div></div>
    ${rows}
  </div>`);
  $$(body, '[data-amt]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.tab['buy'] = b.dataset['amt'] as string;
      ui.rerender();
    }),
  );
  $$(body, '[data-up]').forEach((b) =>
    b.addEventListener('click', () => {
      a.upgrade(b.dataset['up'] as UpgradeId, amount);
      ui.tutorialEvent('upgrade');
    }),
  );
  return { title: 'Upgrades', theme: 'orange', body };
};

// ---------------------------------------------------------------- style

const styleSwatch = (s: StyleItem): string => {
  const cols = s.colors.map(hex);
  const bg = cols.length > 1 ? `linear-gradient(135deg, ${cols.join(', ')})` : cols[0];
  const shape = s.kind === 'ballSkin' ? 'ball' : s.kind === 'emote' ? 'emote' : s.kind === 'tdEffect' ? 'burst' : 'streak';
  return `<div class="swatch ${shape}" style="--sw:${bg}"></div>`;
};

const styleTile = (s: StyleItem, owned: boolean, on: boolean): string =>
  `<div class="stile ${owned ? '' : 'lockd'} ${on ? 'on' : ''}" style="--rc:${RARITY[s.rarity].color}" data-style="${s.id}">
    <span class="src t">${s.source.kind === 'stylePack' ? 'Style Pack' : s.source.kind === 'cash' ? 'Shop' : s.source.kind === 'start' ? 'Starter' : s.source.kind === 'pass' ? 'Pass' : s.source.kind === 'rebirth' ? 'Rebirth' : s.source.kind === 'index' ? 'Index' : 'Daily'}</span>
    ${styleSwatch(s)}<div class="sn t">${esc(s.name)}</div><div class="srar t">${RARITY[s.rarity].label}</div>${on ? '<div class="check">✓</div>' : ''}${owned ? '' : '<div class="lock">🔒</div>'}
  </div>`;

const stylePanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const kind = (ui.tab['style'] ?? 'trail') as StyleKind | 'packs';
  const search = (ui.tab['styleSearch'] ?? '').toLowerCase();
  const owned = ui.tab['styleOwned'] === '1';
  const rarity = ui.tab['styleRarity'] ?? 'all';
  const tabsHtml = tabs([...STYLE_KINDS.map((k) => [k.id, k.label] as [string, string]), ['packs', 'Style Packs']], kind);
  if (kind === 'packs') {
    const pool = STYLE_PACK_POOL.map((id) => STYLE_ITEMS.find((s) => s.id === id)!);
    const body = html(`<div>${tabsHtml}
      <div class="style-pack"><div class="pack-art" style="--pc:#b45cff"><span class="t">STYLE<br>PACK</span></div>
      <div class="grow"><h3 class="t">Style Pack</h3><p>One random item you don't own yet from the pack-only collection.</p>
      <div class="grid style-grid small">${pool.map((s) => styleTile(s, p.styleOwned.includes(s.id), false)).join('')}</div>
      <button class="btn gold t buy-style-pack" ${p.cash >= STYLE_PACK_PRICE ? '' : 'disabled'}>GET IT · ${money(STYLE_PACK_PRICE)}</button></div></div></div>`);
    bindTabs(body, ui, 'style');
    $(body, '.buy-style-pack').addEventListener('click', () => a.stylePack());
    return { title: 'Style', theme: 'pink', body, wide: true };
  }
  const items = STYLE_ITEMS.filter(
    (s) => s.kind === kind && (!search || s.name.toLowerCase().includes(search)) && (!owned || p.styleOwned.includes(s.id)) && (rarity === 'all' || s.rarity === rarity),
  );
  const selId = ui.tab['styleSel'] && items.some((s) => s.id === ui.tab['styleSel']) ? ui.tab['styleSel'] : p.styleEquipped[kind as StyleKind] ?? items[0]?.id;
  const sel = STYLE_ITEMS.find((s) => s.id === selId) ?? items[0];
  const has = sel ? p.styleOwned.includes(sel.id) : false;
  const on = sel ? p.styleEquipped[sel.kind] === sel.id : false;
  let action = '';
  if (sel) {
    if (on) action = '<button class="btn t" disabled>EQUIPPED</button>';
    else if (has) action = '<button class="btn green t do-equip">EQUIP</button>';
    else if (sel.source.kind === 'cash') action = `<button class="btn gold t do-buy" ${p.cash >= sel.source.price ? '' : 'disabled'}>GET IT · ${money(sel.source.price)}</button>`;
    else if (sel.source.kind === 'stylePack') action = '<button class="btn gold t do-pack">GET IT</button>';
    else action = `<button class="btn t" disabled>${esc(styleSourceText(sel.source, money))}</button>`;
  }
  const body = html(`<div>${tabsHtml}
    <div class="row-bar filters"><input class="search" placeholder="Search..." value="${esc(search)}">
      <select class="rsel">${['all', ...RARITIES].map((r) => `<option value="${r}" ${r === rarity ? 'selected' : ''}>${r === 'all' ? 'All rarities' : RARITY[r as keyof typeof RARITY].label}</option>`).join('')}</select>
      <button class="chip t ${owned ? 'on' : ''} owned">Owned</button></div>
    <div class="style-split"><div class="grid style-grid">${items.map((s) => styleTile(s, p.styleOwned.includes(s.id), p.styleEquipped[s.kind] === s.id)).join('') || '<p>Nothing matches. Try another search or filter.</p>'}</div>
    ${sel ? `<div class="preview" style="--rc:${RARITY[sel.rarity].color}">${styleSwatch(sel)}<h3 class="t">${esc(sel.name)}</h3>
      <div class="tags"><span class="tagp" style="background:${RARITY[sel.rarity].color}">${RARITY[sel.rarity].label}</span><span class="tagp">${esc(styleSourceText(sel.source, money))}</span></div>
      <p>${esc(sel.blurb)}</p>${action}<p class="hint-line">Click a card to preview it, click again to equip.</p></div>` : ''}</div></div>`);
  bindTabs(body, ui, 'style');
  const searchEl = $(body, '.search') as HTMLInputElement;
  searchEl.addEventListener('change', () => {
    ui.tab['styleSearch'] = searchEl.value;
    ui.rerender();
  });
  searchEl.addEventListener('keydown', (e) => e.stopPropagation());
  ($(body, '.rsel') as HTMLSelectElement).addEventListener('change', (e) => {
    ui.tab['styleRarity'] = (e.target as HTMLSelectElement).value;
    ui.rerender();
  });
  $(body, '.owned').addEventListener('click', () => {
    ui.tab['styleOwned'] = owned ? '0' : '1';
    ui.rerender();
  });
  $$(body, '[data-style]').forEach((el) =>
    el.addEventListener('click', () => {
      const id = el.dataset['style'] as string;
      if (ui.tab['styleSel'] === id && p.styleOwned.includes(id)) a.styleEquip(id);
      ui.tab['styleSel'] = id;
      ui.rerender();
    }),
  );
  body.querySelector('.do-equip')?.addEventListener('click', () => sel && a.styleEquip(sel.id));
  body.querySelector('.do-buy')?.addEventListener('click', () => sel && a.styleBuy(sel.id));
  body.querySelector('.do-pack')?.addEventListener('click', () => {
    ui.tab['style'] = 'packs';
    ui.rerender();
  });
  return { title: 'Style', theme: 'pink', body, wide: true };
};

// ---------------------------------------------------------------- packs & shop

const packArt = (id: PackId): string => `<div class="pack-art" style="--pc:${PACKS[id].color}"><span class="t">${esc(PACKS[id].name.replace(' Pack', '').toUpperCase())}<br>PACK</span></div>`;

const packsPanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const tab = ui.tab['packs'] ?? 'mine';
  let content = '';
  if (tab === 'shop') {
    content = `<div class="shop-list">${PACK_IDS.filter((id) => PACKS[id].price > 0)
      .map((id) => {
        const d = PACKS[id];
        const odds = Object.entries(d.odds)
          .map(([r, w]) => `<span style="color:${RARITY[r as keyof typeof RARITY].color}">${RARITY[r as keyof typeof RARITY].label} ${w}%</span>`)
          .join(' ');
        return `<div class="shop-item ${ui.focusPack === id ? 'focus' : ''}">${packArt(id)}<div class="grow"><div class="name t">${esc(d.name)}</div><div class="desc">${esc(d.blurb)}</div><div class="odds">${odds}</div></div>
          <button class="btn ${p.cash >= d.price ? 'green' : ''} t" data-buy="${id}" ${p.cash >= d.price ? '' : 'disabled'}>${money(d.price)}</button></div>`;
      })
      .join('')}
      <div class="shop-item">${'<div class="pack-art" style="--pc:#ff4fa3"><span class="t">STYLE<br>PACK</span></div>'}<div class="grow"><div class="name t">Style Pack</div><div class="desc">A random trail, ball or celebration.</div></div>
      <button class="btn ${p.cash >= STYLE_PACK_PRICE ? 'green' : ''} t style-pack" ${p.cash >= STYLE_PACK_PRICE ? '' : 'disabled'}>${money(STYLE_PACK_PRICE)}</button></div></div>`;
  } else {
    const mine = PACK_IDS.filter((id) => (p.packs[id] ?? 0) > 0);
    content = mine.length
      ? `<div class="shop-list">${mine
          .map(
            (id) =>
              `<div class="shop-item">${packArt(id)}<div class="grow"><div class="name t">${esc(PACKS[id].name)} <span class="rank">x${p.packs[id]}</span></div><div class="desc">${esc(PACKS[id].blurb)}</div></div><button class="btn gold t" data-open-pack="${id}">OPEN</button></div>`,
          )
          .join('')}</div>`
      : `<div class="empty"><h3 class="t">No packs waiting</h3><p>Packs from wins, goals, the Season Pass, spins, gifts and rewards wait here until you open them.</p><div class="center"><button class="btn green t go-shop">GO TO SHOP</button></div></div>`;
  }
  const body = html(`<div>${tabs([['shop', 'Shop'], ['mine', 'My Packs']], tab)}<p class="sub-line">${tab === 'shop' ? 'Buy packs with the cash you earn in games.' : 'Your packs wait here until you open them.'}</p>${content}</div>`);
  bindTabs(body, ui, 'packs');
  $$(body, '[data-buy]').forEach((b) => b.addEventListener('click', () => a.buyPack(b.dataset['buy'] as PackId)));
  $$(body, '[data-open-pack]').forEach((b) => b.addEventListener('click', () => a.openPack(b.dataset['openPack'] as PackId)));
  body.querySelector('.go-shop')?.addEventListener('click', () => {
    ui.tab['packs'] = 'shop';
    ui.rerender();
  });
  body.querySelector('.style-pack')?.addEventListener('click', () => a.stylePack());
  return { title: 'Packs', theme: 'yellow', body };
};

// ---------------------------------------------------------------- daily

const dailyPanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const ready = p.dailyAt <= Date.now();
  const today = ready ? p.dailyStreak + 1 : p.dailyStreak;
  const week = Math.floor((Math.max(1, today) - 1) / 7);
  const cells = Array.from({ length: 7 }, (_, i) => {
    const day = week * 7 + i + 1;
    const r = dailyTrackReward(day);
    const got = day < today || (!ready && day === today);
    const now = day === today && ready;
    const chest = i === 6;
    return `<div class="dday ${got ? 'got' : ''} ${now ? 'today' : ''} ${chest ? 'chest' : ''}"><div class="dn t">${chest ? 'CHEST' : `DAY ${day}`}</div>
      <img src="${chest ? iconGift : iconCash}" alt=""><b class="t">${money(r.cash ?? 0)}</b>${r.pack ? `<small class="t">+ ${esc(PACKS[r.pack].name)}</small>` : ''}${got ? '<div class="tick">✓</div>' : ''}</div>`;
  }).join('');
  const mile = STREAK_MILESTONES.map((m) => {
    const can = p.dailyStreak >= m.day && !p.streakClaimed.includes(m.day);
    const got = p.streakClaimed.includes(m.day);
    return `<div class="mile ${got ? 'got' : ''}"><span class="md t">${m.day}</span><span class="ml">${esc(rewardText(m.reward, money))}</span>${can ? `<button class="btn green t" data-mile="${m.day}">CLAIM</button>` : ''}</div>`;
  }).join('');
  const frac = Math.min(1, p.dailyStreak / 100);
  const body = html(`<div>
    <div class="streak-head"><div class="flame t">🔥 ${p.dailyStreak}<small>DAY STREAK</small></div><div class="grow"><div class="t">Day ${Math.max(1, today)} streak · ${money(dailyTrackReward(Math.max(1, today)).cash ?? 0)}</div><p>Come back every day. Skip more than two days and the streak resets.</p></div></div>
    <div class="days7">${cells}</div>
    <div class="miles-head t">STREAK MILESTONES</div><div class="pbar thin"><i style="width:${frac * 100}%"></i></div><div class="miles">${mile}</div>
    <div class="center"><button class="btn ${ready ? 'gold' : ''} t claim-daily" ${ready ? '' : 'disabled'}>${ready ? `CLAIM DAY ${today}` : `NEXT IN ${countdown(p.dailyAt)}`}</button></div>
  </div>`);
  $(body, '.claim-daily').addEventListener('click', () => a.claimDaily());
  $$(body, '[data-mile]').forEach((b) => b.addEventListener('click', () => a.claimStreak(Number(b.dataset['mile']))));
  void ui;
  return { title: 'Daily Rewards', theme: 'teal', body, wide: true };
};

// ---------------------------------------------------------------- free gift

const giftPanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const body = html(`<div class="gift">
    <img class="gift-img" src="${iconGift}" alt="">
    <div class="grow"><h3 class="t">Free Money!</h3><div class="big-cash t">+${money(freeGiftCash(p.stage))}</div><p>Do both, then claim your gift</p>
    ${p.giftClaimed ? '<p class="t">Already claimed. Thanks for playing!</p>' : `<label class="check-row t"><input type="checkbox" class="c1"> Like the Game And Rejoin</label><label class="check-row t"><input type="checkbox" class="c2"> Join Our Community</label>`}
    <div class="center"><button class="btn green t claim" disabled>${p.giftClaimed ? 'Claimed' : 'Claim'}</button></div></div>
  </div>`);
  const claim = $(body, '.claim') as HTMLButtonElement;
  if (!p.giftClaimed) {
    const sync = (): void => {
      claim.disabled = !(($(body, '.c1') as HTMLInputElement).checked && ($(body, '.c2') as HTMLInputElement).checked);
    };
    $$(body, 'input').forEach((i) => i.addEventListener('change', sync));
    claim.addEventListener('click', () => {
      a.freeGift();
      ui.close();
    });
  }
  return { title: 'Free Gift', theme: 'pink', body };
};

// ---------------------------------------------------------------- plays

const playsPanel = (p: ProfileMessage, a: HudActions, _ui: PanelUi): Built => {
  const cards = p.plays
    .map((c, i) => {
      const done = c.progress >= c.target;
      return `<div class="play-card ${done ? 'done' : ''}"><div class="pc-top t">PLAY ${i + 1}</div><div class="pc-text t">${esc(playText(c))}</div>
      <div class="pbar"><i style="width:${Math.min(100, (c.progress / c.target) * 100)}%"></i><span class="t">${formatNum(c.progress)}/${formatNum(c.target)}</span></div>
      <div class="pc-rew t">Reward ${money(c.cash)} + 50 Pass XP</div>
      <button class="btn ${done ? 'green' : ''} t" data-play="${i}" ${done ? '' : 'disabled'}>${done ? 'Done! Claim it' : 'In progress'}</button></div>`;
    })
    .join('');
  const body = html(`<div><p class="sub-line">Finish plays in games and on the practice field. Claim one and a new play takes its place.</p><div class="plays-row">${cards}</div></div>`);
  $$(body, '[data-play]').forEach((b) => b.addEventListener('click', () => a.claimPlay(Number(b.dataset['play']))));
  return { title: 'Plays', theme: 'orange', body, wide: true };
};

// ---------------------------------------------------------------- my team

const myTeamPanel = (p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const slot = (key: keyof Lineup, label: string): string => {
    const ids = p.lineup[key];
    const cells = Array.from({ length: LINEUP_SLOTS[key] }, (_, i) => {
      const id = ids[i];
      return id === undefined ? `<div class="card empty-slot"><span class="t">+</span><div class="cn t">${label}</div></div>` : cardHtml(id, p.cards[id] ?? 1, { equipped: true });
    }).join('');
    return `<div class="team-row"><div class="tr-label t">${label}</div><div class="grid cards-grid inline">${cells}</div></div>`;
  };
  const titles = TITLES.map((t) => {
    const on = p.title === t.id;
    return `<button class="title-chip t ${on ? 'on' : ''}" style="--tc:${t.color}" data-title="${t.id}" title="${esc(t.need)}">${t.label}</button>`;
  }).join('');
  const body = html(`<div>
    <div class="team-head"><div class="qb-badge t">QB<small>YOU</small></div><div class="grow"><div class="t big-num">Team Rating ${teamRating(p.lineup, p.cards)}</div><p>Your receivers catch, your line blocks, your back runs after the catch. Defense cards count for your collection.</p></div><button class="btn purple t to-cards">Edit in Cards</button></div>
    ${slot('wr', 'RECEIVERS')}${slot('ol', 'LINE')}${slot('rb', 'BACK')}${slot('def', 'DEFENSE')}
    <div class="miles-head t">TITLE <small>(shown over your head)</small></div><div class="titles">${titles}</div>
  </div>`);
  $(body, '.to-cards').addEventListener('click', () => ui.open('cards'));
  $$(body, '[data-title]').forEach((b) => b.addEventListener('click', () => a.title(b.dataset['title'] as string)));
  return { title: 'My Team', theme: 'pink', body, wide: true };
};

// ---------------------------------------------------------------- teams (league ladder)

const teamsPanel = (p: ProfileMessage, _a: HudActions, _ui: PanelUi): Built => {
  const from = Math.max(1, p.stage - 4);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const stage = from + i;
    const info = stageInfo(stage);
    const beaten = stage < p.stage;
    const next = stage === p.stage;
    const reward = stageReward(stage);
    return `<div class="ladder ${beaten ? 'beaten' : ''} ${next ? 'next' : ''}"><span class="lst t">${stage}</span>
      <span class="abbr t" style="background:${hex(info.opponent.colors.jersey)}">${info.opponent.abbr}</span>
      <div class="grow"><div class="name t">${esc(info.opponent.name)}</div><div class="desc">${esc(info.league)}</div></div>
      <span class="lr t">${beaten ? 'BEATEN ✓' : `${next ? 'NEXT · ' : ''}Win to unlock ${esc(rewardText(reward, money))}`}</span></div>`;
  }).join('');
  const body = html(`<div><p class="sub-line">Beat every team in a league to move up. Each first win unlocks a FREE pack.</p><div class="ladder-list">${rows}</div></div>`);
  return { title: 'Teams', theme: 'green', body };
};

// ---------------------------------------------------------------- rebirth

const rebirthPanel = (p: ProfileMessage, a: HudActions, _ui: PanelUi): Built => {
  const needStage = rebirthStage(p.rebirths);
  const cost = rebirthCost(p.rebirths);
  const stageOk = p.stage > needStage;
  const cashOk = p.cash >= cost;
  const ready = canRebirth(p.rebirths, p.stage, p.cash);
  const unlocks = STYLE_ITEMS.filter((s) => s.source.kind === 'rebirth' && s.source.count === p.rebirths + 1).map((s) => s.name);
  if (p.rebirths + 1 === PVP_REBIRTHS) unlocks.unshift('PVP duels');
  const body = html(`<div class="rebirth">
    <img src="${iconRebirth}" class="rb-img" alt="">
    <div class="rb-mult t">x${rebirthMultiplier(p.rebirths).toFixed(1)} <span>&gt;</span> <b>x${rebirthMultiplier(p.rebirths + 1).toFixed(1)}</b><small>money forever</small></div>
    <div class="rb-count t">Rebirths: ${p.rebirths}</div>
    <div class="req ${stageOk ? 'ok' : ''}"><span class="t">Beat stage ${needStage}</span><div class="pbar"><i style="width:${Math.min(100, ((p.stage - 1) / needStage) * 100)}%"></i><span class="t">${Math.min(p.stage - 1, needStage)}/${needStage}</span></div></div>
    <div class="req ${cashOk ? 'ok' : ''}"><span class="t">Have ${money(cost)}</span><div class="pbar"><i style="width:${Math.min(100, (p.cash / cost) * 100)}%"></i><span class="t">${money(Math.min(p.cash, cost))}/${money(cost)}</span></div></div>
    <p><b>Resets:</b> cash, stage and upgrades. <b>Keeps:</b> cards, packs, style, fans and goals.</p>
    ${unlocks.length ? `<p class="t unlock">Unlocks: ${esc(unlocks.join(', '))}</p>` : ''}
    <div class="center"><button class="btn ${ready ? 'gold' : ''} t do-rebirth" ${ready ? '' : 'disabled'}>REBIRTH</button></div>
  </div>`);
  $(body, '.do-rebirth').addEventListener('click', () => a.rebirth());
  return { title: 'Rebirth', theme: 'blue', body };
};

// ---------------------------------------------------------------- settings

const settingsPanel = (_p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const s = ui.settings;
  const toggle = (key: keyof Settings, label: string): string =>
    `<div class="set-row"><span class="t">${label}</span><button class="switch ${s[key] ? 'on' : ''}" data-toggle="${key}"><i></i></button></div>`;
  const slider = (key: 'music' | 'volume' | 'sensitivity', label: string, min: number, max: number, step: number): string =>
    `<div class="set-row"><span class="t">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-range="${key}"></div>`;
  const body = html(`<div class="settings">
    ${toggle('sound', 'Sound')}${slider('volume', 'Volume', 0, 1, 0.05)}${slider('music', 'Music', 0, 1, 0.05)}
    ${slider('sensitivity', 'Camera sensitivity', 0.3, 2.5, 0.05)}
    <div class="set-row"><span class="t">Graphics</span><div class="chips">${(['low', 'medium', 'high'] as const).map((q) => `<button class="chip t ${s.quality === q ? 'on' : ''}" data-q="${q}">${q.toUpperCase()}</button>`).join('')}</div></div>
    ${toggle('hints', 'Show control hints')}
    <div class="set-row"><span class="t">Leaderboard</span><button class="btn cyan t lb"><img src="${iconTrophy}" alt=""> Open</button></div>
    <div class="set-row"><span class="t">Tutorial</span><button class="btn t replay">Replay tutorial</button></div>
    <p class="hint-line">${ui.touch ? 'Drag the right side to look around. Tap THROW twice to throw.' : 'Click the game to lock the mouse. Press Ctrl or C to free it and click buttons. Press Q (or the lock button) to play without mouse lock: then right-drag to look.'}</p>
  </div>`);
  $$(body, '[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset['toggle'] as 'sound' | 'hints';
      ui.setSetting(k, !s[k]);
      ui.rerender();
    }),
  );
  $$(body, '[data-range]').forEach((r) =>
    r.addEventListener('input', () => {
      const k = r.dataset['range'] as 'music' | 'volume' | 'sensitivity';
      ui.setSetting(k, Number((r as HTMLInputElement).value));
    }),
  );
  $$(body, '[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.setSetting('quality', b.dataset['q'] as Settings['quality']);
      ui.rerender();
    }),
  );
  $(body, '.lb').addEventListener('click', () => ui.open('leaders'));
  $(body, '.replay').addEventListener('click', () => {
    a.replayTutorial();
    ui.close();
  });
  return { title: 'Settings', theme: 'slate', body };
};

// ---------------------------------------------------------------- season pass

const passPanel = (p: ProfileMessage, a: HudActions, _ui: PanelUi): Built => {
  const tier = passTier(p.passXp);
  const into = p.passXp - tier * PASS_XP_PER_TIER;
  const cells = Array.from({ length: PASS_TIERS }, (_, i) => {
    const t = i + 1;
    const r = passReward(t);
    const got = p.passClaimed.includes(t);
    const can = t <= tier && !got;
    return `<div class="tier-cell ${t <= tier ? 'reached' : ''} ${got ? 'got' : ''}"><div class="tn t">${t}</div><div class="tr t">${esc(rewardText(r, money))}</div>${
      can ? `<button class="btn green t" data-tier="${t}">CLAIM</button>` : got ? '<div class="tick">✓</div>' : '<div class="lockt">🔒</div>'
    }</div>`;
  }).join('');
  const body = html(`<div>
    <div class="pass-head"><div class="t big-num">Tier ${tier}/${PASS_TIERS}</div><div class="pbar"><i style="width:${tier >= PASS_TIERS ? 100 : (into / PASS_XP_PER_TIER) * 100}%"></i><span class="t">${tier >= PASS_TIERS ? 'MAX' : `${into}/${PASS_XP_PER_TIER} XP`}</span></div><p>Free for everyone. Earn XP from passes, touchdowns, wins, plays and daily rewards.</p></div>
    <div class="tier-row">${cells}</div>
  </div>`);
  $$(body, '[data-tier]').forEach((b) => b.addEventListener('click', () => a.claimPass(Number(b.dataset['tier']))));
  return { title: 'Season Pass', theme: 'purple', body, wide: true };
};

// ---------------------------------------------------------------- spin

const spinPanel = (p: ProfileMessage, a: HudActions, _ui: PanelUi): Built => {
  const ready = p.spinAt <= Date.now();
  const body = html(`<div class="spin">
    <div class="wheel-wrap"><canvas class="wheel" width="320" height="320"></canvas><div class="pointer"></div></div>
    <div class="center"><button class="btn ${ready ? 'gold' : ''} t do-spin" ${ready ? '' : 'disabled'}>${ready ? 'SPIN!' : `FREE SPIN IN ${countdown(p.spinAt)}`}</button></div>
    <p class="spin-result t"></p>
  </div>`);
  drawWheel($(body, '.wheel') as HTMLCanvasElement, 0);
  $(body, '.do-spin').addEventListener('click', (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    a.spin();
  });
  return { title: 'Spin', theme: 'yellow', body };
};

const WHEEL_COLORS = ['#ff4fa3', '#3fa8ff', '#5fe07a', '#ffc531', '#b45cff', '#ff9d3b', '#3ff2d0', '#ff5f6d'];

export const drawWheel = (c: HTMLCanvasElement, angle: number): void => {
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const n = SPIN_SEGMENTS.length;
  const r = c.width / 2;
  g.clearRect(0, 0, c.width, c.height);
  g.save();
  g.translate(r, r);
  g.rotate(angle);
  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const a1 = a0 + (Math.PI * 2) / n;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r - 6, a0, a1);
    g.closePath();
    g.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length] as string;
    g.fill();
    g.strokeStyle = '#0b0f22';
    g.lineWidth = 4;
    g.stroke();
    g.save();
    g.rotate((a0 + a1) / 2);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.font = 'bold 17px "Lilita One", "Arial Black", sans-serif';
    g.lineWidth = 4;
    g.strokeText(rewardText(SPIN_SEGMENTS[i]!, money).replace(' Pack', ''), r - 18, 0);
    g.fillStyle = '#fff';
    g.fillText(rewardText(SPIN_SEGMENTS[i]!, money).replace(' Pack', ''), r - 18, 0);
    g.restore();
  }
  g.beginPath();
  g.arc(0, 0, 26, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.restore();
};

// ---------------------------------------------------------------- leaders

const leadersPanel = (_p: ProfileMessage, a: HudActions, ui: PanelUi): Built => {
  const rows = ui
    .boardRows()
    .sort((x, y) => y.touchdowns - x.touchdowns || y.stage - x.stage)
    .map((r, i) => `<div class="lrow ${r.me ? 'me' : ''}"><span class="t">#${i + 1}</span><div class="grow t">${esc(r.name)} <span class="rank">Lv ${r.level}${r.inMatch ? ' · in a game' : ''}</span></div><span class="t">Stage ${r.stage}</span><span class="t gold">${r.touchdowns} TD</span></div>`)
    .join('');
  const global = a.openBoxityBoard;
  const body = html(`<div><div class="lb">${rows}</div>${global ? '<div class="center"><button class="btn gold t weekly">Weekly Touchdowns (all players)</button></div>' : ''}</div>`);
  body.querySelector('.weekly')?.addEventListener('click', () => {
    if (global?.()) ui.close();
    else ui.toast('The global leaderboard opens on Bloxity.');
  });
  return { title: 'This Server', theme: 'slate', body };
};

// ---------------------------------------------------------------- registry

export const PANELS: Record<string, (p: ProfileMessage, a: HudActions, ui: PanelUi) => Built> = {
  cards: cardsPanel,
  index: indexPanel,
  upgrades: upgradesPanel,
  style: stylePanel,
  packs: packsPanel,
  shop: (p, a, ui) => {
    ui.tab['packs'] = 'shop';
    return { ...packsPanel(p, a, ui), title: 'Shop' };
  },
  daily: dailyPanel,
  gift: giftPanel,
  plays: playsPanel,
  team: myTeamPanel,
  teams: teamsPanel,
  rebirth: rebirthPanel,
  settings: settingsPanel,
  pass: passPanel,
  spin: spinPanel,
  leaders: leadersPanel,
};

export { iconUpgrades };
