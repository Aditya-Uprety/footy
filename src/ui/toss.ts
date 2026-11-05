// Coin toss + role choice (PLAN §2.1, §9, M7.2). The host has already drawn
// the winner; this screen flips a coin that lands on the winner's face, then
// the winner picks a role card. Click the coin (or press a key) to skip.
import type { Seat } from '../game/types';
import { kitOf } from '../shared/kits';
import { h } from './dom';

export type Role = 'A' | 'B';

export interface TossOptions {
  names: readonly [string, string];
  winner: Seat;
  /** Can this device choose for the winner? (hot-seat: always; online: only the winner's device). */
  canChoose: boolean;
  /** Skip the flip (e.g. the screen is re-shown after a reconnect). */
  instant?: boolean;
  onChoose(role: Role): void;
}

export interface TossScreen {
  readonly el: HTMLElement;
  /** True once the coin has landed and the roles are shown. */
  readonly landed: boolean;
  /** Ends the flip at once. */
  skip(): void;
  dispose(): void;
}

/** Flip length, ms. */
export const TOSS_FLIP_MS = 1900;
const TURNS = 5;

export const ROLE_TEXT: Readonly<Record<Role, { title: string; readonly kit: string; lines: string[] }>> = {
  A: {
    title: 'Team A',
    get kit() {
      return kitOf(0).name;
    },
    lines: ['Place the first player', 'Take the opening kickoff'],
  },
  B: {
    title: 'Team B',
    get kit() {
      return kitOf(1).name;
    },
    lines: ['Place the last player', 'Kick off the second half'],
  },
};

export function createTossScreen(opts: TossOptions): TossScreen {
  const { names, winner } = opts;
  const face = (seat: Seat): HTMLElement =>
    h('div', { class: `coin-face coin-face-${seat}` }, h('span', { class: 'coin-num' }, String(seat + 1)), h('span', { class: 'coin-name' }, names[seat]));
  const coin = h('div', { class: 'coin' }, face(0), face(1));
  const coinWrap = h('button', { type: 'button', class: 'coin-wrap', title: 'Skip', 'aria-label': 'Coin (click to skip)' }, coin);
  const status = h('p', { class: 'toss-status', 'aria-live': 'polite' }, 'Tossing the coin…');
  const roles = h('div', { class: 'toss-roles', hidden: true });
  const el = h(
    'div',
    { class: 'panel card toss', 'data-screen': 'toss' },
    h('h1', {}, 'Coin toss'),
    h('p', { class: 'toss-faces' }, `Heads ${names[0]} · Tails ${names[1]}`),
    coinWrap,
    status,
    roles,
  );

  const card = (role: Role): HTMLButtonElement => {
    const t = ROLE_TEXT[role];
    const btn = h(
      'button',
      { type: 'button', class: `role-card role-${role}`, 'data-role': role, disabled: !opts.canChoose },
      h('strong', {}, `${t.title} · ${t.kit}`),
      h('ul', {}, ...t.lines.map((l) => h('li', {}, l))),
    );
    btn.addEventListener('click', () => {
      if (chosen) return;
      chosen = true;
      for (const b of roles.querySelectorAll('button')) (b as HTMLButtonElement).disabled = true;
      btn.classList.add('chosen');
      opts.onChoose(role);
    });
    return btn;
  };

  let chosen = false;
  let landed = false;
  const endAngle = TURNS * 360 + (winner === 1 ? 180 : 0);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let anim: Animation | null = null;

  function land(): void {
    if (landed) return;
    landed = true;
    anim?.finish();
    coin.style.transform = `rotateY(${endAngle}deg)`;
    coinWrap.disabled = true;
    coinWrap.classList.add('landed');
    status.textContent = '';
    status.append(h('strong', {}, names[winner]), ' wins the toss', opts.canChoose ? ' and picks a side:' : '.');
    if (!opts.canChoose) status.append(h('br'), h('span', { class: 'toss-wait' }, `Waiting for ${names[winner]} to choose…`));
    roles.append(card('A'), card('B'));
    roles.hidden = false;
    window.removeEventListener('keydown', onKey);
    if (opts.canChoose) (roles.firstElementChild as HTMLElement | null)?.focus();
  }

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    land();
  };

  if (opts.instant || reduce || typeof coin.animate !== 'function') {
    queueMicrotask(land);
  } else {
    anim = coin.animate(
      [
        { transform: 'translateY(0) rotateY(0deg)', offset: 0 },
        { transform: `translateY(-70px) rotateY(${endAngle * 0.5}deg)`, offset: 0.45 },
        { transform: `translateY(0) rotateY(${endAngle}deg)`, offset: 1 },
      ],
      { duration: TOSS_FLIP_MS, easing: 'cubic-bezier(0.25, 0.7, 0.35, 1)', fill: 'forwards' },
    );
    anim.onfinish = land;
    coinWrap.addEventListener('click', land);
    window.addEventListener('keydown', onKey);
  }

  return {
    el,
    get landed() {
      return landed;
    },
    skip: land,
    dispose() {
      anim?.cancel();
      window.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
