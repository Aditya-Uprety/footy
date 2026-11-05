// Inspect view (M0.3, M1): the pitch and goals under an orbit camera with
// presets on keys 1–4, plus ?debug axes and ruler. Shared by every route
// until each mode brings its own view (M4 lab, M5 practice, M7 placement).
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createCameraTween, INSPECT_KEYS, inspectPose, type InspectPreset } from '../render/cameras';
import { createAxes, createRuler } from '../render/debug';
import { createGoalsView } from '../render/goals';
import { createPitchView } from '../render/pitch';
import { createEnvironment, type Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';

export interface InspectView {
  /** Moves the camera to a preset (eased unless `instant`). */
  goTo(preset: InspectPreset, instant?: boolean): void;
  dispose(): void;
}

export interface InspectOptions {
  debug: boolean;
  /** Where debug overlays (ruler label/readout) are attached. */
  overlay: HTMLElement;
}

/** True when a key event is aimed at a text field rather than the game. */
function typingInField(ev: KeyboardEvent): boolean {
  const t = ev.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function createInspectView(stage: Stage, pitch: Pitch, opts: InspectOptions): InspectView {
  const env = createEnvironment(stage.scene, pitch);
  const pitchView = createPitchView(pitch, stage.renderer.capabilities.getMaxAnisotropy());
  const goals = createGoalsView(pitch);
  stage.scene.add(pitchView.group, goals.group);

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

  function goTo(preset: InspectPreset, instant = false): void {
    const pose = inspectPose(preset, pitch, aspect(), fov());
    if (instant) {
      tween.cancel();
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      controls.update();
    } else {
      tween.go(pose, 0.8);
    }
  }
  goTo('tv', true);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    const preset = INSPECT_KEYS[ev.key];
    if (preset) goTo(preset);
  };
  window.addEventListener('keydown', onKey);

  const offFrame = stage.onFrame((dt) => {
    if (!tween.update(dt)) controls.update();
  });

  const debugAids = opts.debug
    ? [createAxes(stage.scene), createRuler(stage, opts.overlay, [pitchView.group, goals.group])]
    : [];
  if (opts.debug) {
    Object.assign(window, { __footy: { stage, controls, pitch, goTo, ruler: debugAids[1] } });
  }

  return {
    goTo,
    dispose() {
      window.removeEventListener('keydown', onKey);
      offFrame();
      controls.dispose();
      for (const d of debugAids) d.dispose();
      goals.dispose();
      pitchView.dispose();
      env.dispose();
    },
  };
}
