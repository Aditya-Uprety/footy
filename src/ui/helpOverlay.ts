// In-match key help (PLAN §6.2, M13.4): press H (or the ? button) to show the
// control tables from ui/help.ts; H, Esc or the Close button hides them. The
// match keeps running underneath: this is only a reminder, not a pause.
import { h } from './dom';
import { controlsTable } from './help';

export interface HelpOverlay {
  readonly open: boolean;
  toggle(force?: boolean): void;
  dispose(): void;
}

/** True for keys typed into a form field (never steal those). */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** `button: false` skips the floating ? button (the mode has its own crowded HUD); H still works. */
export function createHelpOverlay(parent: HTMLElement, opts: { button?: boolean } = {}): HelpOverlay {
  const close = h('button', { type: 'button', class: 'btn btn-sm', 'data-help-close': '' }, 'Close (H)');
  const card = h(
    'div',
    { class: 'panel card help help-overlay', 'data-screen': 'help', hidden: true, role: 'dialog', 'aria-label': 'Controls' },
    h('div', { class: 'help-head' }, h('h1', {}, 'Controls'), close),
    h(
      'div',
      { class: 'help-body' },
      controlsTable(),
      h('p', { class: 'help-more' }, 'Full rules: ', h('a', { href: '#/howto', target: '_blank', rel: 'noopener' }, 'How to play'), '. The match keeps running while this is open.'),
    ),
  );
  const fab = h('button', { type: 'button', class: 'help-fab', 'data-help-open': '', title: 'Controls (H)', 'aria-label': 'Show controls (H)' }, '?');
  parent.append(card);
  if (opts.button !== false) parent.append(fab);

  let open = false;
  function toggle(force?: boolean): void {
    open = force ?? !open;
    card.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.code === 'KeyH') {
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
    dispose() {
      window.removeEventListener('keydown', onKey);
      fab.remove();
      card.remove();
    },
  };
}
