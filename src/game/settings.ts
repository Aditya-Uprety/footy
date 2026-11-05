// PURE. Match settings and their defaults (PLAN §2.9).
// M0.2 adds the interface and defaults so every layer can read them;
// ranges and validation arrive in M6.1.

export interface Settings {
  /** Pitch length L, metres. */
  pitchLength: number;
  /** Pitch width W, metres. */
  pitchWidth: number;
  /** Minimum distance between teammates X, metres. */
  minTeammateDist: number;
  /** Minimum distance to opponents Y, metres. */
  minOpponentDist: number;
  /** Kicks per match (even; half-time at half). */
  kicksPerMatch: number;
  /** Shot timer in seconds; 0 = off. */
  shotTimerSec: number;
  /** Placement timer in seconds; 0 = off. */
  placementTimerSec: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  pitchLength: 105,
  pitchWidth: 68,
  minTeammateDist: 8,
  minOpponentDist: 4,
  kicksPerMatch: 40,
  shotTimerSec: 20,
  placementTimerSec: 0,
});

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}
