// Online lobby screens (PLAN §9, M9.3) and the connection overlay (M9.4).
// Dumb DOM: app/online.ts drives them from the network links.
import { defaultName, NAME_MAX } from '../game/rules';
import { ROOM_CODE_LENGTH } from '../app/router';
import { h } from './dom';

export type PillTone = 'wait' | 'ok' | 'bad';

/** "● Connected · RTT 42 ms". */
export function createNetPill(): { el: HTMLElement; set(tone: PillTone, text: string): void } {
  const text = h('span', { class: 'net-pill-text' }, '');
  const el = h('div', { class: 'net-pill wait', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'net-dot' }), text);
  return {
    el,
    set(tone, t) {
      el.className = `net-pill ${tone}`;
      text.textContent = t;
    },
  };
}

export function rttText(rtt: number | null): string {
  return rtt === null ? 'Connected · RTT …' : `Connected · RTT ${rtt} ms`;
}

function nameField(seat: 0 | 1, value: string, label: string): HTMLInputElement {
  return h('input', {
    type: 'text',
    name: 'name',
    maxlength: NAME_MAX,
    placeholder: defaultName(seat),
    value,
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': label,
  });
}

// ---------------------------------------------------------------- host

export interface HostLobby {
  readonly el: HTMLElement;
  readonly pill: ReturnType<typeof createNetPill>;
  /** Your name as typed (may be empty → default). */
  name(): string;
  setNameLocked(locked: boolean): void;
  /** Shows the code and share link (null: still creating the room). */
  setRoom(code: string | null, link: string | null): void;
  setOpponent(name: string | null): void;
  /** Shows an error with a Retry button (null clears it). */
  setError(text: string | null): void;
  setStartEnabled(on: boolean): void;
}

export interface HostLobbyOptions {
  name: string;
  onRetry(): void;
  onStart(): void;
}

export function createHostLobby(o: HostLobbyOptions): HostLobby {
  const pill = createNetPill();
  const nameInput = nameField(0, o.name, 'Your name');
  const codeEl = h('div', { class: 'room-code', 'data-code': '' }, '·····');
  const linkEl = h('input', { class: 'room-link', type: 'text', readonly: true, value: '', 'aria-label': 'Invite link' });
  const copyBtn = h('button', { type: 'button', class: 'btn', disabled: true }, 'Copy link');
  const opponent = h('p', { class: 'lobby-opponent' }, '');
  const errorEl = h('p', { class: 'lobby-error', hidden: true }, '');
  const retryBtn = h('button', { type: 'button', class: 'btn', hidden: true }, 'Retry');
  const startBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Start match');
  const startNote = h('p', { class: 'lobby-note' }, 'The online match itself arrives in the next update (M10).');

  copyBtn.addEventListener('click', () => {
    const link = linkEl.value;
    if (!link) return;
    const done = (): void => {
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => (copyBtn.textContent = 'Copy link'), 1600);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => selectLink());
    else selectLink();
  });
  function selectLink(): void {
    linkEl.focus();
    linkEl.select();
    document.execCommand?.('copy');
  }
  linkEl.addEventListener('focus', () => linkEl.select());
  retryBtn.addEventListener('click', () => o.onRetry());
  startBtn.addEventListener('click', () => o.onStart());

  const el = h(
    'div',
    { class: 'panel card lobby', 'data-screen': 'host-lobby' },
    h('h1', {}, 'Host online'),
    h('label', { class: 'setup-field' }, h('span', {}, 'Your name'), nameInput),
    h(
      'div',
      { class: 'lobby-room' },
      h('span', { class: 'lobby-label' }, 'Room code'),
      codeEl,
      h('div', { class: 'lobby-link-row' }, linkEl, copyBtn),
      h('p', { class: 'lobby-hint' }, 'Send the link (or the code) to your opponent.'),
    ),
    pill.el,
    opponent,
    errorEl,
    startNote,
    h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu'), h('span', { class: 'grow' }), retryBtn, startBtn),
  );

  return {
    el,
    pill,
    name: () => nameInput.value,
    setNameLocked(locked) {
      nameInput.disabled = locked;
    },
    setRoom(code, link) {
      codeEl.textContent = code ?? '·····';
      codeEl.dataset.code = code ?? '';
      linkEl.value = link ?? '';
      copyBtn.disabled = !link;
    },
    setOpponent(name) {
      opponent.textContent = name === null ? '' : `Opponent: ${name}`;
    },
    setError(text) {
      errorEl.hidden = text === null;
      errorEl.textContent = text ?? '';
      retryBtn.hidden = text === null;
    },
    setStartEnabled(on) {
      startBtn.disabled = !on;
    },
  };
}

