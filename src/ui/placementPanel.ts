// Draft overlays (PLAN §9, M7.3–M7.4): the pick banner at the top
// ("Blue — place 2 · pick 4/12"), a side panel (keeper toggle, Undo,
// Confirm, what blocks Confirm, ring legend, controls) and the hover tooltip
// that follows the cursor with the reason a spot is red.
import type { Team } from '../game/types';
import { kitOf } from '../shared/kits';
import { h } from './dom';

export const KIT_NAME: Readonly<Record<Team, string>> = {
  get 0() {
    return kitOf(0).name;
  },
  get 1() {
    return kitOf(1).name;
  },
};

export interface PanelInfo {
  team: Team;
  seatName: string;
  /** 0-based pick index and the total. */
  pick: number;
  picks: number;
  /** Players this pick places, and how many are placed so far. */
  count: number;
  placed: number;
  /** The team's confirmed players before this pick, and the team size. */
  teamBefore: number;
  teamSize: number;
  gk: { has: boolean; forced: boolean; locked: boolean; next: boolean; toggleable: boolean };
  /** What blocks Confirm (empty = ready). */
  issues: string[];
  /** Spacing settings for the legend. */
  x: number;
  y: number;
  /** This device can't act: e.g. "Waiting for Bob…" (online). */
  waiting?: string;
}

export interface PlacementPanel {
  readonly banner: HTMLElement;
  readonly el: HTMLElement;
  readonly tooltip: HTMLElement;
  render(info: PanelInfo): void;
  /** Shows the tooltip at client (x, y) with a line of text; ok = green. Null hides it. */
  tip(at: { x: number; y: number; text: string; ok: boolean } | null): void;
  /** A short message under the buttons (e.g. a refused pick). */
  flash(text: string): void;
  /** The placement timer in the banner (null hides it); warn = last seconds. */
  setTimer(t: { text: string; warn: boolean } | null): void;
  onGk(cb: () => void): void;
  onUndo(cb: () => void): void;
  onConfirm(cb: () => void): void;
  dispose(): void;
}

