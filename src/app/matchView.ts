// Match view (PLAN §3.2, M7–M8): maps the session's phase to what is on
// screen. One backdrop (pitch, goals, ball, orbit camera; from the match's
// own settings) is shared by the phase views.
//   toss       → coin toss + role choice (M7.2)
//   placement  → draft (M7.3–M7.4)
//   play       → turn loop: aim, kick, playback, HUD, half-time (M8)
//   fulltime   → result, Rematch, Menu (M8.4)
//
// The view keeps its own "shown" state: after a kick the session already
// holds `next`, but the screen moves on only when the playback has ended
// (§8.4), so full-time appears after the last kick has been watched.
import { PerspectiveCamera } from 'three';
import { derivePitch } from '../shared/pitch';
import { placementPose } from '../render/cameras';
import type { Stage } from '../render/scene';
import { activeSeat, teamOfSeat } from '../game/rules';
import type { GameState, Phase, Seat } from '../game/types';
import { h } from '../ui/dom';
import { createFullTimeScreen } from '../ui/screens';
import { createTossScreen } from '../ui/toss';
import { createPlayersView, type PlayersView } from '../render/players';
import { createInspectView, type InspectView } from './inspect';
import { resultText, seatNameOf, TEAM_KIT } from './matchText';
import { createPlacementView } from './placementView';
import { createPlayView } from './playView';
import type { Denial, Session, SessionKick } from './session';

export interface MatchViewOptions {
  stage: Stage | null;
  session: Session;
  /** Parent for DOM overlays. */
  overlay: HTMLElement;
  debug: boolean;
  /** ?autoplace: the toss winner takes Team A and every pick is a random legal one (M8.5). */
  autoplace: boolean;
}

export interface MatchView {
  readonly phase: Phase;
  /** The state on screen (lags session.state during a kick's playback). */
  readonly shown: GameState;
  dispose(): void;
}

interface PhaseView {
  /** Called with every new state while this phase lasts. */
  sync?(s: GameState): void;
  /** A kick result (play phase). */
  kick?(k: SessionKick): void;
  denied?(d: Denial): void;
  /** True while a kick is being played back (states wait). */
  readonly busy?: boolean;
  dispose(): void;
}

/** Delay between automatic picks under ?autoplace, ms (so the draft is visible). */
const AUTOPLACE_DELAY = 120;

