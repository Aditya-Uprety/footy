// Match HUD (PLAN §9, M8.3): scoreboard (names, kit colors, score), kick
// counter and half, shot-timer ring (red under 5 s), possession banner,
// event toasts. Functional look; the full theme arrives in M13.1.
import type { ToastText } from '../app/matchText';
import type { Team } from '../game/types';
import { h } from './dom';

/** How long a toast stays up, ms. */
export const HUD_TOAST_MS = 2000;
/** Ring geometry (SVG units). */
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

export interface HudScore {
  names: [string, string];
  kits: [string, string];
  score: [number, number];
  counter: string;
}

export interface HudPossession {
  team: Team;
  text: string;
  /** Second line, e.g. "Ann to kick" or "Ball in play…". */
  sub: string;
}

export interface Hud {
  readonly el: HTMLElement;
  setScore(s: HudScore): void;
  setPossession(p: HudPossession | null): void;
  /** Shot timer: null hides the ring. */
  setTimer(t: { fraction: number; text: string; warn: boolean } | null): void;
  toast(t: ToastText): void;
  setHidden(hidden: boolean): void;
  dispose(): void;
}

export function createHud(): Hud {
  const nameA = h('span', { class: 'sb-name' });
  const nameB = h('span', { class: 'sb-name' });
  const kitA = h('span', { class: 'sb-kit team-0' });
  const kitB = h('span', { class: 'sb-kit team-1' });
  const goals = h('span', { class: 'sb-goals' });
  const counter = h('div', { class: 'sb-counter' });
  const board = h(
    'div',
    { class: 'scoreboard', 'data-hud': 'score' },
    h('div', { class: 'sb-row' }, h('div', { class: 'sb-side sb-a' }, nameA, kitA), goals, h('div', { class: 'sb-side sb-b' }, kitB, nameB)),
    counter,
  );

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'timer-svg');
  const track = document.createElementNS(ns, 'circle');
  const arc = document.createElementNS(ns, 'circle');
  for (const c of [track, arc]) {
    c.setAttribute('cx', '20');
    c.setAttribute('cy', '20');
    c.setAttribute('r', String(RING_R));
  }
  track.setAttribute('class', 'timer-track');
  arc.setAttribute('class', 'timer-arc');
  arc.setAttribute('stroke-dasharray', String(RING_C));
  svg.append(track, arc);
  const timerNum = h('span', { class: 'timer-num' });
  const timer = h('div', { class: 'shot-timer', 'data-hud': 'timer', hidden: true }, svg, timerNum);

  const possText = h('strong', {});
  const possSub = h('small', {});
  const poss = h('div', { class: 'poss-banner', 'data-hud': 'possession', hidden: true }, timer, h('div', { class: 'poss-text' }, possText, possSub));

  const menu = h('a', { class: 'hud-menu panel', href: '#/' }, '← Menu');
  const toastEl = h('div', { class: 'toast', hidden: true, 'data-hud': 'toast' });
  const toastSub = h('small', {});
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const el = h('div', { class: 'match-hud' }, menu, board, poss, toastEl);

  let lastTimerText = '';
  return {
    el,
    setScore(s) {
      nameA.textContent = s.names[0];
      nameB.textContent = s.names[1];
      kitA.textContent = s.kits[0];
      kitB.textContent = s.kits[1];
      goals.textContent = `${s.score[0]} – ${s.score[1]}`;
      counter.textContent = s.counter;
    },
    setPossession(p) {
      poss.hidden = !p;
      if (!p) return;
      poss.className = `poss-banner team-${p.team}`;
      possText.textContent = p.text;
      possSub.textContent = p.sub;
    },
    setTimer(t) {
      timer.hidden = !t;
      if (!t) return;
      arc.setAttribute('stroke-dashoffset', String(RING_C * (1 - Math.max(0, Math.min(1, t.fraction)))));
      timer.classList.toggle('warn', t.warn);
      if (t.text !== lastTimerText) {
        lastTimerText = t.text;
        timerNum.textContent = t.text;
      }
    },
    toast(t) {
      toastEl.textContent = t.text;
      if (t.sub) {
        toastSub.textContent = t.sub;
        toastEl.append(toastSub);
      }
      toastEl.className = `toast toast-${t.kind}`;
      toastEl.hidden = false;
      // Restart the pop-in animation.
      toastEl.style.animation = 'none';
      void toastEl.offsetWidth;
      toastEl.style.animation = '';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, HUD_TOAST_MS);
    },
    setHidden(hidden) {
      el.hidden = hidden;
    },
    dispose() {
      if (toastTimer) clearTimeout(toastTimer);
      el.remove();
    },
  };
}
