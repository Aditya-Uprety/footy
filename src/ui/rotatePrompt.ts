// "Rotate your device" prompt (PLAN §12 M16.2). Footy is laid out for landscape:
// a phone held upright (a narrow touch screen taller than it is wide) gets a
// full-screen card asking to turn it. Tablets, desktop windows and anything wide
// enough are left alone. "Play anyway" hides the card until the page is reloaded.
import { h } from './dom';
import { isTouchUi } from './touchBar';

/** A portrait screen narrower than this (CSS px) counts as a phone; tablets (≥ 600) are fine upright. */
export const PORTRAIT_PHONE_MAX_WIDTH = 600;

export interface ScreenInfo {
  width: number;
  height: number;
  /** A touch-first device, or ?touch. */
  touch: boolean;
}

/** True when the prompt should be up: a touch phone held in portrait. Pure, so it is unit-tested. */
export function needsRotatePrompt(s: ScreenInfo): boolean {
  return s.touch && s.height > s.width && s.width < PORTRAIT_PHONE_MAX_WIDTH;
}

const ICON =
  '<svg class="rotate-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="18" y="6" width="28" height="52" rx="5"/><path d="M29 51h6"/></svg>';

export interface RotatePrompt {
  readonly el: HTMLElement;
  /** Re-read the screen size (called on resize and orientation change). */
  update(): void;
  dispose(): void;
}

export function createRotatePrompt(parent: HTMLElement, opts: { touchFlag?: boolean } = {}): RotatePrompt {
  let dismissed = false;
  const icon = h('div', {});
  icon.innerHTML = ICON;
  const anyway = h('button', { type: 'button', class: 'btn btn-sm', 'data-rotate-dismiss': '' }, 'Play anyway');
  const el = h(
    'div',
    { class: 'rotate-prompt', 'data-screen': 'rotate', role: 'alertdialog', 'aria-label': 'Rotate your device', hidden: true },
    icon,
    h('h1', {}, 'Turn your phone sideways'),
    h('p', {}, 'Footy is played in landscape: the pitch, the kick bar and the map need the width.'),
    anyway,
  );
  parent.append(el);

  function update(): void {
    const show =
      !dismissed &&
      needsRotatePrompt({ width: window.innerWidth, height: window.innerHeight, touch: isTouchUi(opts.touchFlag) });
    el.hidden = !show;
  }
  anyway.addEventListener('click', () => {
    dismissed = true;
    update();
  });
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();
  return {
    el,
    update,
    dispose() {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      el.remove();
    },
  };
}
