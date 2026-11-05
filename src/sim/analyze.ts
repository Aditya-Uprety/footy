// PURE. Flight statistics from a KickResult, for tests and the tuning
// report (`npm run sim:table`). Not used by gameplay.

import { kickDirection, kickRight } from './kick';
import { FRAME_STRIDE, type KickResult } from './types';

export interface KickStats {
  /** Horizontal distance from the start to the first ground contact, m (0 if it never left the ground). */
  carry: number;
  /** Highest ball-center height above the ground, m (the §5.10 planning check's "apex"). */
  apex: number;
  /** Horizontal distance from the start to where it ended, m. */
  total: number;
  /** Simulated time, s. */
  time: number;
}

/** Horizontal distance between two points. */
function hdist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function kickStats(r: KickResult): KickStats {
  const s = r.start;
  const firstGround = r.events.find((e) => e.kind === 'ground');
  const carry = firstGround && firstGround.kind === 'ground' ? hdist(firstGround.x, firstGround.z, s.x, s.z) : 0;
  let maxY = s.y; // frames are [t, x, y, z]
  for (let i = 0; i < r.frames.length; i += FRAME_STRIDE) maxY = Math.max(maxY, r.frames[i + 2]!);
  // Where the ball ended: the outcome spot for stop/out, else the last frame.
  const o = r.outcome;
  const n = r.frames.length - FRAME_STRIDE;
  const end = o.kind === 'stop' || o.kind === 'out' ? o : { x: r.frames[n + 1]!, z: r.frames[n + 3]! };
  const total = hdist(end.x, end.z, s.x, s.z);
  return { carry, apex: maxY, total, time: r.duration };
}

/**
 * Sideways offset (along the kicker's right r̂) where the ball first reaches
 * `downrange` metres along d̂, interpolated between frames. Positive = right.
 * Returns null if the ball never gets that far.
 */
export function lateralAt(r: KickResult, downrange: number): number | null {
  const d = kickDirection(r.input.yaw);
  const rt = kickRight(r.input.yaw);
  const f = r.frames;
  let prevA = 0;
  let prevL = 0;
  for (let i = 0; i < f.length; i += FRAME_STRIDE) {
    const dx = f[i + 1]! - r.start.x;
    const dz = f[i + 3]! - r.start.z;
    const along = dx * d.x + dz * d.z;
    const lat = dx * rt.x + dz * rt.z;
    if (along >= downrange) {
      if (i === 0) return lat;
      const k = (downrange - prevA) / (along - prevA);
      return prevL + (lat - prevL) * k;
    }
    prevA = along;
    prevL = lat;
  }
  return null;
}
