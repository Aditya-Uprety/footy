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
// Replay (M15.1): while aiming (or watching the other seat aim) R replays the
// last kick through the same recorded frames — chase / broadcast / behind-goal
// camera, 1× · ½× · ¼× — and then cuts back to the aim view. The shot timer
// keeps running; the aim state is untouched.
//
// Keys: hold F = 3× playback · C = chase ↔ broadcast (replay: chase → broadcast
// → behind goal) · R = replay the last kick / close the replay.
import * as THREE from 'three';
import type { BallView } from '../render/ball';
import { createPlaybackCamera, type PlaybackCamMode } from '../render/cameras';
import { AUTO_REPLAY_HOLD, AUTO_REPLAY_MAX, goalSideOf, nextReplayCam, REPLAY_SPEEDS, snapReplaySpeed, type ReplayState } from './replayModel';
import { KickPlayback } from '../render/playback';
import type { Stage } from '../render/scene';
import { angleDiff, easeInOutCubic } from '../shared/math';
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
/** Spectator: how fast the view catches up with the streamed yaw (1/s; ~10 Hz updates are smoothed). */
export const FOLLOW_RATE = 8;

/** One frame of the spectator's yaw smoothing: from `yaw` toward `target` along the shortest arc. */
export function followStep(yaw: number, target: number, dt: number, rate = FOLLOW_RATE): number {
  const d = angleDiff(yaw, target);
  if (Math.abs(d) < 1e-4) return target;
  return yaw + d * (1 - Math.exp(-rate * dt));
}
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

export type FlowPhase = 'idle' | 'aim' | 'windup' | 'playback' | 'hold' | 'transition' | 'replay';

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
  /** Animation and ring hooks (M12.2); all optional so simple stand-ins still fit. */
  setPossessor?(id: number | null): void;
  playWindup?(id: number): void;
  playKick?(id: number): void;
  playCatch?(id: number, ball: { x: number; y: number; z: number }): void;
  relax?(): void;
}

export interface KickFlowOptions {
  stage: Pick<Stage, 'camera' | 'onFrame'>;
  pitch: Pitch;
  ball: Pick<BallView, 'setPosition' | 'roll' | 'spin' | 'resetRotation'>;
  players: FlowPlayers;
  aim: Pick<AimController, 'state' | 'origin' | 'setOrigin' | 'setYaw' | 'pose' | 'ballPos' | 'active' | 'inputEnabled'>;
  panel: FlowPanel;
  /** The player kicked (wind-up started). Answer with flow.play(result). */
  requestKick(input: KickInput, turn: Turn): void;
  /** Playback finished; answer with flow.startTurn(next). */
  onPlaybackEnd(result: KickResult): void;
  /** Keeper position for the catch snap. */
  keeperAt?(id: number): { x: number; z: number } | null;
  onEvent?(ev: SimEvent, result: KickResult): void;
  /** An event of a replayed kick (sounds only: the modes must not repeat toasts or scores). */
  onReplayEvent?(ev: SimEvent, result: KickResult): void;
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
  /** True while the turn belongs to the other seat (online): the view follows, the controls stay off. */
  readonly spectating: boolean;
  /** Spectator: the viewer chose the broadcast camera while watching (C; kept between turns). */
  readonly spectatorBroadcast: boolean;
  /** Spectator: the kicker's latest streamed yaw; the view eases toward it. */
  followYaw(yaw: number): void;
  /** True once a kick has been played here, so R has something to replay. */
  readonly canReplay: boolean;
  /** The running replay's camera and speed, or null. */
  readonly replay: ReplayState | null;
  /** The running replay's playback (its time and position); null when not replaying. */
  readonly replayPlayback: KickPlayback | null;
  /**
   * Replays the last kick (aim phase only; also while spectating). `auto` = the
   * automatic goal replay: 1× only, closes itself shortly after the ball stops.
   */
  startReplay(opts?: { auto?: boolean }): boolean;
  /** Leaves the replay and cuts back to the aim view. */
  stopReplay(): void;
  /** Forgets the last kick (the layout changed: practice's New layout). */
  forgetLast(): void;
  /** Plays the replay again from the strike. */
  restartReplay(): void;
  setReplayCamera(mode: PlaybackCamMode): void;
  setReplaySpeed(speed: number): void;
  /** Begins a turn: eases the camera to the kicker (or jumps there if `instant`); `spectate` = someone else kicks. */
  startTurn(turn: Turn, opts?: { instant?: boolean; spectate?: boolean }): void;
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

  // Replay: the last played kick (kept until the next one), its own playback and camera.
  let last: { result: KickResult; kickerId: number | null; kickerAt: { x: number; z: number } | null; height: number } | null = null;
  let rpb: KickPlayback | null = null;
  let rcam: ReturnType<typeof createPlaybackCamera> | null = null;
  let replayCam: PlaybackCamMode = 'chase';
  let replaySpeed = 1;
  let replayHidden = false;
  let replayAuto = false;
  let replayElapsed = 0;
  let replayEndHold = 0;

