// Kick flow (PLAN §3.4, §6.1, M5.3): one turn from the kicker's side.
//
//   aim ──KICK──> windup ──(result arrived)──> playback ──end──> hold
//    ▲                                                             │
//    └───────── transition (eased camera move to the next kicker) <┘ startTurn()
//
// The mode supplies the result: `requestKick` is called when the wind-up
// starts (practice simulates locally at once; online, the host's result
// arrives later), and the mode answers with `play(result)`. When playback has
// ended and the camera has lingered, `onPlaybackEnd` asks the mode for the
// next turn, which it gives with `startTurn`. Practice (M5.5) and the match
// views (M8, M10) share this.
//
// Keys: hold F = 3× playback · C = chase ↔ broadcast.
import * as THREE from 'three';
import type { BallView } from '../render/ball';
import { createPlaybackCamera, type PlaybackCamMode } from '../render/cameras';
import { KickPlayback } from '../render/playback';
import type { Stage } from '../render/scene';
import { easeInOutCubic } from '../shared/math';
import type { Pitch } from '../shared/pitch';
import type { KickCaps } from '../sim/kick';
import type { KickInput, KickOrigin, KickResult, SimEvent } from '../sim/types';
import type { AimController } from './aimController';
import { typingInField } from './inspect';

/** Seconds of the wind-up before the ball is struck. */
export const WINDUP_TIME = 0.35;
/** Seconds the playback camera lingers on the final position before moving on. */
export const END_HOLD_TIME = 0.9;
/** Seconds of the eased move to the next kicker (§6.1: 0.8–1.2 s). */
export const TRANSITION_TIME = 1.0;
/** Fraction of the move after which the new kicker's figure is hidden (the camera is close by then). */
export const HIDE_KICKER_AT = 0.6;
/**
 * During playback the kicker stays hidden while they would block the view:
 * the chase camera starts right behind them (the aim pose is ~1.7 m behind
 * their center) and backs off along the kick line. Hidden while the camera is
 * within KICKER_NEAR_CAMERA of them, or while they stand between the camera
 * and the ball within KICKER_SIGHT_HALFWIDTH of the sight line (horizontal), m.
 */
export const KICKER_NEAR_CAMERA = 2.6;
export const KICKER_SIGHT_HALFWIDTH = 1.2;

/** True if a kicker at (kx, kz) would block the camera's view of the ball (all horizontal). */
export function kickerBlocksView(cx: number, cz: number, bx: number, bz: number, kx: number, kz: number): boolean {
  const kdx = kx - cx;
  const kdz = kz - cz;
  if (kdx * kdx + kdz * kdz < KICKER_NEAR_CAMERA * KICKER_NEAR_CAMERA) return true;
  const ldx = bx - cx;
  const ldz = bz - cz;
  const l2 = ldx * ldx + ldz * ldz;
  if (l2 < 1e-9) return false;
  const s = (kdx * ldx + kdz * ldz) / l2;
  if (s <= 0 || s >= 1) return false;
  const px = kdx - s * ldx;
  const pz = kdz - s * ldz;
  return px * px + pz * pz < KICKER_SIGHT_HALFWIDTH * KICKER_SIGHT_HALFWIDTH;
}

export type FlowPhase = 'idle' | 'aim' | 'windup' | 'playback' | 'hold' | 'transition';

/** Who kicks next and from where. */
export interface Turn {
  origin: KickOrigin;
  /** Initial aim yaw, rad. */
  yaw: number;
  caps?: KickCaps;
}

/** What the flow needs from the kick panel (ui/kickPanel KickPanel fits). */
export interface FlowPanel {
  setEnabled(on: boolean): void;
  setCaps(caps: KickCaps): void;
  input(yaw: number): KickInput;
  onKick(cb: () => void): void;
  update(dt: number): void;
}

/** What the flow needs from the players view (render/players PlayersView fits). */
export interface FlowPlayers {
  setHidden(id: number | null): void;
  setYaw(id: number, yaw: number): void;
}

export interface KickFlowOptions {
  stage: Pick<Stage, 'camera' | 'onFrame'>;
  pitch: Pitch;
  ball: Pick<BallView, 'setPosition' | 'roll' | 'spin' | 'resetRotation'>;
  players: FlowPlayers;
  aim: Pick<AimController, 'state' | 'origin' | 'setOrigin' | 'pose' | 'ballPos' | 'active' | 'inputEnabled'>;
  panel: FlowPanel;
  /** The player kicked (wind-up started). Answer with flow.play(result). */
  requestKick(input: KickInput, turn: Turn): void;
  /** Playback finished; answer with flow.startTurn(next). */
  onPlaybackEnd(result: KickResult): void;
  /** Keeper position for the catch snap. */
  keeperAt?(id: number): { x: number; z: number } | null;
  onEvent?(ev: SimEvent, result: KickResult): void;
  onPhase?(phase: FlowPhase): void;
  /** Per-viewer setting (§2.9), default on. */
  autoSlowRolls?: boolean;
  /** Listen for F / C on window (default true; tests turn it off). */
  keys?: boolean;
}

