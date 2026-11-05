// Practice mode (#/practice, PLAN M5.5): solo kicking sandbox.
// M5.3: aim rig + kick panel + kick flow; every kick restarts from the center.
import { createPlayersView } from '../render/players';
import type { Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { simulateKick } from '../sim/simulate';
import type { KickOrigin } from '../sim/types';
import { buildWorld } from '../sim/world';
import { createKickPanel } from '../ui/kickPanel';
import { createAimController } from './aimController';
import { createInspectView } from './inspect';
import { createKickFlow, type Turn } from './kickFlow';

export interface PracticeOptions {
  debug: boolean;
  seed: number | null;
  /** Parent for the mode's DOM overlays. */
  overlay: HTMLElement;
}

export interface PracticeView {
  dispose(): void;
}

export function createPracticeView(stage: Stage, pitch: Pitch, opts: PracticeOptions): PracticeView {
  // The inspect view supplies the pitch, goals, ball and ?debug aids; its orbit camera stays off.
  const world = createInspectView(stage, pitch, { debug: opts.debug, overlay: opts.overlay });
  world.suspend();

  const playersView = createPlayersView({ hitboxes: opts.debug });
  stage.scene.add(playersView.group);

  const aim = createAimController(stage, { ball: world.ball });
  const panel = createKickPanel();
  opts.overlay.append(panel.el);
  panel.setHeight(aim.state.height);
  panel.onHeight((hgt) => aim.setHeight(hgt));
  aim.onChange((s) => panel.setHeight(s.height));

  const kickoff: KickOrigin = { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 };
  let turnId = 0;
  const flow = createKickFlow({
    stage,
    pitch,
    ball: world.ball,
    players: playersView,
    aim,
    panel,
    requestKick(input, turn) {
      const res = simulateKick({
        input,
        origin: turn.origin,
        team: 0,
        world: buildWorld(pitch, [], null),
        caps: turn.caps,
        turnId: ++turnId,
      });
      flow.play(res);
    },
    onPlaybackEnd() {
      flow.startTurn(firstTurn());
    },
  });
  const firstTurn = (): Turn => ({ origin: kickoff, yaw: 0 });
  flow.startTurn(firstTurn(), { instant: true });

  Object.assign(window, { __practice: { aim, panel, flow } });

  return {
    dispose() {
      flow.dispose();
      panel.dispose();
      aim.dispose();
      playersView.dispose();
      world.dispose();
      delete (window as { __practice?: unknown }).__practice;
    },
  };
}