export function createPlacementPanel(): PlacementPanel {
  const banner = h('div', { class: 'pick-banner', 'data-screen': 'placement' });
  const timerEl = h('span', { class: 'pp-timer', hidden: true, 'aria-label': 'Time left for this pick' });
  const who = h('div', { class: 'pp-who' });
  const side = h('div', { class: 'pp-side' });
  const progress = h('div', { class: 'pp-progress' });
  const gkBtn = h('button', { type: 'button', class: 'btn pp-gk', title: 'Goalkeeper (G)' });
  const gkHint = h('div', { class: 'pp-gk-hint' });
  const undoBtn = h('button', { type: 'button', class: 'btn', title: 'Undo (Z or Backspace)' }, 'Undo');
  const confirmBtn = h('button', { type: 'button', class: 'btn btn-primary', title: 'Confirm (Enter)' }, 'Confirm');
  const issues = h('ul', { class: 'pp-issues', 'aria-live': 'polite' });
  const flashEl = h('div', { class: 'pp-flash', hidden: true });
  const legendX = h('span', {});
  const legendY = h('span', {});
  const iconOwn = h('i', { class: 'lg lg-ring' });
  const iconOpp = h('i', { class: 'lg lg-ring' });
  const legend = h(
    'div',
    { class: 'pp-legend' },
    h('div', {}, iconOwn, legendX),
    h('div', {}, iconOpp, legendY),
    h('div', {}, h('i', { class: 'lg lg-nogo' }), 'No-go: center circle, their box, 1 m from the lines'),
    h('div', {}, h('i', { class: 'lg lg-box' }), 'Your box: the keeper stands here'),
  );
  const keys = h(
    'p',
    { class: 'pp-keys' },
    'Click: place · drag a player: move · right-click: remove',
    h('br'),
    'Drag: pan (or WASD) · right-drag: rotate · wheel: zoom · T: top view',
  );
  const el = h(
    'div',
    { class: 'panel placement-panel', 'data-screen': 'placement-panel' },
    who,
    side,
    progress,
    gkBtn,
    gkHint,
    h('div', { class: 'pp-buttons' }, undoBtn, confirmBtn),
    issues,
    flashEl,
    legend,
    keys,
  );
  const tooltip = h('div', { class: 'pp-tooltip', hidden: true });

  // Keep keyboard focus off the buttons so Space/Enter go to the view's handlers.
  for (const b of [gkBtn, undoBtn, confirmBtn]) b.addEventListener('mouseup', () => b.blur());

  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    banner,
    el,
    tooltip,
    render(i) {
      const kit = KIT_NAME[i.team];
      const n = i.count;
      banner.className = `pick-banner team-${i.team}`;
      banner.textContent = '';
      banner.append(
        h('strong', {}, `${kit} — place ${n}`),
        h('span', {}, ` · pick ${i.pick + 1}/${i.picks}`),
        timerEl,
        h('small', {}, i.waiting ?? `${i.seatName}’s turn`),
      );
      who.className = `pp-who team-${i.team}`;
      who.textContent = `${i.seatName} · ${kit}`;
      side.textContent = `Defends the ${kit.toUpperCase()} GOAL · attacks the ${KIT_NAME[i.team === 0 ? 1 : 0].toUpperCase()} GOAL`;
      progress.textContent = `This pick ${i.placed}/${n} · team ${i.teamBefore + i.placed}/${i.teamSize}`;

      el.classList.toggle('waiting', !!i.waiting);
      gkBtn.textContent = i.gk.has ? 'Keeper ✓' : i.gk.next ? 'Goalkeeper: ON' : 'Goalkeeper: off';
      gkBtn.classList.toggle('active', i.gk.next);
      gkBtn.disabled = !!i.waiting || !i.gk.toggleable;
      gkHint.textContent = i.gk.has
        ? ''
        : i.gk.locked
          ? 'Your last player must be the keeper: place them in your box.'
          : i.gk.next
            ? 'Click in your own box to place the keeper.'
            : i.gk.forced
              ? 'This is your last pick: one of these players must be the keeper.'
              : 'Turn on to place your keeper (in your own box).';
      gkHint.classList.toggle('forced', i.gk.forced && !i.gk.has);

      undoBtn.disabled = !!i.waiting || i.placed === 0;
      confirmBtn.disabled = !!i.waiting || i.issues.length > 0;
      issues.textContent = '';
      for (const m of i.issues) issues.append(h('li', {}, m));
      iconOwn.className = `lg lg-ring team-${i.team}`;
      iconOpp.className = `lg lg-ring team-${i.team === 0 ? 1 : 0}`;
      legendX.textContent = `${i.x} m from your players (X)`;
      legendY.textContent = `${i.y} m from opponents (Y)`;
    },
    tip(at) {
      tooltip.hidden = !at;
      if (!at) return;
      tooltip.textContent = at.text;
      tooltip.className = `pp-tooltip ${at.ok ? 'ok' : 'bad'}`;
      tooltip.style.transform = `translate(${Math.round(at.x + 16)}px, ${Math.round(at.y + 18)}px)`;
    },
    setTimer(t) {
      timerEl.hidden = !t;
      if (!t) return;
      if (timerEl.textContent !== t.text) timerEl.textContent = t.text;
      timerEl.classList.toggle('warn', t.warn);
    },
    flash(text) {
      flashEl.textContent = text;
      flashEl.hidden = false;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (flashEl.hidden = true), 3500);
    },
    onGk(cb) {
      gkBtn.addEventListener('click', cb);
    },
    onUndo(cb) {
      undoBtn.addEventListener('click', cb);
    },
    onConfirm(cb) {
      confirmBtn.addEventListener('click', cb);
    },
    dispose() {
      if (flashTimer) clearTimeout(flashTimer);
      banner.remove();
      el.remove();
      tooltip.remove();
    },
  };
}
