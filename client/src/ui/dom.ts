import { CARDS, POSITION, RARITY, cardLevel, cardRating, cardStat, formatCompact } from '@mctf/shared';

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T[] => [...root.querySelectorAll<T>(sel)];
export const html = (markup: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
};
export const money = (n: number): string => `$${formatCompact(n)}`;
export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** "19h 49m" / "4m 10s" until an epoch ms. */
export const countdown = (at: number): string => {
  const ms = Math.max(0, at - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
};

/** One player card, as in the Cards panel, the Index and pack openings. */
export const cardHtml = (id: number, copies: number, opts: { equipped?: boolean; big?: boolean; isNew?: boolean; locked?: boolean } = {}): string => {
  const c = CARDS[id];
  if (!c) return '';
  const r = RARITY[c.rarity];
  if (opts.locked) {
    return `<div class="card locked" style="--rc:${r.color}"><div class="cr t">?</div><div class="silhouette"></div><div class="cn t">???</div><div class="rar t">${r.label}</div></div>`;
  }
  const rating = cardRating(id, copies);
  const lv = cardLevel(copies);
  return `<div class="card ${opts.big ? 'big' : ''} ${opts.equipped ? 'eq' : ''}" style="--rc:${r.color}" data-card="${id}">
    <div class="cr t">${rating}</div><div class="cnum t">#${c.num}</div>${opts.big ? `<div class="clv t">Lv ${lv}</div>` : ''}
    <div class="cpos t">${opts.big ? POSITION[c.pos].label : c.pos}</div>
    <div class="cfig"><i></i><b>${c.num}</b></div>
    <div class="cn t">${esc(opts.big ? c.name : c.short)}</div>
    <div class="cst t">${cardStat(c.pos, rating)}${opts.big ? ` <span>x${copies}</span>` : ''}</div>
    ${opts.big ? `<div class="rar t">${r.label}</div>` : `<div class="lvl t">Lv${lv}${copies > 1 ? ` · x${copies}` : ''}</div>`}
    ${opts.equipped ? '<div class="check">✓</div>' : ''}${opts.isNew ? '<div class="new t">NEW!</div>' : ''}
  </div>`;
};