export interface KickFlow {
  readonly phase: FlowPhase;
  readonly turn: Turn | null;
  readonly playback: KickPlayback | null;
  readonly camMode: PlaybackCamMode;
  /** Begins a turn: eases the camera to the kicker (or jumps there if `instant`). */
  startTurn(turn: Turn, opts?: { instant?: boolean }): void;
  /** Starts the wind-up (same as KICK / Space). Ignored outside the aim phase. */
  kick(): boolean;
  /** Plays a kick result (after the wind-up if it is still running). */
  play(result: KickResult): void;
  setFastForward(on: boolean): void;
  toggleCamera(): void;
  dispose(): void;
}

function kickerIdOf(origin: KickOrigin | undefined): number | null {
  return origin?.kind === 'player' ? origin.playerId : null;
}

export function createKickFlow(opts: KickFlowOptions): KickFlow {
  const { stage, aim, panel, players, ball } = opts;
  const camera = (): THREE.PerspectiveCamera | null =>
    stage.camera instanceof THREE.PerspectiveCamera ? stage.camera : null;

  let phase: FlowPhase = 'idle';
  let turn: Turn | null = null;
  let timer = 0;
  let pending: KickResult | null = null;
  let pb: KickPlayback | null = null;
  let camMode: PlaybackCamMode = 'chase';
  let fastForward = false;
  let pcam: ReturnType<typeof createPlaybackCamera> | null = null;
  /** Yaw and height of the kick being played (for the chase start). */
  let kickYaw = 0;
  let kickHeight = 1.7;
  let windupFrom: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  // Transition endpoints.
  const tFromPos = new THREE.Vector3();
  const tFromTarget = new THREE.Vector3();
  const tToPos = new THREE.Vector3();
  const tToTarget = new THREE.Vector3();
  let tFromFov = 60;
  let tToFov = 60;
  let kickerHidden = false;

  function setPhase(p: FlowPhase): void {
    if (phase === p) return;
    phase = p;
    opts.onPhase?.(p);
  }

  function lookTarget(cam: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
    cam.getWorldDirection(out);
    return out.multiplyScalar(10).add(cam.position);
  }

  function enterAim(): void {
    kickerHidden = true;
    players.setHidden(kickerIdOf(turn?.origin));
    aim.active = true;
    aim.inputEnabled = true;
    panel.setCaps(turn?.caps ?? {});
    panel.setEnabled(true);
    setPhase('aim');
  }

  function placeBallAtStart(): void {
    const b = aim.ballPos();
    ball.resetRotation();
    ball.setPosition(b.x, b.y, b.z);
  }

  function startPlayback(res: KickResult): void {
    pending = null;
    const kickerId = kickerIdOf(turn?.origin);
    if (kickerId !== null) players.setYaw(kickerId, res.input.yaw);
    ball.resetRotation();
    pb = new KickPlayback(res, {
      onEvent: (ev) => opts.onEvent?.(ev, res),
      autoSlowRolls: opts.autoSlowRolls ?? true,
      keeperAt: opts.keeperAt,
    });
    pb.applyTo(ball, 0);
    const cam = camera();
    if (cam) {
      pcam = createPlaybackCamera(cam, opts.pitch, camMode);
      pcam.start(res.start, kickYaw, kickHeight);
    }
    kickerHidden = kickerId !== null;
    players.setHidden(kickerId);
    updateKickerVisibility();
    timer = 0;
    setPhase('playback');
  }

  /** Playback: hide the kicker only while they would block the view of the ball. */
  function updateKickerVisibility(): void {
    const k = turn?.origin;
    const cam = camera();
    if (k?.kind !== 'player' || !cam || !pb) return;
    const near = kickerBlocksView(cam.position.x, cam.position.z, pb.pos.x, pb.pos.z, k.x, k.z);
    if (near === kickerHidden) return;
    kickerHidden = near;
    players.setHidden(near ? k.playerId : null);
  }

  function frame(dt: number): void {
    switch (phase) {
      case 'aim':
        panel.update(dt);
        break;
      case 'windup': {
        timer += dt;
        const cam = camera();
        if (cam && windupFrom) {
          // Lean back a touch, then snap forward into the strike.
          const k = Math.min(1, timer / WINDUP_TIME);
          const lean = k < 0.75 ? easeInOutCubic(k / 0.75) : 1 - (k - 0.75) / 0.25;
          const yaw = kickYaw;
          cam.position.set(
            windupFrom.pos.x - Math.cos(yaw) * 0.3 * lean,
            windupFrom.pos.y - 0.08 * lean,
            windupFrom.pos.z - Math.sin(yaw) * 0.3 * lean,
          );
          cam.lookAt(windupFrom.target);
        }
        if (timer >= WINDUP_TIME && pending) startPlayback(pending);
        break;
      }
      case 'playback':
      case 'hold': {
        if (!pb) break;
        const simDt = pb.update(dt, { fastForward });
        pb.applyTo(ball, simDt);
        pcam?.update(dt, pb.pos, pb.vel);
        updateKickerVisibility();
        if (phase === 'playback' && pb.done) {
          timer = 0;
          setPhase('hold');
        } else if (phase === 'hold') {
          timer += dt * (fastForward ? 3 : 1);
          if (timer >= END_HOLD_TIME) {
            const res = pb.result;
            setPhase('idle');
            opts.onPlaybackEnd(res);
          }
        }
        break;
      }
      case 'transition': {
        timer += dt;
        const cam = camera();
        const t = Math.min(1, timer / TRANSITION_TIME);
        const k = easeInOutCubic(t);
        if (cam) {
          cam.position.lerpVectors(tFromPos, tToPos, k);
          scratch.lerpVectors(tFromTarget, tToTarget, k);
          cam.up.set(0, 1, 0);
          cam.lookAt(scratch);
          const fov = tFromFov + (tToFov - tFromFov) * k;
          if (cam.fov !== fov) {
            cam.fov = fov;
            cam.updateProjectionMatrix();
          }
        }
        if (!kickerHidden && t >= HIDE_KICKER_AT) {
          players.setHidden(kickerIdOf(turn?.origin));
          kickerHidden = true;
        }
        if (t >= 1) enterAim();
        break;
      }
      case 'idle':
        break;
    }
  }
  const scratch = new THREE.Vector3();
  const offFrame = stage.onFrame((dt) => frame(dt));

  // ---- keys ----------------------------------------------------------------
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    const k = ev.key.toLowerCase();
    if (k === 'f') fastForward = true;
    else if (k === 'c' && !ev.repeat) flow.toggleCamera();
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key.toLowerCase() === 'f') fastForward = false;
  };
  const onBlur = (): void => {
    fastForward = false;
  };
  const listenKeys = opts.keys ?? true;
  if (listenKeys) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  panel.onKick(() => {
    flow.kick();
  });

  const flow: KickFlow = {
    get phase() {
      return phase;
    },
    get turn() {
      return turn;
    },
    get playback() {
      return pb;
    },
    get camMode() {
      return camMode;
    },
    startTurn(next, o = {}) {
      const cam = camera();
      turn = next;
      pending = null;
      aim.active = false;
      aim.inputEnabled = false;
      panel.setEnabled(false);
      aim.setOrigin(next.origin, next.yaw);
      const kickerId = kickerIdOf(next.origin);
      if (kickerId !== null) players.setYaw(kickerId, next.yaw);
      placeBallAtStart();
      pb = null;
      pcam = null;
      if (o.instant || !cam) {
        enterAim();
        return;
      }
      // Everyone is visible during the move; the new kicker hides once the camera is close.
      kickerHidden = false;
      players.setHidden(null);
      const pose = aim.pose();
      tFromPos.copy(cam.position);
      lookTarget(cam, tFromTarget);
      tToPos.copy(pose.position);
      tToTarget.copy(pose.target);
      tFromFov = cam.fov;
      tToFov = aim.state.fov;
      timer = 0;
      setPhase('transition');
    },
    kick() {
      if (phase !== 'aim' || !turn) return false;
      const input = panel.input(aim.state.yaw);
      kickYaw = input.yaw;
      kickHeight = aim.state.height;
      aim.active = false;
      aim.inputEnabled = false;
      panel.setEnabled(false);
      const cam = camera();
      windupFrom = cam ? { pos: cam.position.clone(), target: lookTarget(cam, new THREE.Vector3()) } : null;
      timer = 0;
      pending = null;
      setPhase('windup');
      opts.requestKick(input, turn);
      return true;
    },
    play(result) {
      if (phase === 'windup' && timer < WINDUP_TIME) {
        pending = result;
        return;
      }
      // A result nobody asked for here (host guard auto-kick, the other seat
      // online): lock the controls and play it from the current aim height.
      if (phase === 'aim' || phase === 'transition') {
        kickHeight = aim.state.height;
        aim.active = false;
        aim.inputEnabled = false;
        panel.setEnabled(false);
      }
      kickYaw = result.input.yaw;
      startPlayback(result);
    },
    setFastForward(on) {
      fastForward = on;
    },
    toggleCamera() {
      camMode = camMode === 'chase' ? 'broadcast' : 'chase';
      if (pcam && (phase === 'playback' || phase === 'hold')) pcam.setMode(camMode);
    },
    dispose() {
      offFrame();
      if (listenKeys) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      }
      players.setHidden(null);
      aim.active = false;
      aim.inputEnabled = false;
    },
  };
  return flow;
}
