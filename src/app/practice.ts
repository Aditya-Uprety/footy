// Practice mode (#/practice, PLAN M5.5): solo kicking sandbox.
// M5.1: the aim rig on the center spot.
import type { Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { createAimController } from './aimController';
import { createInspectView } from './inspect';

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

  const aim = createAimController(stage, { ball: world.ball });
  aim.setOrigin({ kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 }, 0);
  aim.active = true;
  aim.inputEnabled = true;

  Object.assign(window, { __practice: { aim } });

  return {
    dispose() {
      aim.dispose();
      world.dispose();
      delete (window as { __practice?: unknown }).__practice;
    },
  };
}
