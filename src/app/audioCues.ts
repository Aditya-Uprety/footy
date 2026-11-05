// Which sound a simulation event makes, and how loud (PLAN §12 M14.1). Pure:
// the audio manager plays what this returns, so the mapping is unit-tested
// without any audio hardware.
import { PHYS } from '../sim/constants';
import type { SimEvent } from '../sim/types';
import type { SoundName } from './soundSynth';

/** One sound to play: gain 0..1 (before the master volume) and playback rate (pitch). */
export interface CuePlay {
  sound: SoundName;
  gain: number;
  rate: number;
}

/** A goal-line exit this close to the goal (|z| in m) draws a groan from the crowd. */
export const NEAR_MISS_Z = 8;
/** Bounces and thuds slower than this are inaudible settling, m/s. */
export const MIN_IMPACT_SPEED = 1;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 0 at the weakest kick, 1 at full power. */
export function powerOfSpeed(speed: number): number {
  return clamp((speed - PHYS.V_MIN) / (PHYS.V_MAX - PHYS.V_MIN), 0, 1);
}

/** The sounds for one playback event (usually one, sometimes two, often none). */
export function cuesFor(ev: SimEvent): CuePlay[] {
  switch (ev.kind) {
    case 'kick': {
      const p = powerOfSpeed(ev.speed);
      // Harder kicks are louder and a touch sharper.
      return [{ sound: 'kick', gain: 0.3 + 0.7 * p, rate: 0.88 + 0.26 * p }];
    }
    case 'ground': {
      if (ev.speed < MIN_IMPACT_SPEED) return [];
      const g = clamp(ev.speed / 14, 0.1, 0.9) * (ev.tail ? 0.5 : 1);
      return [{ sound: 'bounce', gain: g, rate: 0.9 + 0.2 * clamp(ev.speed / 20, 0, 1) }];
    }
    case 'player': {
      if (ev.speed < MIN_IMPACT_SPEED) return [];
      return [{ sound: 'thud', gain: clamp(0.25 + ev.speed / 22, 0.25, 1), rate: 0.92 + 0.16 * clamp(ev.speed / 25, 0, 1) }];
    }
    case 'post':
    case 'bar': {
      // Frame hits in the tail are visual only (like the toast).
      if (ev.tail) return [];
      const g = clamp(0.45 + ev.speed / 30, 0.45, 1);
      return [
        { sound: ev.kind, gain: g, rate: 1 },
        { sound: 'groan', gain: 0.55, rate: 1 },
      ];
    }
    case 'net': {
      if (ev.speed < MIN_IMPACT_SPEED) return [];
      return [{ sound: 'net', gain: clamp(0.3 + ev.speed / 16, 0.3, 1), rate: 1 }];
    }
    case 'goal':
      return [{ sound: 'roar', gain: 1, rate: 1 }];
    case 'catch':
      return [
        { sound: 'catch', gain: 0.9, rate: 1 },
        { sound: 'roar', gain: 0.28, rate: 1.08 },
      ];
    case 'out':
      return ev.line === 'goal' && Math.abs(ev.z) < NEAR_MISS_Z ? [{ sound: 'groan', gain: 0.6, rate: 1 }] : [];
    case 'stop':
      return [];
  }
}

export type WhistleKind = 'kickoff' | 'half' | 'full';

/** The whistle sound for a moment of the match. */
export const WHISTLE_SOUND: Readonly<Record<WhistleKind, SoundName>> = Object.freeze({
  kickoff: 'whistle1',
  half: 'whistle2',
  full: 'whistle3',
});