export function createMatchView(opts: MatchViewOptions): MatchView {
  const { stage, session, overlay } = opts;
  const pitch = derivePitch(session.state.settings);
  const world: InspectView | null = stage ? createInspectView(stage, pitch, { debug: opts.debug, overlay }) : null;
  // Confirmed players, for every phase after the toss.
  const players: PlayersView | null = stage ? createPlayersView({ hitboxes: opts.debug, stage }) : null;
  if (stage && players) stage.scene.add(players.group);
  let shownRev = -1;
  let shownPlayers: GameState['players'] | null = null;
  function showPlayers(s: GameState): void {
    if (!players || s.rev === shownRev) return;
    shownRev = s.rev;
    if (s.players === shownPlayers) return;
    shownPlayers = s.players;
    players.setPlayers(s.players);
  }

  let shown: GameState = session.state;
  let phase: Phase | null = null;
  let view: PhaseView | null = null;
  /** States that arrived while a kick was playing. */
  let waiting: GameState | null = null;
  let disposed = false;

  function enter(s: GameState): void {
    view?.dispose();
    view = null;
    phase = s.phase;
    if (world) world.controls.autoRotate = s.phase === 'toss' || s.phase === 'fulltime';
    switch (s.phase) {
      case 'toss':
        view = tossView(s);
        break;
      case 'placement':
        view = stage && world ? createPlacementView({ stage, world, session, overlay, debug: opts.debug }) : needsWebGl();
        break;
      case 'play':
        view =
          stage && world && players
            ? createPlayView({
                stage,
                world,
                players,
                session,
                overlay,
                state: s,
                onApplied: (next) => applied(next),
                orientation: mapOrientation(s),
              })
            : needsWebGl();
        break;
      case 'fulltime':
        view = fullTimeView(s);
        break;
    }
  }

  /** Shows a new state: switches the phase view or syncs the current one. */
  function show(s: GameState): void {
    if (disposed) return;
    shown = s;
    showPlayers(s);
    if (s.phase !== phase) enter(s);
    else view?.sync?.(s);
    autoAct(s);
  }

  /** The play view applied a kick's `next` after its playback. */
  function applied(next: GameState): void {
    shown = next;
    showPlayers(next);
    // A phase change (full-time) swaps views: do it outside the play view's frame callback.
    if (next.phase !== phase) queueMicrotask(() => show(next));
    flushWaiting();
  }

  function flushWaiting(): void {
    const w = waiting;
    if (!w || view?.busy) return;
    waiting = null;
    if (w.rev > shown.rev) queueMicrotask(() => show(w));
  }

  /** §6.1: hot-seat, Team A attacks left → right; online, your own team does. */
  function mapOrientation(s: GameState): 1 | -1 {
    if (session.localSeats.length !== 1) return 1;
    return teamOfSeat(s, session.localSeats[0]!) === 1 ? -1 : 1;
  }

  function tossView(s: GameState): PhaseView {
    const winner = s.toss.winner;
    const toss = createTossScreen({
      names: s.seatNames,
      winner,
      canChoose: session.localSeats.includes(winner),
      onChoose: (role) => session.send(winner, { type: 'tossChoice', role }),
    });
    overlay.append(toss.el);
    return toss;
  }

  function needsWebGl(): PhaseView {
    const el = h(
      'div',
      { class: 'panel card', 'data-screen': 'no-webgl' },
      h('h1', {}, 'Match'),
      h('p', {}, 'The draft and the match need WebGL, which this browser has turned off.'),
      h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu')),
    );
    overlay.append(el);
    return { dispose: () => el.remove() };
  }

  function fullTimeView(s: GameState): PhaseView {
    const r = resultText(s);
    const local = session.localSeats;
    const voted = (st: GameState): boolean => local.every((seat) => st.rematchVotes[seat]);
    const waitingFor = (st: GameState): string | null => {
      const seat = ([0, 1] as Seat[]).find((q) => !st.rematchVotes[q] && !local.includes(q));
      return seat === undefined ? null : st.seatNames[seat];
    };
    const screen = createFullTimeScreen({
      names: [seatNameOf(s, 0), seatNameOf(s, 1)],
      kits: [TEAM_KIT[0], TEAM_KIT[1]],
      score: s.score,
      headline: r.headline,
      winner: r.team,
      voted: voted(s),
      waitingFor: waitingFor(s),
      onRematch: () => {
        // Hot-seat: both seats are here, so one click is both votes.
        for (const seat of local) if (!session.state.rematchVotes[seat]) session.send(seat, { type: 'rematch' });
      },
    });
    overlay.append(screen.el);
    if (stage && world) {
      const { width, height } = stage.size();
      world.moveTo(placementPose(pitch, width / Math.max(1, height), stage.camera instanceof PerspectiveCamera ? stage.camera.fov : 50), 1.2);
    }
    return {
      sync: (st) => screen.update({ voted: voted(st), waitingFor: waitingFor(st) }),
      dispose: () => screen.dispose(),
    };
  }

  // ---- ?autoplace (M8.5) -----------------------------------------------------
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  function autoAct(s: GameState): void {
    if (!opts.autoplace || autoTimer) return;
    const seat = activeSeat(s);
    if (seat === null || !session.localSeats.includes(seat)) return;
    if (s.phase === 'toss') {
      autoTimer = setTimeout(() => {
        autoTimer = null;
        if (session.state.rev === s.rev) session.send(seat, { type: 'tossChoice', role: 'A' });
      }, AUTOPLACE_DELAY);
    } else if (s.phase === 'placement') {
      autoTimer = setTimeout(() => {
        autoTimer = null;
        if (session.state.rev !== s.rev) return;
        const intent = session.randomPick(seat);
        if (intent) session.send(seat, intent);
      }, AUTOPLACE_DELAY);
    }
  }

  const offState = session.onState((s) => {
    if (view?.busy) {
      waiting = s;
      return;
    }
    show(s);
  });
  const offKick = session.onKick((k) => {
    if (view?.kick) view.kick(k);
    else show(k.next);
  });
  const offDenied = session.onDenied((d) => {
    console.warn(`Footy: ${d.intentType} refused: ${d.reason}`);
    view?.denied?.(d);
  });
  if (world) world.controls.autoRotateSpeed = 0.35;
  show(session.state);

  return {
    get phase() {
      return phase!;
    },
    get shown() {
      return shown;
    },
    dispose() {
      disposed = true;
      if (autoTimer) clearTimeout(autoTimer);
      offState();
      offKick();
      offDenied();
      view?.dispose();
      players?.dispose();
      world?.dispose();
    },
  };
}
