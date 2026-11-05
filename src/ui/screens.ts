// Half-time and full-time overlays (PLAN §2.7, §9, M8.4).
import type { Team } from '../game/types';
import { h } from './dom';

/** The half-time card closes by itself after this long, s (well inside the host guard's 15 s grace, §8.4). */
export const HALF_TIME_AUTO_SEC = 6;

export interface ScoreCardInfo {
  names: [string, string];
  kits: [string, string];
  score: [number, number];
}

function scoreRow(i: ScoreCardInfo): HTMLElement {
  const side = (t: Team) =>
    h('div', { class: `ov-team team-${t}` }, h('strong', {}, i.kits[t]), h('small', {}, i.names[t]));
  return h('div', { class: 'ov-score' }, side(0), h('span', { class: 'ov-goals' }, `${i.score[0]} – ${i.score[1]}`), side(1));
}

export interface HalfTimeOptions extends ScoreCardInfo {
  /** "Blue kicks off the 2nd half". */
  note: string;
  onContinue(): void;
  autoSec?: number;
}

export interface Overlay {
  readonly el: HTMLElement;
  dispose(): void;
}

/** "Half-time" with the score; Continue (or Space/Enter, or the countdown) closes it. */
export function createHalfTimeOverlay(o: HalfTimeOptions): Overlay & { update(dt: number): void } {
  let left = o.autoSec ?? HALF_TIME_AUTO_SEC;
  let done = false;
  const btn = h('button', { type: 'button', class: 'btn btn-primary' }, '');
  const label = (): string => `Continue (${Math.max(0, Math.ceil(left))})`;
  btn.textContent = label();
  const el = h(
    'div',
    { class: 'panel card overlay-card', 'data-screen': 'halftime' },
    h('h1', {}, 'Half-time'),
    scoreRow(o),
    h('p', {}, o.note),
    h('div', { class: 'card-actions end' }, btn),
  );
  function finish(): void {
    if (done) return;
    done = true;
    o.onContinue();
  }
  btn.addEventListener('click', finish);
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      finish();
    }
  };
  window.addEventListener('keydown', onKey);
  return {
    el,
    update(dt) {
      if (done) return;
      left -= dt;
      btn.textContent = label();
      if (left <= 0) finish();
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}

export interface FullTimeOptions extends ScoreCardInfo {
  headline: string;
  winner: Team | null;
  /** True once this device has voted (button disabled, "waiting for …"). */
  voted: boolean;
  waitingFor: string | null;
  onRematch(): void;
  /** Stats table and kick list (M15.3), shown under the score. */
  details?: HTMLElement[];
}

/** Full-time: result, score, Rematch (new toss + draft) and Menu. */
export function createFullTimeScreen(o: FullTimeOptions): Overlay & { update(o: Pick<FullTimeOptions, 'voted' | 'waitingFor'>): void } {
  const rematch = h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'rematch' }, 'Rematch');
  const status = h('p', { class: 'ov-status' });
  rematch.addEventListener('click', () => {
    rematch.disabled = true;
    o.onRematch();
  });
  const el = h(
    'div',
    { class: 'panel card overlay-card overlay-wide', 'data-screen': 'fulltime' },
    h('h1', {}, 'Full-time'),
    h('div', { class: `ov-headline${o.winner === null ? '' : ` team-${o.winner}`}` }, o.headline),
    scoreRow(o),
    ...(o.details ?? []),
    status,
    h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu'), rematch),
  );
  function update(u: Pick<FullTimeOptions, 'voted' | 'waitingFor'>): void {
    rematch.disabled = u.voted;
    status.textContent = u.voted && u.waitingFor ? `Waiting for ${u.waitingFor}…` : 'Rematch: a new coin toss and a fresh draft.';
  }
  update(o);
  return {
    el,
    update,
    dispose() {
      el.remove();
    },
  };
}
