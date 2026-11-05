// Aim camera rig (PLAN §6.1–6.2, M5.1): the kicker's view on the kick line
// behind the ball. Yaw (drag / ← →), view pitch (drag / ↑ ↓, view only),
// zoom (wheel / + −) and camera height (side bar / PageUp PageDown).
//
// No aim aids: the rig draws nothing. The ball at the bottom center of the
// screen is the only reference (no crosshair, arrow or line).
//
// The pure helpers at the top (applyDrag, stepAimKeys, zoomFov,
// pitchForHeight, aimBall) carry the maths so they can be unit-tested; the
// controller wires them to the DOM and the stage camera.
import * as THREE from 'three';
import type { BallView } from '../render/ball';
import { AIM_HEIGHT_MAX, AIM_HEIGHT_MIN, aimDefaultPitch, aimPose, type CameraPose } from '../render/cameras';
import type { Stage } from '../render/scene';
import { clamp, DEG, wrapAngle } from '../shared/math';
import { PHYS, type PhysicsConstants } from '../sim/constants';
import { kickStart } from '../sim/kick';
import type { KickOrigin, Vec3 } from '../sim/types';
import { typingInField } from './inspect';

/** Tunables of the aim rig (§6.1, §6.2). Angles in radians. */
export const AIM = Object.freeze({
  FOV_MIN: 20,
  FOV_MAX: 75,
  FOV_DEFAULT: 60,
  PITCH_MIN: -60 * DEG,
  PITCH_MAX: 15 * DEG,
  /** Mouse drag: 0.15°/px, Shift 0.03°/px. */
  DRAG_PER_PX: 0.15 * DEG,
  DRAG_PER_PX_FINE: 0.03 * DEG,
  /** Arrow keys: 40°/s, Shift 6°/s (yaw and pitch). */
  KEY_RATE: 40 * DEG,
  KEY_RATE_FINE: 6 * DEG,
  /** + / − keys: FOV change per second while held, degrees. */
  FOV_KEY_RATE: 30,
  /** Wheel: FOV × exp(deltaY · this) (deltaY > 0 zooms out). */
  FOV_WHEEL: 0.0012,
  /** PageUp / PageDown: camera height change per second while held, m. */
  HEIGHT_KEY_RATE: 2.5,
});

export interface AimState {
  /** Kick direction yaw, rad, wrapped to (−π, π]. d̂ = (cos, 0, sin). */
  yaw: number;
  /** View pitch, rad (negative looks down). View only: it never changes the kick. */
  pitch: number;
  /** Vertical FOV, degrees. */
  fov: number;
  /** Camera height, m. */
  height: number;
}

/** Keys currently held that move the rig. */
export interface AimKeys {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  zoomIn: boolean;
  zoomOut: boolean;
  higher: boolean;
  lower: boolean;
}

export function noAimKeys(): AimKeys {
  return { left: false, right: false, up: false, down: false, zoomIn: false, zoomOut: false, higher: false, lower: false };
}

/**
 * Mouse drag on the view. Drag right turns right (yaw grows toward r̂), drag
 * up looks up. Shift = fine.
 */
export function applyDrag(s: AimState, dxPx: number, dyPx: number, fine: boolean): AimState {
  const k = fine ? AIM.DRAG_PER_PX_FINE : AIM.DRAG_PER_PX;
  return {
    ...s,
    yaw: wrapAngle(s.yaw + dxPx * k),
    pitch: clamp(s.pitch - dyPx * k, AIM.PITCH_MIN, AIM.PITCH_MAX),
  };
}

/** Held keys over dt seconds. Returns the new state (the height keeps the ball's place on screen). */
export function stepAimKeys(s: AimState, keys: AimKeys, dt: number, fine: boolean, ballY = PHYS.BALL_R): AimState {
  const rate = (fine ? AIM.KEY_RATE_FINE : AIM.KEY_RATE) * dt;
  const turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const look = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  const zoom = (keys.zoomOut ? 1 : 0) - (keys.zoomIn ? 1 : 0);
  const lift = (keys.higher ? 1 : 0) - (keys.lower ? 1 : 0);
  let out = s;
  if (turn || look) {
    out = {
      ...out,
      yaw: wrapAngle(out.yaw + turn * rate),
      pitch: clamp(out.pitch + look * rate, AIM.PITCH_MIN, AIM.PITCH_MAX),
    };
  }
  if (zoom) out = { ...out, fov: clamp(out.fov + zoom * AIM.FOV_KEY_RATE * dt, AIM.FOV_MIN, AIM.FOV_MAX) };
  if (lift) out = withHeight(out, out.height + lift * AIM.HEIGHT_KEY_RATE * dt, ballY);
  return out;
}

