// Touch controls (PLAN §6.2, M16.1): a small column of large buttons for the
// things a keyboard does on desktop — hold-to-see the overhead map (Tab),
// hold-to-fast-forward (F), the playback camera (C) and the camera height
// (PageUp / PageDown). Drag-to-turn and pinch-to-zoom live in the aim rig, the
// sliders are in the kick bar (bigger handles on touch screens, see the CSS).
//
// The bar exists only on touch devices (`(pointer: coarse)`) or with ?touch.
// It adds no information: no facing, no trajectory, nothing about the aim.
import { h } from './dom';

/** True on a touch-first device, or when ?touch asks for the touch UI. */
export function isTouchUi(flagTouch = false): boolean {
  if (flagTouch) return true;
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Camera-height change per tap, m. */
export const HEIGHT_TAP_STEP = 0.5;

const ARIA: Record<string, string> = { camera: 'Change camera', higher: 'Camera higher', lower: 'Camera lower' };

export interface TouchBarOptions {
  overlay: HTMLElement;
  /** CSS top offset when the default (under the match buttons) is taken, e.g. below the Practice card. */
  top?: string;
  /** Same for the phone-landscape layout, where the bar is a column on the left edge (M16.2). */
  topCompact?: string;
  /** Hold: the overhead map. */
  onMap(on: boolean): void;
  /** Hold: fast-forward the playback. */
  onFast(on: boolean): void;
  /** Tap: next playback camera (chase ↔ broadcast, in a replay chase → broadcast → behind goal). */
  onCamera(): void;
  /** Tap: camera height ±HEIGHT_TAP_STEP (the caller clamps). */
  onHeight(delta: number): void;
}

export interface TouchBar {
  readonly el: HTMLElement;
  setHidden(hidden: boolean): void;
  dispose(): void;
}

export function createTouchBar(opts: TouchBarOptions): TouchBar {
  /** A button that is on while a finger is down on it (and off if the touch is cancelled). */
  function holdButton(label: string, sub: string, name: string, cb: (on: boolean) => void): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'tb-btn', 'data-touch': name, 'aria-label': `${label} (hold)` }, h('span', { class: 'tb-icon' }, label), h('small', {}, sub));
    let id: number | null = null;
    const end = (ev: PointerEvent): void => {
      if (id !== ev.pointerId) return;
      id = null;
      b.classList.remove('down');
      b.releasePointerCapture?.(ev.pointerId);
      cb(false);
    };
    b.addEventListener('pointerdown', (ev) => {
      if (id !== null || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      id = ev.pointerId;
      b.setPointerCapture?.(ev.pointerId);
      b.classList.add('down');
      ev.preventDefault();
      cb(true);
    });
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return b;
  }
  function tapButton(label: string, sub: string, name: string, cb: () => void): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'tb-btn', 'data-touch': name, 'aria-label': ARIA[name] ?? sub }, h('span', { class: 'tb-icon' }, label), h('small', {}, sub));
    b.addEventListener('click', () => {
      cb();
      b.blur();
    });
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return b;
  }

  const el = h(
    'div',
    { class: 'panel touch-bar', 'data-panel': 'touch' },
    holdButton('🗺', 'Map', 'map', opts.onMap),
    holdButton('⏩', 'Fast', 'fast', opts.onFast),
    tapButton('🎥', 'Cam', 'camera', opts.onCamera),
    tapButton('▲', 'Up', 'higher', () => opts.onHeight(HEIGHT_TAP_STEP)),
    tapButton('▼', 'Down', 'lower', () => opts.onHeight(-HEIGHT_TAP_STEP)),
  );
  if (opts.top) el.style.setProperty('--tb-top', opts.top);
  if (opts.topCompact) el.style.setProperty('--tb-top-compact', opts.topCompact);
  opts.overlay.append(el);
  return {
    el,
    setHidden(hidden) {
      el.hidden = hidden;
    },
    dispose() {
      el.remove();
    },
  };
}
