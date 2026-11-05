// Main menu and hot-seat setup (PLAN §9, M7.1). Hot-seat, online host/join
// (M9), Practice and (dev builds) the Physics Lab; How-to-play arrives in M13.
import { defaultName, NAME_MAX } from '../game/rules';
import type { Seat } from '../game/types';
import { h } from './dom';

export interface MenuOptions {
  /** Show the Physics Lab entry (dev builds and ?debug). */
  dev: boolean;
}

/** The main menu card. */
export function menuScreen(opts: MenuOptions): HTMLElement {
  const item = (href: string, label: string, sub: string, primary = false): HTMLElement =>
    h('a', { class: `menu-item${primary ? ' primary' : ''}`, href }, h('strong', {}, label), h('small', {}, sub));
  return h(
    'div',
    { class: 'panel card menu', 'data-screen': 'menu' },
    h('h1', { class: 'menu-title' }, 'Footy'),
    h('p', { class: 'menu-sub' }, 'Turn-based 3D football. Place your eleven, then kick by feel: no aim line, no preview.'),
    h(
      'nav',
      { class: 'menu-items' },
      item('#/hotseat', 'Play hot-seat', 'Two players, one device', true),
      item('#/host', 'Host online', 'Create a room and send the link'),
      item('#/join', 'Join online', 'Enter a friend’s room code'),
      item('#/practice', 'Practice', 'Kick around on your own'),
      opts.dev ? item('#/lab', 'Physics Lab', 'Dev tool') : null,
    ),
  );
}

export interface SetupOptions {
  /** Prefilled names. */
  names?: [string, string];
  onStart(names: [string, string]): void;
}

/** Hot-seat setup: two names → Start (Enter also starts). Empty names fall back to Player 1 / Player 2. */
export function hotseatSetupScreen(opts: SetupOptions): HTMLElement {
  const field = (seat: Seat): HTMLInputElement =>
    h('input', {
      type: 'text',
      name: `name${seat + 1}`,
      maxlength: NAME_MAX,
      placeholder: defaultName(seat),
      value: opts.names?.[seat] ?? '',
      autocomplete: 'off',
      spellcheck: 'false',
    });
  const inputs = [field(0), field(1)] as const;
  const form = h(
    'form',
    { class: 'setup-form' },
    ...inputs.map((input, seat) =>
      h('label', { class: 'setup-field' }, h('span', {}, `Player ${seat + 1}`), input),
    ),
    h('p', { class: 'setup-note' }, 'A coin toss decides who picks a side. Then you take turns placing players on this screen.'),
    h(
      'div',
      { class: 'card-actions' },
      h('a', { class: 'btn', href: '#/' }, '← Menu'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Start'),
    ),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    opts.onStart([inputs[0].value, inputs[1].value]);
  });
  const root = h('div', { class: 'panel card setup', 'data-screen': 'hotseat-setup' }, h('h1', {}, 'Hot-seat match'), form);
  queueMicrotask(() => inputs[0].focus());
  return root;
}
