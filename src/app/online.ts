// Online lobby modes (#/host, #/join/CODE; PLAN §3.3, M9.3–M9.4).
//
// Host: registers a room (net/peer.ts) and runs a HostLink on it; shows the
// code, a copy-link button, the opponent and the connection pill with RTT.
// Guest: a code field (or the code from the link) → PeerJS → GuestLink.
// Disconnects show the connection overlay. The match itself is M10: the
// host's Start button stays disabled until then.
import { DEFAULT_SETTINGS } from '../game/settings';
import { defaultName, sanitizeName } from '../game/rules';
import { HostLink, GuestLink, type GuestLinkStatus } from '../net/link';
import { connectPeerGuest, createPeerHost, type PeerHost } from '../net/peer';
import { netErrorText, type NetError, type Transport } from '../net/transport';
import type { Stage } from '../render/scene';
import { derivePitch } from '../shared/pitch';
import {
  createConnectionOverlay,
  createHostLobby,
  createJoinLobby,
  rttText,
  type OverlayAction,
} from '../ui/lobby';
import { createInspectView, type InspectView } from './inspect';
import { normalizeRoomCode, routeToHash } from './router';

export interface OnlineOptions {
  role: 'host' | 'join';
  /** Room code from #/join/CODE. */
  code: string | null;
  debug: boolean;
  overlay: HTMLElement;
}

export interface OnlineMode {
  dispose(): void;
}

/** sessionStorage key for the resume token of a room (§8.5). */
export function resumeKey(code: string): string {
  return `footy-resume-${code}`;
}