/** Wheel zoom: deltaY > 0 zooms out (wider FOV). */
export function zoomFov(fov: number, wheelDeltaY: number): number {
  return clamp(fov * Math.exp(wheelDeltaY * AIM.FOV_WHEEL), AIM.FOV_MIN, AIM.FOV_MAX);
}

/**
 * Changes the camera height and shifts the view pitch by the change in the
 * default pitch, so the ball stays at about the same place on screen.
 */
export function withHeight(s: AimState, height: number, ballY = PHYS.BALL_R): AimState {
  const h = clamp(height, AIM_HEIGHT_MIN, AIM_HEIGHT_MAX);
  if (h === s.height) return s;
  const shift = aimDefaultPitch(h, ballY) - aimDefaultPitch(s.height, ballY);
  return { ...s, height: h, pitch: clamp(s.pitch + shift, AIM.PITCH_MIN, AIM.PITCH_MAX) };
}

/** The default view pitch for a height, clamped to the free range. */
export function defaultAimPitch(height: number, ballY = PHYS.BALL_R): number {
  return clamp(aimDefaultPitch(height, ballY), AIM.PITCH_MIN, AIM.PITCH_MAX);
}

/** Where the ball sits for this kicker and yaw (a player kicker gets it at their feet, §5.6). */
export function aimBall(origin: KickOrigin, yaw: number, c: PhysicsConstants = PHYS): Vec3 {
  return kickStart(origin, yaw, c);
}

/** Camera pose for an aim state. */
export function aimStatePose(origin: KickOrigin, s: AimState, c: PhysicsConstants = PHYS): CameraPose {
  return aimPose(aimBall(origin, s.yaw, c), s.yaw, s.height, s.pitch);
}

// ---------------------------------------------------------------------------
// Controller: DOM input + stage camera.
// ---------------------------------------------------------------------------

export interface AimController {
  readonly state: Readonly<AimState>;
  readonly origin: KickOrigin;
  /**
   * New kicker. Sets the yaw, resets the view pitch to the default for the
   * current height and moves the ball to the kicker's feet. FOV and height
   * are the viewer's preference and stay.
   */
  setOrigin(origin: KickOrigin, yaw: number): void;
  setYaw(yaw: number): void;
  setHeight(h: number): void;
  setFov(fov: number): void;
  setPitch(pitch: number): void;
  /** Drives the stage camera (and the ball's position) every frame. */
  active: boolean;
  /** Accepts mouse / keyboard input (only while active). */
  inputEnabled: boolean;
  /** The aim pose for the current state (for camera transitions). */
  pose(): CameraPose;
  /** Ball position for the current origin and yaw. */
  ballPos(): Vec3;
  /** Called after any state change (e.g. to sync the height slider). */
  onChange(cb: (s: Readonly<AimState>) => void): () => void;
  dispose(): void;
}

export interface AimControllerOptions {
  ball: BallView;
  consts?: PhysicsConstants;
}

const KEY_MAP: Readonly<Record<string, keyof AimKeys>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  _: 'zoomOut',
  PageUp: 'higher',
  PageDown: 'lower',
};
const CODE_MAP: Readonly<Record<string, keyof AimKeys>> = {
  NumpadAdd: 'zoomIn',
  NumpadSubtract: 'zoomOut',
};

