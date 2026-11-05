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

/** Placement overview tilt: angle between the view direction and straight down, degrees. */
export const PLACEMENT_POLAR_DEG = 36;

/**
 * Placement camera (§6.1): the whole pitch from above the near (+z)
 * touchline, tilted by `polarDeg` (0 = straight down), +x to the right (Team A
 * attacks left → right). `inset` is the fraction of the screen width covered
 * on the right (the side panel): the pitch is fitted into the rest.
 */
export function placementPose(pitch: Pitch, aspect: number, fovDeg: number, opts: { polarDeg?: number; inset?: number } = {}): CameraPose {
  const inset = THREE.MathUtils.clamp(opts.inset ?? 0, 0, 0.6);
  const free = Math.max(0.2, aspect * (1 - inset));
  const top = inspectPose('top', pitch, free, fovDeg);
  const p = THREE.MathUtils.degToRad(opts.polarDeg ?? PLACEMENT_POLAR_DEG);
  // A tilted view widens the near touchline on screen: back off a little more.
  const dist = top.position.y * (1 + 0.45 * Math.sin(p));
  // Move the target right by half the covered width (measured at the target), so the pitch sits left of the panel.
  const halfW = dist * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * aspect;
  const tx = inset * halfW;
  const target = new THREE.Vector3(tx, 0, p > 0 ? 2 : 0);
  return { position: new THREE.Vector3(tx, dist * Math.cos(p), dist * Math.sin(p) + (p > 0 ? 0 : 1e-3) + target.z), target };
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

// ---------------------------------------------------------------------------
// Aim pose (§6.1) and playback cameras: chase + broadcast (M4.4).
// ---------------------------------------------------------------------------

/** Aim-camera height range and default, m (§6.1). */
export const AIM_HEIGHT_MIN = 1.7;
export const AIM_HEIGHT_MAX = 8;
/** Default angle of the ball below the view center, rad (§6.1: about 22°). */
export const AIM_BALL_BELOW = (22 * Math.PI) / 180;

/** Horizontal distance from the ball back to the aim camera for height h, m. */
export function aimBackDistance(h: number): number {
  return 2.2 + 0.4 * (h - AIM_HEIGHT_MIN);
}

/**
 * Default view pitch for the aim camera (negative = looking down), chosen so
 * the ball sits AIM_BALL_BELOW below the view center.
 */
export function aimDefaultPitch(h: number, ballY: number): number {
  const below = Math.atan2(h - ballY, aimBackDistance(h));
  return -(below - AIM_BALL_BELOW);
}

/**
 * Aim pose (§6.1): on the kick line behind the ball,
 * position = ball − d̂·(2.2 + 0.4·(h − 1.7)) + ŷ·h, looking along d̂ tilted by `pitch`.
 */
export function aimPose(ball: { x: number; y: number; z: number }, yaw: number, h = AIM_HEIGHT_MIN, pitch?: number): CameraPose {
  const dx = Math.cos(yaw);
  const dz = Math.sin(yaw);
  const back = aimBackDistance(h);
  const position = new THREE.Vector3(ball.x - dx * back, h, ball.z - dz * back);
  const p = pitch ?? aimDefaultPitch(h, ball.y);
  const look = 10;
  const target = new THREE.Vector3(
    position.x + Math.cos(p) * dx * look,
    position.y + Math.sin(p) * look,
    position.z + Math.cos(p) * dz * look,
  );
  return { position, target };
}

export type PlaybackCamMode = 'chase' | 'broadcast' | 'goal';

/** Chase: never below this height, m (§6.1). */
export const CHASE_MIN_HEIGHT = 1.5;
/** FOVs (vertical, degrees) per playback camera. */
export const PLAYBACK_FOV: Readonly<Record<PlaybackCamMode, number>> = { chase: 60, broadcast: 34, goal: 40 };
/** Behind-goal camera (replays, M15.1): how far behind the goal line and how high, m. */
export const GOAL_CAM_BEHIND = 3.2;
export const GOAL_CAM_HEIGHT = 1.9;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PlaybackCamera {
  readonly mode: PlaybackCamMode;
  /** The smoothed point the camera looks at (hand it to OrbitControls afterwards). */
  readonly target: THREE.Vector3;
  /**
   * Starts following a kick. The chase cam begins at the aim pose for the
   * kick (yaw, camera height h); the broadcast cam eases in from wherever the
   * camera is now.
   */
  start(ball: Vec3Like, yaw: number, h?: number): void;
  /** Switches chase ↔ broadcast with an eased move (key C). */
  toggle(): void;
  setMode(mode: PlaybackCamMode): void;
  /** Which goal the behind-goal camera stands at: +1 = the goal at +x, −1 = at −x (default +1). */
  setGoalSide(side: 1 | -1): void;
  /** Call every frame while the ball is played back. */
  update(dt: number, ball: Vec3Like, vel: Vec3Like): void;
}

/** Exponential smoothing factor for a rate (1/s) over dt. */
function follow(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Seconds of the eased blend when switching playback cameras (§6.1: 0.8–1.2 s). */
export const PLAYBACK_SWITCH_TIME = 0.9;

/** One rig's smoothed pose. */
interface RigState {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Chase and broadcast playback cameras (§6.1) driving one perspective camera.
 * Both rigs track the ball every frame with exponential lag; the camera shows
 * the active one. Toggling (C) blends from the old rig to the new one with an
 * ease-in-out over PLAYBACK_SWITCH_TIME, so it never jumps.
 */
export function createPlaybackCamera(
  camera: THREE.PerspectiveCamera,
  pitch: Pitch,
  initial: PlaybackCamMode = 'chase',
): PlaybackCamera {
  let mode: PlaybackCamMode = initial;
  const rigs: Record<PlaybackCamMode, RigState> = {
    chase: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
    broadcast: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
    goal: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
  };
  let goalSide: 1 | -1 = 1;
  const target = new THREE.Vector3();
  /** Chase heading (yaw of the horizontal follow direction), rad. */
  let heading = 0;
  /** Blend progress 0 → 1 from `from` to the active rig (1 = no blend). */
  let blend = 1;
  let from: PlaybackCamMode = mode;
  const desired = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  function broadcastDesired(ball: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
    // Elevated on the near touchline (+z side), tracking along x.
    const hl = pitch.halfLength;
    const x = Math.max(-hl + 8, Math.min(hl - 8, ball.x * 0.85));
    return out.set(x, 0.17 * pitch.length, pitch.halfWidth + 0.27 * pitch.length);
  }

  function updateChase(dt: number, ball: Vec3Like, vel: Vec3Like): void {
    const r = rigs.chase;
    const vh = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (vh > 1.5) {
      const want = Math.atan2(vel.z, vel.x);
      let d = want - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // Lag behind the ball's heading, turning at most 2.2 rad/s so rebounds swing around smoothly.
      const maxTurn = 2.2 * dt;
      heading += Math.max(-maxTurn, Math.min(maxTurn, d * follow(4, dt)));
    }
    const back = Math.min(11, 6 + 0.15 * vh);
    const height = Math.max(CHASE_MIN_HEIGHT, 2.2 + 0.55 * ball.y);
    desired.set(ball.x - Math.cos(heading) * back, height, ball.z - Math.sin(heading) * back);
    r.pos.lerp(desired, follow(2.6, dt));
    if (r.pos.y < CHASE_MIN_HEIGHT) r.pos.y = CHASE_MIN_HEIGHT;
    lookAt.set(ball.x + vel.x * 0.15, ball.y * 0.8 + 0.3, ball.z + vel.z * 0.15);
    r.target.lerp(lookAt, follow(7, dt));
  }

  function updateBroadcast(dt: number, ball: Vec3Like): void {
    const r = rigs.broadcast;
    r.pos.lerp(broadcastDesired(ball, desired), follow(1.8, dt));
    lookAt.set(ball.x, ball.y * 0.6, ball.z);
    r.target.lerp(lookAt, follow(5, dt));
  }

  /** Behind the goal line, a little off-center toward the ball, looking at the ball. */
  function goalDesired(ball: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
    const z = Math.max(-6, Math.min(6, ball.z * 0.35));
    return out.set(goalSide * (pitch.halfLength + GOAL_CAM_BEHIND), GOAL_CAM_HEIGHT, z);
  }

  function updateGoal(dt: number, ball: Vec3Like): void {
    const r = rigs.goal;
    r.pos.lerp(goalDesired(ball, desired), follow(2.2, dt));
    lookAt.set(ball.x, ball.y * 0.8 + 0.2, ball.z);
    r.target.lerp(lookAt, follow(6, dt));
  }

  function apply(): void {
    const to = rigs[mode];
    let fov = PLAYBACK_FOV[mode];
    if (blend < 1) {
      const k = easeInOutCubic(blend);
      const a = rigs[from];
      camera.position.lerpVectors(a.pos, to.pos, k);
      target.lerpVectors(a.target, to.target, k);
      fov = PLAYBACK_FOV[from] + (fov - PLAYBACK_FOV[from]) * k;
    } else {
      camera.position.copy(to.pos);
      target.copy(to.target);
    }
    if (Math.abs(camera.fov - fov) > 1e-6) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
  }

  return {
    get mode() {
      return mode;
    },
    target,
    start(ball, yaw, h = AIM_HEIGHT_MIN) {
      heading = yaw;
      blend = 1;
      const aim = aimPose(ball, yaw, h);
      rigs.chase.pos.copy(aim.position);
      rigs.chase.target.copy(aim.target);
      broadcastDesired(ball, rigs.broadcast.pos);
      rigs.broadcast.target.set(ball.x, ball.y * 0.6, ball.z);
      goalDesired(ball, rigs.goal.pos);
      rigs.goal.target.set(ball.x, ball.y * 0.8 + 0.2, ball.z);
      apply();
    },
    toggle() {
      this.setMode(mode === 'chase' ? 'broadcast' : 'chase');
    },
    setGoalSide(side) {
      goalSide = side;
    },
    setMode(m) {
      if (m === mode) return;
      // Blend from what is on screen now: freeze it into the outgoing rig.
      rigs[mode].pos.copy(camera.position);
      rigs[mode].target.copy(target);
      from = mode;
      mode = m;
      blend = 0;
    },
    update(dt, ball, vel) {
      updateChase(dt, ball, vel);
      updateBroadcast(dt, ball);
      updateGoal(dt, ball);
      if (blend < 1) blend = Math.min(1, blend + dt / PLAYBACK_SWITCH_TIME);
      apply();
    },
  };
}
