// Camera rigs. M1.5: inspect presets (TV side, behind each goal, top-down) and
// an eased move between poses. The aim, placement, spectator, chase, broadcast
// and overhead rigs (PLAN §6.1) arrive in M4, M5 and M7.
import * as THREE from 'three';
import { easeInOutCubic } from '../shared/math';
import type { Pitch } from '../shared/pitch';
import { APRON } from './pitch';

export type InspectPreset = 'tv' | 'behindA' | 'behindB' | 'top';

/** Keys 1–4 → presets (PLAN M1.5). */
export const INSPECT_KEYS: Readonly<Record<string, InspectPreset>> = {
  '1': 'tv',
  '2': 'behindA',
  '3': 'behindB',
  '4': 'top',
};

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Pose for an inspect preset. `aspect` and `fovDeg` (vertical) are used to fit
 * the whole pitch plus apron in the top-down view.
 */
export function inspectPose(preset: InspectPreset, pitch: Pitch, aspect: number, fovDeg: number): CameraPose {
  const { halfLength: hl, halfWidth: hw } = pitch;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  switch (preset) {
    case 'tv':
      // Elevated on the near touchline (+z side), looking across at the center.
      return { position: v(0, 0.3 * pitch.length, hw + 0.42 * pitch.length), target: v(0, 0, -0.08 * hw) };
    case 'behindA':
      // Behind Team A's goal (x = -L/2), looking along +x.
      return { position: v(-hl - 20, 10, 0), target: v(-hl + 30, 0, 0) };
    case 'behindB':
      return { position: v(hl + 20, 10, 0), target: v(hl - 30, 0, 0) };
    case 'top': {
      const t = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
      const margin = APRON + 3;
      const h = Math.max((hw + margin) / t, (hl + margin) / (t * Math.max(aspect, 1e-3)));
      // A tiny +z offset fixes the orientation: +x to the right, +z down the screen.
      return { position: v(0, h, 1e-3), target: v(0, 0, 0) };
    }
  }
}

/** Something with a movable target, e.g. OrbitControls. */
export interface Targetable {
  target: THREE.Vector3;
  update(): unknown;
}

export interface CameraTween {
  /** Starts an eased move from the current pose to `to`. */
  go(to: CameraPose, seconds?: number): void;
  /** Advances the move; call every frame. Returns true while moving. */
  update(dt: number): boolean;
  readonly active: boolean;
  cancel(): void;
}

/** Eases a camera (and its controls target) between poses. */
export function createCameraTween(camera: THREE.Camera, controls: Targetable): CameraTween {
  const fromPos = new THREE.Vector3();
  const fromTarget = new THREE.Vector3();
  const toPos = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  let t = 1;
  let duration = 0.8;

  return {
    go(to, seconds = 0.8) {
      fromPos.copy(camera.position);
      fromTarget.copy(controls.target);
      toPos.copy(to.position);
      toTarget.copy(to.target);
      duration = Math.max(1e-3, seconds);
      t = 0;
    },
    update(dt) {
      if (t >= 1) return false;
      t = Math.min(1, t + dt / duration);
      const k = easeInOutCubic(t);
      camera.position.lerpVectors(fromPos, toPos, k);
      controls.target.lerpVectors(fromTarget, toTarget, k);
      controls.update();
      return t < 1;
    },
    get active() {
      return t < 1;
    },
    cancel() {
      t = 1;
    },
  };
}