function readResume(code: string): string | undefined {
  try {
    return sessionStorage.getItem(resumeKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeResume(code: string, token: string): void {
  try {
    sessionStorage.setItem(resumeKey(code), token);
  } catch {
    /* private mode: no resume */
  }
}

/** The share link for a room: this page with #/join/CODE (keeps the base path, drops query flags). */
export function joinLink(code: string, loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}${routeToHash({ name: 'join', code })}`;
}

export function createOnlineMode(stage: Stage | null, opts: OnlineOptions): OnlineMode {
  let backdrop: InspectView | null = null;
  if (stage) {
    backdrop = createInspectView(stage, derivePitch(DEFAULT_SETTINGS), { debug: false, overlay: opts.overlay });
    backdrop.controls.autoRotate = true;
    backdrop.controls.autoRotateSpeed = 0.35;
  }
  const mode = opts.role === 'host' ? hostMode(opts) : joinMode(opts);
  const onHide = (): void => mode.dispose();
  window.addEventListener('pagehide', onHide);
  return {
    dispose() {
      window.removeEventListener('pagehide', onHide);
      mode.dispose();
      backdrop?.dispose();
    },
  };
}

function overlayHelper(parent: HTMLElement): {
  show(title: string, text: string, actions: OverlayAction[]): void;
  hide(): void;
} {
  let current: { dispose(): void } | null = null;
  return {
    show(title, text, actions) {
      current?.dispose();
      const o = createConnectionOverlay({ title, text, actions });
      parent.append(o.el);
      current = o;
    },
    hide() {
      current?.dispose();
      current = null;
    },
  };
}

const toMenu = (): void => {
  window.location.hash = '#/';
};

// ---------------------------------------------------------------- host

function hostMode(opts: OnlineOptions): OnlineMode {
  let disposed = false;
  let room: PeerHost | null = null;
  let link: HostLink | null = null;
  const overlay = overlayHelper(opts.overlay);
  const lobby = createHostLobby({
    name: '',
    onRetry: () => open(),
    onStart: () => {
      /* M10: start the online match. */
    },
  });
  opts.overlay.append(lobby.el);

  const myName = (): string => sanitizeName(lobby.name(), defaultName(0));

  function waiting(): void {
    lobby.pill.set('wait', 'Waiting for an opponent…');
    lobby.setOpponent(null);
    lobby.setStartEnabled(false);
    lobby.setNameLocked(false);
  }

  async function open(): Promise<void> {
    lobby.setError(null);
    lobby.setRoom(null, null);
    lobby.pill.set('wait', 'Creating a room…');
    let r: PeerHost;
    try {
      r = await createPeerHost();
    } catch (e) {
      if (disposed) return;
      const err = e as NetError;
      lobby.pill.set('bad', 'Could not create a room');
      lobby.setError(err.message ?? netErrorText('unknown'));
      return;
    }
    if (disposed) {
      r.close();
      return;
    }
    room = r;
    lobby.setRoom(r.code, joinLink(r.code));
    r.onStatus((s) => {
      if (s.kind === 'reconnecting') lobby.pill.set('wait', 'Reconnecting to the server…');
      else if (s.kind === 'ready') (link?.connected ? showRtt() : waiting());
      else if (s.kind === 'error') {
        lobby.pill.set('bad', 'Room closed');
        lobby.setError(s.error.message);
      }
    });
    link = new HostLink(r, { name: myName(), reserveMs: 0 });
    link.on((e) => {
      if (e.kind === 'join') {
        overlay.hide();
        lobby.setOpponent(e.name);
        lobby.setNameLocked(true);
        lobby.setStartEnabled(false); // M10 enables this.
        showRtt();
      } else if (e.kind === 'rtt') showRtt();
      else if (e.kind === 'left') {
        waiting();
        lobby.pill.set('bad', 'Opponent disconnected');
        overlay.show('Opponent disconnected', 'They can rejoin with the same code or link while this page stays open.', [
          { label: 'Menu', onClick: toMenu },
          { label: 'Keep waiting', primary: true, onClick: () => (overlay.hide(), waiting()) },
        ]);
      }
    });
    if (opts.debug || import.meta.env.DEV) Object.assign(window, { __online: { role: 'host', room: r, link } });
    waiting();
  }

  function showRtt(): void {
    lobby.pill.set('ok', rttText(link?.guest?.rtt ?? null));
  }

  // Name edits before a guest joins go out with the welcome.
  lobby.el.addEventListener('input', () => {
    if (link) link.name = myName();
  });

  void open();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      overlay.hide();
      link?.close('host left');
      if (!link) room?.close();
      lobby.el.remove();
      delete (window as { __online?: unknown }).__online;
    },
  };
}

// ---------------------------------------------------------------- guest

function joinMode(opts: OnlineOptions): OnlineMode {
  let disposed = false;
  let link: GuestLink | null = null;
  let transport: Transport | null = null;
  let code = opts.code ?? '';
  let name = '';
  const overlay = overlayHelper(opts.overlay);
  const lobby = createJoinLobby({
    code,
    name: '',
    onJoin: (c, n) => join(c, n),
    onLeave: () => leave(),
  });
  opts.overlay.append(lobby.el);

  function leave(): void {
    overlay.hide();
    link?.close();
    link = null;
    transport = null;
    lobby.setBusy(false);
    lobby.setHost(null);
  }

  function join(rawCode: string, rawName: string): void {
    const c = normalizeRoomCode(rawCode);
    lobby.setError(null);
    if (!c) {
      lobby.setError('Room codes are 5 letters or digits, like K7QXM.');
      return;
    }
    code = c;
    name = sanitizeName(rawName, defaultName(1));
    lobby.setCode(c);
    // Keep the address bar shareable / refreshable.
    if (window.location.hash !== routeToHash({ name: 'join', code: c })) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${routeToHash({ name: 'join', code: c })}`);
    }
    connect();
  }

  function connect(): void {
    link?.close();
    overlay.hide();
    lobby.setBusy(true);
    lobby.setHost(null);
    lobby.pill.set('wait', `Connecting to ${code}…`);
    transport = connectPeerGuest(code);
    const resume = readResume(code);
    const l = new GuestLink(transport, { name, ...(resume ? { resume } : {}) });
    link = l;
    l.onStatus((s) => {
      if (link !== l || disposed) return;
      status(s);
    });
    if (opts.debug || import.meta.env.DEV) Object.assign(window, { __online: { role: 'join', link: l, transport } });
  }

  function status(s: GuestLinkStatus): void {
    switch (s.kind) {
      case 'connecting':
        return;
      case 'connected':
        if (link?.token) writeResume(code, link.token);
        overlay.hide();
        lobby.pill.set('ok', rttText(s.rtt));
        lobby.setHost(s.hostName || defaultName(0));
        return;
      case 'rejected':
        fail(
          s.reason === 'full' ? 'Room full' : s.reason === 'version' ? 'Version mismatch' : 'Match over',
          s.reason === 'full'
            ? 'Room full: two players are already in this room.'
            : s.reason === 'version'
              ? 'Both players need to refresh the page (different game versions).'
              : 'That match has ended. Ask the host for a new room.',
        );
        return;
      case 'error':
        fail(s.error.code === 'room-not-found' ? 'Room not found' : 'Could not connect', s.error.message);
        return;
      case 'lost':
        lobby.pill.set('bad', 'Connection lost');
        lobby.setHost(null);
        overlay.show('Connection lost', 'The connection to the host dropped.', [
          { label: 'Menu', onClick: toMenu },
          { label: 'Reconnect', primary: true, onClick: () => connect() },
        ]);
        return;
      case 'ended':
        fail('Host left', 'The host closed the room.');
        return;
      case 'closed':
        return;
    }
  }

  function fail(pill: string, text: string): void {
    link = null;
    transport = null;
    lobby.setBusy(false);
    lobby.setHost(null);
    lobby.pill.el.hidden = false;
    lobby.pill.set('bad', pill);
    lobby.setError(text);
  }

  if (opts.code) join(opts.code, '');

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      overlay.hide();
      link?.close();
      lobby.el.remove();
      delete (window as { __online?: unknown }).__online;
    },
  };
}
