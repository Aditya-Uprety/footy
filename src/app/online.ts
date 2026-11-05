// Online lobby modes (#/host, #/join/CODE; PLAN §3.3, M9.3–M9.4).
//
// Host: registers a room (net/peer.ts) and runs a HostLink on it; shows the
// code, a copy-link button, the opponent and the connection pill with RTT.
// Guest: a code field (or the code from the link) → PeerJS → GuestLink.
// Disconnects show the connection overlay. Once both are in, the host's
// Start creates a HostSession (M10.1) and the guest's first snapshot creates
// a GuestSession view (M10.2); both then run the shared match view.
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../game/settings';
import { defaultName, sanitizeName } from '../game/rules';
import { GuestSession } from '../net/guestSession';
import { HostSession } from '../net/hostSession';
import { HostLink, GuestLink, RESERVE_MS, type GuestLinkStatus } from '../net/link';
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
import { createMatchView, type MatchView } from './matchView';
import { normalizeRoomCode, routeToHash } from './router';

export interface OnlineOptions {
  role: 'host' | 'join';
  /** Room code from #/join/CODE. */
  code: string | null;
  debug: boolean;
  /** ?seed=N: the host's match RNG. */
  seed?: number | null;
  /** ?autoplace: random picks for this device's seat (test route). */
  autoplace?: boolean;
  /** Setting overrides for the host's match (query flags until the M13 settings panel). */
  settings?: Partial<Settings>;
  overlay: HTMLElement;
}

/** What the lobby modes need to start the match view. */
interface MatchCtx {
  stage: Stage | null;
  opts: OnlineOptions;
  /** Removes the turning lobby backdrop (the match view brings its own pitch). */
  releaseBackdrop(): void;
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
  const ctx: MatchCtx = {
    stage,
    opts,
    releaseBackdrop() {
      backdrop?.dispose();
      backdrop = null;
    },
  };
  const mode = opts.role === 'host' ? hostMode(ctx) : joinMode(ctx);
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

function hostMode(ctx: MatchCtx): OnlineMode {
  const opts = ctx.opts;
  let disposed = false;
  let room: PeerHost | null = null;
  let link: HostLink | null = null;
  let session: HostSession | null = null;
  let match: MatchView | null = null;
  const overlay = overlayHelper(opts.overlay);
  const lobby = createHostLobby({
    name: '',
    onRetry: () => open(),
    onStart: () => startMatch(),
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
      if (session) {
        matchEvent(e.kind);
        return;
      }
      if (e.kind === 'join') {
        overlay.hide();
        lobby.setOpponent(e.name);
        lobby.setNameLocked(true);
        lobby.setStartEnabled(true);
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
    if (opts.debug || import.meta.env.DEV) {
      Object.assign(window, {
        __online: {
          role: 'host',
          room: r,
          link,
          get session() {
            return session;
          },
          get match() {
            return match;
          },
        },
      });
    }
    waiting();
  }

  function startMatch(): void {
    const guest = link?.guest;
    if (!link || !guest?.connected || session || disposed) return;
    // From now on a dropped guest keeps seat 1 for its resume token (§8.5).
    link.reserveMs = RESERVE_MS;
    link.name = myName();
    lobby.el.hidden = true;
    overlay.hide();
    ctx.releaseBackdrop();
    const seed = opts.seed ?? Math.floor(Math.random() * 0x7fffffff);
    session = new HostSession({ link, settings: sanitizeSettings(opts.settings ?? {}), names: [myName(), guest.name], seed });
    match = createMatchView({ stage: ctx.stage, session, overlay: opts.overlay, debug: opts.debug, autoplace: opts.autoplace ?? false });
  }

  /** Link events once the match is on. */
  function matchEvent(kind: 'join' | 'rtt' | 'left' | 'rejected'): void {
    if (kind === 'join') overlay.hide();
    else if (kind === 'left') {
      const name = link?.guest?.name || defaultName(1);
      overlay.show(
        'Opponent disconnected',
        `Waiting for ${name} to rejoin… Their seat is kept for ${Math.round(RESERVE_MS / 60000)} minutes; they can use the same link.`,
        [{ label: 'Menu', onClick: toMenu }],
      );
    }
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
      match?.dispose();
      session?.dispose();
      link?.close('host left');
      if (!link) room?.close();
      lobby.el.remove();
      delete (window as { __online?: unknown }).__online;
    },
  };
}

// ---------------------------------------------------------------- guest

function joinMode(ctx: MatchCtx): OnlineMode {
  const opts = ctx.opts;
  let disposed = false;
  let link: GuestLink | null = null;
  let session: GuestSession | null = null;
  let match: MatchView | null = null;
  let offFirst: (() => void) | null = null;
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
    if (opts.debug || import.meta.env.DEV) {
      Object.assign(window, {
        __online: {
          role: 'join',
          link: l,
          transport,
          get session() {
            return session;
          },
          get match() {
            return match;
          },
        },
      });
    }
  }

  /** Connected: the first snapshot starts the match view; after a reconnect the session moves to the new link. */
  function bindSession(l: GuestLink): void {
    if (session) {
      session.attach(l);
      return;
    }
    const s = new GuestSession(l, opts.seed != null ? { seed: opts.seed + 1 } : {});
    session = s;
    offFirst = s.onState(() => {
      offFirst?.();
      offFirst = null;
      startMatch(s);
    });
  }

  function startMatch(s: GuestSession): void {
    if (match || disposed) return;
    lobby.el.hidden = true;
    overlay.hide();
    ctx.releaseBackdrop();
    match = createMatchView({ stage: ctx.stage, session: s, overlay: opts.overlay, debug: opts.debug, autoplace: opts.autoplace ?? false });
  }

  function status(s: GuestLinkStatus): void {
    switch (s.kind) {
      case 'connecting':
        return;
      case 'connected':
        if (link?.token) writeResume(code, link.token);
        if (link) bindSession(link);
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
        overlay.show('Connection lost', match ? 'The connection to the host dropped. Reconnect to carry on with the match.' : 'The connection to the host dropped.', [
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
    if (match) {
      // Mid-match: the lobby is gone, so say it on the overlay.
      link = null;
      transport = null;
      overlay.show(pill, text, [{ label: 'Menu', primary: true, onClick: toMenu }]);
      return;
    }
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
      offFirst?.();
      match?.dispose();
      session?.dispose();
      link?.close();
      lobby.el.remove();
      delete (window as { __online?: unknown }).__online;
    },
  };
}