// ---------------------------------------------------------------- guest

export interface JoinLobby {
  readonly el: HTMLElement;
  readonly pill: ReturnType<typeof createNetPill>;
  /** Locks the form while connecting / connected. */
  setBusy(busy: boolean): void;
  setCode(code: string): void;
  setHost(name: string | null): void;
  setError(text: string | null): void;
}

export interface JoinLobbyOptions {
  code: string;
  name: string;
  onJoin(code: string, name: string): void;
  onLeave(): void;
}

export function createJoinLobby(o: JoinLobbyOptions): JoinLobby {
  const pill = createNetPill();
  pill.el.hidden = true;
  const nameInput = nameField(1, o.name, 'Your name');
  const codeInput = h('input', {
    type: 'text',
    name: 'code',
    class: 'code-input',
    maxlength: ROOM_CODE_LENGTH + 2,
    placeholder: 'ABCDE',
    value: o.code,
    autocomplete: 'off',
    spellcheck: 'false',
    autocapitalize: 'characters',
    'aria-label': 'Room code',
  });
  codeInput.addEventListener('input', () => {
    const pos = codeInput.selectionStart;
    codeInput.value = codeInput.value.toUpperCase();
    if (pos !== null) codeInput.setSelectionRange(pos, pos);
  });
  const hostEl = h('p', { class: 'lobby-opponent' }, '');
  const errorEl = h('p', { class: 'lobby-error', hidden: true }, '');
  const joinBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Join');
  const leaveBtn = h('button', { type: 'button', class: 'btn', hidden: true }, 'Leave');
  const note = h('p', { class: 'lobby-note', hidden: true }, 'Waiting for the host to start. The online match itself arrives in the next update (M10).');
  leaveBtn.addEventListener('click', () => o.onLeave());

  const form = h(
    'form',
    { class: 'setup-form' },
    h('label', { class: 'setup-field' }, h('span', {}, 'Your name'), nameInput),
    h('label', { class: 'setup-field' }, h('span', {}, 'Room code'), codeInput),
    pill.el,
    hostEl,
    errorEl,
    note,
    h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu'), h('span', { class: 'grow' }), leaveBtn, joinBtn),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    o.onJoin(codeInput.value, nameInput.value);
  });

  const el = h('div', { class: 'panel card lobby', 'data-screen': 'join-lobby' }, h('h1', {}, 'Join online'), form);
  if (!o.code) queueMicrotask(() => codeInput.focus());

  return {
    el,
    pill,
    setBusy(busy) {
      nameInput.disabled = busy;
      codeInput.disabled = busy;
      joinBtn.hidden = busy;
      leaveBtn.hidden = !busy;
      pill.el.hidden = !busy;
    },
    setCode(code) {
      codeInput.value = code;
    },
    setHost(name) {
      hostEl.textContent = name === null ? '' : `Host: ${name}`;
      note.hidden = name === null;
    },
    setError(text) {
      errorEl.hidden = text === null;
      errorEl.textContent = text ?? '';
    },
  };
}

// ---------------------------------------------------------------- connection overlay

export interface OverlayAction {
  label: string;
  primary?: boolean;
  onClick(): void;
}

/** A dimmed full-screen card: "Connection lost — reconnecting…", "Opponent disconnected" (§8.5). */
export function createConnectionOverlay(o: { title: string; text: string; actions: OverlayAction[] }): {
  el: HTMLElement;
  dispose(): void;
} {
  const el = h(
    'div',
    { class: 'conn-overlay', 'data-screen': 'connection' },
    h(
      'div',
      { class: 'panel card overlay-card', role: 'alertdialog', 'aria-live': 'assertive' },
      h('h1', {}, o.title),
      h('p', {}, o.text),
      h(
        'div',
        { class: 'card-actions end' },
        ...o.actions.map((a) =>
          h('button', { type: 'button', class: `btn${a.primary ? ' btn-primary' : ''}`, onclick: () => a.onClick() }, a.label),
        ),
      ),
    ),
  );
  return { el, dispose: () => el.remove() };
}
