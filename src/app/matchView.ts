// Match view (PLAN §3.2, M7–M8): maps the session's phase to what is on
// screen. One backdrop (pitch, goals, ball, orbit camera; from the match's
// own settings) is shared by the phase views.
//   toss       → coin toss + role choice (M7.2)
//   placement  → draft (M7.3–M7.4)
//   play, fulltime → stub until M8
import { derivePitch } from '../shared/pitch';
import type { Stage } from '../render/scene';
import type { GameState, Phase } from '../game/types';
import { h } from '../ui/dom';
import { createTossScreen } from '../ui/toss';
import { createInspectView, type InspectView } from './inspect';
import type { Session } from './session';

export interface MatchViewOptions {
  stage: Stage | null;
  session: Session;
  /** Parent for DOM overlays. */
  overlay: HTMLElement;
  debug: boolean;
  autoplace: boolean;
}

export interface MatchView {
  readonly phase: Phase;
  dispose(): void;
}

interface PhaseView {
  dispose(): void;
}

export function createMatchView(opts: MatchViewOptions): MatchView {
  const { stage, session, overlay } = opts;
  const pitch = derivePitch(session.state.settings);
  const world: InspectView | null = stage ? createInspectView(stage, pitch, { debug: opts.debug, overlay }) : null;

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
      default:
        view = stubView(s);
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

  function stubView(s: GameState): PhaseView {
    const el = h(
      'div',
      { class: 'panel card', 'data-screen': `stub-${s.phase}` },
      h('h1', {}, s.phase === 'placement' ? 'Draft' : 'Draft complete'),
      h('p', {}, 'Coming next.'),
      h('div', { class: 'card-actions' }, h('a', { class: 'btn', href: '#/' }, '← Menu')),
    );
    overlay.append(el);
    return { dispose: () => el.remove() };
  }

  const offState = session.onState((s) => {
    if (s.phase !== phase) enter(s);
  });
  const offDenied = session.onDenied((d) => console.warn(`Footy: ${d.intentType} refused: ${d.reason}`));
  if (world) world.controls.autoRotateSpeed = 0.35;
  enter(session.state);

  return {
    get phase() {
      return phase!;
    },
    dispose() {
      offState();
      offDenied();
      view?.dispose();
      world?.dispose();
    },
  };
}
