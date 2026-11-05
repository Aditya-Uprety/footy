// Match log and stats (M15.3): the stats table and kick list shown on the
// full-time card, and an in-match panel (L or the Log button) with the same
// content. Both read the *shown* state, so nothing appears before its
// playback has been watched.
import { matchStats } from '../game/matchLog';
import type { GameState, Team } from '../game/types';
import { logLine, seatNameOf, STAT_ROWS, TEAM_KIT } from '../app/matchText';
import { h } from './dom';

type StatState = Pick<GameState, 'log' | 'players' | 'toss' | 'seatNames'>;

/** Stats as a three-column table: team 0 · stat · team 1, with a bar for possession. */
export function statsTable(s: StatState): HTMLElement {
  const st = matchStats(s.log);
  const head = (t: Team): HTMLElement =>
    h('th', { class: `stat-team team-${t}` }, TEAM_KIT[t], h('small', {}, seatNameOf(s, t)));
  const val = (t: Team, key: (typeof STAT_ROWS)[number]['key'], unit: string): string => `${st[t][key]}${unit}`;
  const rows = STAT_ROWS.map((r) => {
    const unit = r.unit ?? '';
    const lead = st[0][r.key] === st[1][r.key] ? null : st[0][r.key] > st[1][r.key] ? 0 : 1;
    return h(
      'tr',
      { 'data-stat': r.key },
      h('td', { class: `stat-val${lead === 0 ? ' lead' : ''}` }, val(0, r.key, unit)),
      h('td', { class: 'stat-label' }, r.label),
      h('td', { class: `stat-val${lead === 1 ? ' lead' : ''}` }, val(1, r.key, unit)),
    );
  });
  const bar = h(
    'div',
    { class: 'stat-bar', 'aria-hidden': 'true' },
    h('span', { class: 'team-0', style: `width:${st[0].possession}%` }),
    h('span', { class: 'team-1', style: `width:${st[1].possession}%` }),
  );
  return h(
    'div',
    { class: 'stats' },
    h('table', { class: 'stats-table' }, h('thead', {}, h('tr', {}, head(0), h('th', {}), head(1))), h('tbody', {}, ...rows)),
    s.log.length > 0 ? bar : null,
  );
}

/** The kick list, one row per kick, goals highlighted; a divider marks half-time. */
export function logList(s: StatState): HTMLElement {
  if (s.log.length === 0) return h('p', { class: 'log-empty' }, 'No kicks yet.');
  const items: HTMLElement[] = [];
  let prevHalf: 1 | 2 = 1;
  for (const e of s.log) {
    if (e.half !== prevHalf) items.push(h('li', { class: 'log-break' }, 'Half-time'));
    prevHalf = e.half;
    const l = logLine(e, s.players);
    items.push(
      h(
        'li',
        { class: `log-row team-${l.team}${l.goal ? ' log-goal' : ''}`, 'data-kick': l.n },
        h('span', { class: 'log-n' }, String(l.n)),
        h('span', { class: 'log-text' }, h('strong', {}, l.who), ` — ${l.what}`, l.then ? h('em', {}, ` → ${l.then}`) : null),
      ),
    );
  }
  return h('ol', { class: 'log-list' }, ...items);
}

/** True for keys typed into a form field (never steal those). */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

export interface MatchLogPanel {
  readonly open: boolean;
  toggle(force?: boolean): void;
  /** The state now on screen; the open panel refreshes when it changes. */
  update(s: StatState): void;
  dispose(): void;
}

/** In-match panel: L or the Log button toggles it, Esc / Close hides it. The match keeps running. */
export function createMatchLogPanel(parent: HTMLElement, initial: StatState): MatchLogPanel {
  let state = initial;
  const close = h('button', { type: 'button', class: 'btn btn-sm', 'data-log-close': '' }, 'Close (L)');
  const body = h('div', { class: 'help-body log-body' });
  const card = h(
    'div',
    { class: 'panel card help log-panel', 'data-screen': 'matchlog', hidden: true, role: 'dialog', 'aria-label': 'Match log' },
    h('div', { class: 'help-head' }, h('h1', {}, 'Match log'), close),
    body,
  );
  const fab = h('button', { type: 'button', class: 'help-fab log-fab', 'data-log-open': '', title: 'Match log (L)', 'aria-label': 'Show match log (L)' }, 'L');
  parent.append(card, fab);

  let open = false;
  function render(): void {
    body.replaceChildren(statsTable(state), h('h3', { class: 'log-title' }, 'Kick by kick'), logList(state));
    const list = body.querySelector('.log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }
  function toggle(force?: boolean): void {
    open = force ?? !open;
    card.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    if (open) render();
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.code === 'KeyL') {
      e.preventDefault();
      toggle();
    } else if (e.code === 'Escape' && open) {
      toggle(false);
    }
  };
  window.addEventListener('keydown', onKey);
  fab.addEventListener('click', () => toggle());
  close.addEventListener('click', () => toggle(false));

  return {
    get open() {
      return open;
    },
    toggle,
    update(s) {
      const changed = s.log !== state.log || s.players !== state.players;
      state = s;
      if (open && changed) render();
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      fab.remove();
      card.remove();
    },
  };
}