  // Transition endpoints.
  const tFromPos = new THREE.Vector3();
  const tFromTarget = new THREE.Vector3();
  const tToPos = new THREE.Vector3();
  const tToTarget = new THREE.Vector3();
  let tFromFov = 60;
  let tToFov = 60;
  let kickerHidden = false;
  let spectating = false;
  /** Viewer preference while spectating (C). */
  let spectBroadcast = false;
  let spectCam: ReturnType<typeof createPlaybackCamera> | null = null;
  let followTarget: number | null = null;
  const still = { x: 0, y: 0, z: 0 };

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
    const broadcast = spectating && spectBroadcast;
    kickerHidden = !broadcast;
    players.setHidden(broadcast ? null : kickerIdOf(turn?.origin));
    aim.active = !broadcast;
    if (broadcast) startSpectCam();
    aim.inputEnabled = !spectating;
    panel.setCaps(turn?.caps ?? {});
    panel.setEnabled(!spectating);
    setPhase('aim');
  }

  /** Spectator's broadcast view of the waiting ball (blends in from the current view). */
  function startSpectCam(): void {
    const cam = camera();
    if (!cam) return;
    aim.active = false;
    spectCam = createPlaybackCamera(cam, opts.pitch, 'chase');
    spectCam.start(aim.ballPos(), aim.state.yaw, aim.state.height);
    spectCam.setMode('broadcast');
  }

  /** Eased move from wherever the camera is to the aim pose; enterAim at the end. */
  function transitionToAim(): void {
    const cam = camera();
    if (!cam) {
      enterAim();
      return;
    }
    const pose = aim.pose();
    tFromPos.copy(cam.position);
    lookTarget(cam, tFromTarget);
    tToPos.copy(pose.position);
    tToTarget.copy(pose.target);
    tFromFov = cam.fov;
    tToFov = aim.state.fov;
    timer = 0;
    setPhase('transition');
  }

  function placeBallAtStart(): void {
    const b = aim.ballPos();
    ball.resetRotation();
    ball.setPosition(b.x, b.y, b.z);
  }

  function startPlayback(res: KickResult): void {
    pending = null;
    spectCam = null;
    followTarget = null;
    const kickerId = kickerIdOf(turn?.origin);
    const k = turn?.origin;
    last = { result: res, kickerId, kickerAt: k?.kind === 'player' ? { x: k.x, z: k.z } : null, height: kickHeight };
    if (kickerId !== null) {
      players.setYaw(kickerId, res.input.yaw);
      players.playKick?.(kickerId);
    }
    players.setPossessor?.(null);
    ball.resetRotation();
    pb = new KickPlayback(res, {
      onEvent: (ev) => {
        if (ev.kind === 'catch') players.playCatch?.(ev.keeperId, ev);
        opts.onEvent?.(ev, res);
      },
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

  // ---- replay (M15.1) ---------------------------------------------------------
  function beginReplayRun(): void {
    const cam = camera();
    if (!last || !cam) return;
    const { result, kickerId } = last;
    replayElapsed = 0;
    replayEndHold = 0;
    if (kickerId !== null) {
      players.setYaw(kickerId, result.input.yaw);
      players.playKick?.(kickerId);
    }
    ball.resetRotation();
    rpb = new KickPlayback(result, {
      onEvent: (ev) => {
        if (ev.kind === 'catch') players.playCatch?.(ev.keeperId, ev);
        opts.onReplayEvent?.(ev, result);
      },
      autoSlowRolls: opts.autoSlowRolls ?? true,
      keeperAt: opts.keeperAt,
    });
    rpb.applyTo(ball, 0);
    rcam = createPlaybackCamera(cam, opts.pitch, replayCam);
    rcam.setGoalSide(goalSideOf(result));
    rcam.start(result.start, result.input.yaw, last.height);
    replayHidden = kickerId !== null;
    players.setHidden(kickerId);
    updateReplayVisibility();
  }

  /** The replayed kicker hides only while they would block the view of the ball. */
  function updateReplayVisibility(): void {
    const id = last?.kickerId ?? null;
    const at = last?.kickerAt;
    const cam = camera();
    if (id === null || !at || !cam || !rpb) return;
    const near = kickerBlocksView(cam.position.x, cam.position.z, rpb.pos.x, rpb.pos.z, at.x, at.z);
    if (near === replayHidden) return;
    replayHidden = near;
    players.setHidden(near ? id : null);
  }

  /** Drops the replay's playback and camera and relaxes the figures (no phase change). */
  function clearReplay(): void {
    if (!rpb && !rcam) return;
    rpb = null;
    rcam = null;
    players.relax?.();
  }

  /** Back to the aim view after a replay: a cut, like the cut in. */
  function endReplay(): void {
    clearReplay();
    placeBallAtStart();
    kickerHidden = false;
    spectCam = null;
    enterAim();
  }

  function frame(dt: number): void {
    switch (phase) {
      case 'aim':
        if (!spectating) {
          panel.update(dt);
          break;
        }
        if (followTarget !== null && followTarget !== aim.state.yaw) {
          aim.setYaw(followStep(aim.state.yaw, followTarget, dt));
          // The aim rig moves the ball only while it drives the camera.
          if (!aim.active) placeBallAtStart();
        }
        if (spectCam) {
          const b = aim.ballPos();
          spectCam.update(dt, b, still);
        }
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
      case 'replay': {
        if (!rpb) break;
        const simDt = rpb.update(dt * (replayAuto ? 1 : replaySpeed), { fastForward });
        rpb.applyTo(ball, simDt);
        rcam?.update(dt, rpb.pos, rpb.vel);
        updateReplayVisibility();
        if (replayAuto) {
          // The automatic goal replay closes itself (hard cap in case a ball never settles).
          replayElapsed += dt;
          if (rpb.done) replayEndHold += dt;
          if (replayEndHold >= AUTO_REPLAY_HOLD || replayElapsed >= AUTO_REPLAY_MAX) endReplay();
        }
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
    else if (k === 'r' && !ev.repeat) {
      if (phase === 'replay') flow.stopReplay();
      else flow.startReplay();
    } else if (phase === 'replay' && !ev.repeat) {
      const i = Number(k) - 1;
      if (Number.isInteger(i) && i >= 0 && i < REPLAY_SPEEDS.length) flow.setReplaySpeed(REPLAY_SPEEDS[i]!);
      else if (k === ' ') {
        ev.preventDefault();
        if (replayAuto) flow.stopReplay();
        else flow.restartReplay();
      } else if (k === 'escape') flow.stopReplay();
    }
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
    get spectating() {
      return spectating;
    },
    get spectatorBroadcast() {
      return spectBroadcast;
    },
    followYaw(yaw) {
      if (spectating && Number.isFinite(yaw)) followTarget = yaw;
    },
    get canReplay() {
      return last !== null;
    },
    get replay() {
      return phase === 'replay' && rpb ? { cam: replayCam, speed: replayAuto ? 1 : replaySpeed, done: rpb.done, auto: replayAuto } : null;
    },
    get replayPlayback() {
      return phase === 'replay' ? rpb : null;
    },
    startReplay(o = {}) {
      if (phase !== 'aim' || !last || !camera()) return false;
      replayAuto = o.auto === true;
      // The aim view is suspended (not reset): enterAim() brings it back.
      aim.active = false;
      aim.inputEnabled = false;
      panel.setEnabled(false);
      spectCam = null;
      followTarget = null;
      players.setHidden(null);
      kickerHidden = false;
      beginReplayRun();
      setPhase('replay');
      return true;
    },
    stopReplay() {
      if (phase === 'replay') endReplay();
    },
    forgetLast() {
      if (phase === 'replay') endReplay();
      last = null;
    },
    restartReplay() {
      if (phase === 'replay' && !replayAuto) beginReplayRun();
    },
    setReplayCamera(mode) {
      replayCam = mode;
      if (phase === 'replay' && rcam) rcam.setMode(mode);
    },
    setReplaySpeed(speed) {
      if (replayAuto && phase === 'replay') return;
      replaySpeed = snapReplaySpeed(speed);
    },
    startTurn(next, o = {}) {
      const cam = camera();
      turn = next;
      spectating = o.spectate === true;
      spectCam = null;
      followTarget = null;
      pending = null;
      aim.active = false;
      aim.inputEnabled = false;
      panel.setEnabled(false);
      aim.setOrigin(next.origin, next.yaw);
      const kickerId = kickerIdOf(next.origin);
      if (kickerId !== null) players.setYaw(kickerId, next.yaw);
      players.relax?.();
      players.setPossessor?.(kickerId);
      placeBallAtStart();
      pb = null;
      pcam = null;
      clearReplay();
      if (o.instant || !cam) {
        enterAim();
        return;
      }
      // Everyone is visible during the move; the new kicker hides once the camera is close.
      kickerHidden = false;
      players.setHidden(null);
      if (spectating && spectBroadcast) {
        enterAim(); // the broadcast rig blends in from here
        return;
      }
      transitionToAim();
    },
    kick() {
      if (phase !== 'aim' || !turn || spectating) return false;
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
      const kickerId = kickerIdOf(turn.origin);
      if (kickerId !== null) players.playWindup?.(kickerId);
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
      if (phase === 'replay') clearReplay();
      if (phase === 'aim' || phase === 'transition' || phase === 'replay') {
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
      if (spectating && phase === 'aim') {
        // Watching the other seat aim: their view ↔ broadcast (§6.1).
        spectBroadcast = !spectBroadcast;
        if (spectBroadcast) {
          kickerHidden = false;
          players.setHidden(null);
          startSpectCam();
        } else {
          spectCam = null;
          transitionToAim();
        }
        return;
      }
      if (phase === 'replay') {
        flow.setReplayCamera(nextReplayCam(replayCam));
        return;
      }
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
      players.setPossessor?.(null);
      aim.active = false;
      aim.inputEnabled = false;
    },
  };
  return flow;
}
