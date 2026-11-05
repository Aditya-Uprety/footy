// Replay model (PLAN §12 M15.1): the pure choices behind "replay the last
// kick" — which cameras, which speeds, and which goal the behind-goal camera
// stands at. No DOM or Three.js here; the flow and the controls use it.
import type { PlaybackCamMode } from '../render/cameras';
import { FRAME_STRIDE, type KickResult } from '../sim/types';

/** Replay cameras in the order C cycles through them. */
export const REPLAY_CAMS: readonly PlaybackCamMode[] = ['chase', 'broadcast', 'goal'];

export const REPLAY_CAM_LABEL: Readonly<Record<PlaybackCamMode, string>> = {
  chase: 'Chase',
  broadcast: 'Broadcast',
  goal: 'Behind goal',
};

/** Replay speeds (real time = 1×) and their button labels; keys 1, 2, 3. */
export const REPLAY_SPEEDS: readonly number[] = [1, 0.5, 0.25];

export const REPLAY_SPEED_LABEL = (speed: number): string => (speed === 1 ? '1×' : speed === 0.5 ? '½×' : speed === 0.25 ? '¼×' : `${speed}×`);

/** The camera after `cam` in the replay cycle (unknown → the first). */
export function nextReplayCam(cam: PlaybackCamMode): PlaybackCamMode {
  const i = REPLAY_CAMS.indexOf(cam);
  return REPLAY_CAMS[(i + 1) % REPLAY_CAMS.length]!;
}

/** The nearest allowed speed to `speed`. */
export function snapReplaySpeed(speed: number): number {
  let best = REPLAY_SPEEDS[0]!;
  for (const s of REPLAY_SPEEDS) if (Math.abs(s - speed) < Math.abs(best - speed)) best = s;
  return best;
}

/**
 * The goal the ball was heading for: the side of the pitch where the kick
 * ended (+1 = the goal at +x). A kick that ends near the halfway line goes by
 * its direction instead.
 */
export function goalSideOf(result: KickResult): 1 | -1 {
  const n = result.frames.length / FRAME_STRIDE;
  const endX = n > 0 ? result.frames[(n - 1) * FRAME_STRIDE + 1]! : 0;
  if (Math.abs(endX) >= 1) return endX > 0 ? 1 : -1;
  return Math.cos(result.input.yaw) >= 0 ? 1 : -1;
}

/** What the controls show about a running replay. */
export interface ReplayState {
  cam: PlaybackCamMode;
  speed: number;
  /** The replayed ball has stopped (the replay waits for Replay again / Close). */
  done: boolean;
}
