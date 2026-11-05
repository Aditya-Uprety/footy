// Match view (PLAN §3.2, M7–M8): maps the session's phase to what is on
// screen. One backdrop (pitch, goals, ball, orbit camera; from the match's
// own settings) is shared by the phase views.
//   toss       → coin toss + role choice (M7.2)
//   placement  → draft (M7.3–M7.4)
//   play, fulltime → hand-off stub until M8 (the drafted lineup stays visible)
import { PerspectiveCamera } from 'three';
import { derivePitch } from '../shared/pitch';
import { placementPose } from '../render/cameras';
import type { Stage } from '../render/scene';
import { seatOfTeam } from '../game/rules';
import type { GameState, Phase, Team } from '../game/types';
import { KIT_NAME } from '../ui/placementPanel';
import { h } from '../ui/dom';
import { createTossScreen } from '../ui/toss';
import { createPlayersView, type PlayersView } from '../render/players';
import { createInspectView, type InspectView } from './inspect';
import { createPlacementView } from './placementView';
import type { Session } from './session';

export interface MatchViewOptions {
  stage: Stage | null;
  session: Session;
  /** Parent for DOM overlays. */
  overlay: HTMLElement;
  debug: boolean;
  autoplace: boolean;
  /** Starts a fresh match with the same names (hand-off stub's "New draft"). */
  onRestart?: () => void;
}

export interface MatchView {
  readonly phase: Phase;
  dispose(): void;
}

interface PhaseView {
  /** Called with every new state while this phase lasts. */
  sync?(s: GameState): void;
  dispose(): void;
}

export function createMatchView(opts: MatchViewOptions): MatchView {
  const { stage, session, overlay } = opts;
  const pitch = derivePitch(session.state.settings);
  const world: InspectView | null = stage ? createInspectView(stage, pitch, { debug: opts.debug, overlay }) : null;
  // Confirmed players, for every phase after the toss.
  const players: PlayersView | null = stage ? createPlayersView({ hitboxes: opts.debug }) : null;
  if (stage && players) stage.scene.add(players.group);
  let shownRev = -1;
  function showPlayers(s: GameState): void {
    if (!players || s.rev === shownRev) return;
    shownRev = s.rev;
    players.setPlayers(s.players);
  }

  let phase: Phase | null = null;
  let view: PhaseView | null = null;

  function enter(s: GameState): void {
    view?.dispose();
    view = null;
    phase = s.phase;
    if (world) world.controls.autoRotate = s.phase === 'toss';
    switch (s.phase) {
      case 'toss':
        view = tossView(s);
        break;
      case 'placement':
        view = stage && world ? createPlacementView({ stage, world, session, overlay, debug: opts.debug }) : needsWebGl();
        break;
      default:
        view = handoffView(s);
    }
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
      h('h1', {}, 'Draft'),
      h('p', {}, 'Placing players needs WebGL, which this browser has turned off.'),
      h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu')),
    );
    overlay.append(el);
    return { dispose: () => el.remove() };
  }

  /** After pick 12: the lineup on the pitch and a small card (the match itself arrives in M8). */
  function handoffView(s: GameState): PhaseView {
    const side = (t: Team) => {
      const seat = seatOfTeam(s, t);
      return h('div', { class: `ho-team team-${t}` }, h('strong', {}, KIT_NAME[t]), ` ${seat === null ? '' : s.seatNames[seat]}`);
    };
    const restart = h('button', { type: 'button', class: 'btn' }, 'New draft');
    restart.addEventListener('click', () => opts.onRestart?.());
    const el = h(
      'div',
      { class: 'panel card handoff', 'data-screen': 'handoff' },
      h('h1', {}, 'Draft complete'),
      h('div', { class: 'ho-teams' }, side(0), h('span', {}, 'vs'), side(1)),
      h('p', {}, `${KIT_NAME[0]} kicks off. The match itself arrives in the next build step (M8).`),
      h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu'), opts.onRestart ? restart : null),
    );
    overlay.append(el);
    if (stage && world) {
      const { width, height } = stage.size();
      world.moveTo(placementPose(pitch, width / Math.max(1, height), stage.camera instanceof PerspectiveCamera ? stage.camera.fov : 50), 1.0);
    }
    return { dispose: () => el.remove() };
  }

  const offState = session.onState((s) => {
    showPlayers(s);
    if (s.phase !== phase) enter(s);
    else view?.sync?.(s);
  });
  const offDenied = session.onDenied((d) => console.warn(`Footy: ${d.intentType} refused: ${d.reason}`));
  if (world) world.controls.autoRotateSpeed = 0.35;
  showPlayers(session.state);
  enter(session.state);

  return {
    get phase() {
      return phase!;
    },
    dispose() {
      offState();
      offDenied();
      view?.dispose();
      players?.dispose();
      world?.dispose();
    },
  };
}
