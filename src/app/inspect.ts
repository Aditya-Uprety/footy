// Inspect view (M0.3, M1): the pitch and goals under an orbit camera with
// presets on keys 1–4, plus ?debug axes and ruler. Shared by every route
// until each mode brings its own view (M4 lab, M5 practice, M7 placement).
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as THREE from 'three';
import { createBallView, type BallView } from '../render/ball';
import { PHYS } from '../sim/constants';
import { createCameraTween, INSPECT_KEYS, inspectPose, type CameraPose, type InspectPreset } from '../render/cameras';
import { createAxes, createRuler } from '../render/debug';
import { createGoalsView } from '../render/goals';
import { createPitchView } from '../render/pitch';
import { createStadiumView } from '../render/stadium';
import { createEnvironment, type Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';

export interface InspectView {
  readonly pitch: Pitch;
  readonly controls: OrbitControls;
  /** The ball (on the center spot until a mode moves it). */
  readonly ball: BallView;
  /** Pitch and goals, for raycasting. */
  readonly pickRoots: THREE.Object3D[];
  /** Moves the camera to a preset (eased unless `instant`). */
  goTo(preset: InspectPreset, instant?: boolean): void;
  /** Moves the camera to any pose (eased over `seconds`, or at once when 0). */
  moveTo(pose: CameraPose, seconds?: number): void;
  /**
   * Hands the camera to someone else (e.g. a playback camera): orbit controls,
   * the preset tween and keys 1–4 pause while suspended.
   */
  suspend(): void;
  /** Takes the camera back where it is now, orbiting around `target`, at FOV `fov`. */
  resume(target: THREE.Vector3, fov?: number): void;
  readonly suspended: boolean;
  dispose(): void;
}

export interface InspectOptions {
  debug: boolean;
  /** Where debug overlays (ruler label/readout) are attached. */
  overlay: HTMLElement;
}

/** True when a key event is aimed at a text field rather than the game. */
export function typingInField(ev: KeyboardEvent): boolean {
  const t = ev.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Inspect FOV (vertical, degrees). */
export const INSPECT_FOV = 50;

export function createInspectView(stage: Stage, pitch: Pitch, opts: InspectOptions): InspectView {
  const env = createEnvironment(stage.scene, pitch);
  const pitchView = createPitchView(pitch, stage.renderer.capabilities.getMaxAnisotropy());
  const goals = createGoalsView(pitch);
  const stadium = createStadiumView(pitch, { maxAnisotropy: stage.renderer.capabilities.getMaxAnisotropy() });
  const ball = createBallView();
  ball.setPosition(0, PHYS.BALL_R, 0);
  stage.scene.add(pitchView.group, goals.group, stadium.group, ball.group);

  const camera = stage.camera;
  const controls = new OrbitControls(camera, stage.canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1;
  controls.maxDistance = pitch.length * 2.5;

  const tween = createCameraTween(camera, controls);
  controls.addEventListener('start', () => tween.cancel());

  const fov = (): number => ('fov' in camera ? camera.fov : 50);
  const aspect = (): number => {
    const { width, height } = stage.size();
    return width / height;
  };

  function moveTo(pose: CameraPose, seconds = 0.8): void {
    if (seconds <= 0) {
      tween.cancel();
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      controls.update();
    } else {
      tween.go(pose, seconds);
    }
  }

  function goTo(preset: InspectPreset, instant = false): void {
    moveTo(inspectPose(preset, pitch, aspect(), fov()), instant ? 0 : 0.8);
  }
  goTo('tv', true);

  let suspended = false;
  const onKey = (ev: KeyboardEvent): void => {
    if (suspended || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    const preset = INSPECT_KEYS[ev.key];
    if (preset) goTo(preset);
  };
  window.addEventListener('keydown', onKey);

  const offFrame = stage.onFrame((dt) => {
    if (suspended) return;
    if (!tween.update(dt)) controls.update();
  });

  const debugAids = opts.debug
    ? [createAxes(stage.scene), createRuler(stage, opts.overlay, [pitchView.group, goals.group])]
    : [];
  if (opts.debug) {
    Object.assign(window, { __footy: { stage, controls, pitch, goTo, ruler: debugAids[1], ball } });
  }

  return {
    pitch,
    controls,
    ball,
    pickRoots: [pitchView.group, goals.group],
    goTo,
    moveTo,
    suspend() {
      suspended = true;
      tween.cancel();
      controls.enabled = false;
    },
    resume(target, fovDeg = INSPECT_FOV) {
      suspended = false;
      controls.enabled = true;
      if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fovDeg) {
        camera.fov = fovDeg;
        camera.updateProjectionMatrix();
      }
      controls.target.copy(target);
      controls.update();
    },
    get suspended() {
      return suspended;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      offFrame();
      controls.dispose();
      for (const d of debugAids) d.dispose();
      ball.dispose();
      goals.dispose();
      stadium.dispose();
      pitchView.dispose();
      env.dispose();
    },
  };
}