export function createAimController(stage: Stage, opts: AimControllerOptions): AimController {
  const consts = opts.consts ?? PHYS;
  const ballY = (): number => aimBall(origin, state.yaw, consts).y;
  let origin: KickOrigin = { kind: 'ghost', x: 0, y: consts.BALL_R, z: 0 };
  let state: AimState = { yaw: 0, pitch: defaultAimPitch(AIM_HEIGHT_MIN), fov: AIM.FOV_DEFAULT, height: AIM_HEIGHT_MIN };
  const keys = noAimKeys();
  let shift = false;
  const listeners = new Set<(s: Readonly<AimState>) => void>();
  let active = false;
  let inputEnabled = false;

  function set(next: AimState): void {
    if (next === state) return;
    state = next;
    for (const cb of listeners) cb(state);
  }

  const lookAt = new THREE.Vector3();
  function applyCamera(): void {
    const cam = stage.camera;
    if (!(cam instanceof THREE.PerspectiveCamera)) return;
    const ball = aimBall(origin, state.yaw, consts);
    opts.ball.setPosition(ball.x, ball.y, ball.z);
    const pose = aimPose(ball, state.yaw, state.height, state.pitch);
    cam.position.copy(pose.position);
    lookAt.copy(pose.target);
    cam.up.set(0, 1, 0);
    cam.lookAt(lookAt);
    if (cam.fov !== state.fov) {
      cam.fov = state.fov;
      cam.updateProjectionMatrix();
    }
  }

  // ---- mouse ---------------------------------------------------------------
  let dragging: { id: number; x: number; y: number } | null = null;
  const canvas = stage.canvas;
  const onDown = (ev: PointerEvent): void => {
    if (!active || !inputEnabled || ev.button !== 0) return;
    dragging = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    canvas.setPointerCapture?.(ev.pointerId);
    canvas.classList.add('aim-dragging');
  };
  const onMove = (ev: PointerEvent): void => {
    if (!dragging || ev.pointerId !== dragging.id) return;
    const dx = ev.clientX - dragging.x;
    const dy = ev.clientY - dragging.y;
    dragging.x = ev.clientX;
    dragging.y = ev.clientY;
    if (!active || !inputEnabled) return;
    set(applyDrag(state, dx, dy, ev.shiftKey));
  };
  const endDrag = (ev: PointerEvent): void => {
    if (!dragging || ev.pointerId !== dragging.id) return;
    dragging = null;
    canvas.releasePointerCapture?.(ev.pointerId);
    canvas.classList.remove('aim-dragging');
  };
  const onWheel = (ev: WheelEvent): void => {
    if (!active || !inputEnabled) return;
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
    const fov = zoomFov(state.fov, dy);
    if (fov !== state.fov) set({ ...state, fov });
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // ---- keys ----------------------------------------------------------------
  const keyOf = (ev: KeyboardEvent): keyof AimKeys | undefined => CODE_MAP[ev.code] ?? KEY_MAP[ev.key];
  const onKeyDown = (ev: KeyboardEvent): void => {
    shift = ev.shiftKey;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    const k = keyOf(ev);
    if (!k) return;
    ev.preventDefault();
    keys[k] = true;
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    shift = ev.shiftKey;
    const k = keyOf(ev);
    if (k) keys[k] = false;
    // Shift changes the key: "+" / "=" and "-" / "_" may come up as the other one.
    if (k === 'zoomIn' || k === 'zoomOut') keys.zoomIn = keys.zoomOut = false;
  };
  const onBlur = (): void => {
    Object.assign(keys, noAimKeys());
    shift = false;
    dragging = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const offFrame = stage.onFrame((dt) => {
    if (!active) return;
    if (inputEnabled) set(stepAimKeys(state, keys, dt, shift, ballY()));
    applyCamera();
  });

  return {
    get state() {
      return state;
    },
    get origin() {
      return origin;
    },
    setOrigin(o, yaw) {
      origin = o;
      const w = wrapAngle(yaw);
      set({ ...state, yaw: w, pitch: defaultAimPitch(state.height, aimBall(o, w, consts).y) });
      if (active) applyCamera();
    },
    setYaw(yaw) {
      set({ ...state, yaw: wrapAngle(yaw) });
    },
    setHeight(hgt) {
      set(withHeight(state, hgt, ballY()));
    },
    setFov(fov) {
      set({ ...state, fov: clamp(fov, AIM.FOV_MIN, AIM.FOV_MAX) });
    },
    setPitch(p) {
      set({ ...state, pitch: clamp(p, AIM.PITCH_MIN, AIM.PITCH_MAX) });
    },
    get active() {
      return active;
    },
    set active(v: boolean) {
      active = v;
      if (v) applyCamera();
      else {
        dragging = null;
        canvas.classList.remove('aim-dragging');
      }
    },
    get inputEnabled() {
      return inputEnabled;
    },
    set inputEnabled(v: boolean) {
      inputEnabled = v;
      if (!v) Object.assign(keys, noAimKeys());
    },
    pose: () => aimStatePose(origin, state, consts),
    ballPos: () => aimBall(origin, state.yaw, consts),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      offFrame();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.classList.remove('aim-dragging');
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      listeners.clear();
    },
  };
}
