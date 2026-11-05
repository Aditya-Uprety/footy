// PURE. Match settings, their defaults and ranges (PLAN §2.9).
// Every layer reads pitch size, spacing, match length and timers from here;
// nothing hardcodes 105/68/8/4/40/20.
import { DEFAULT_KIT_PAIR, KIT_PAIRS } from '../shared/kits';

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
  /** Kit pair: index into `KIT_PAIRS` (shared/kits.ts). */
  kitPair: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  pitchLength: 105,
  pitchWidth: 68,
  minTeammateDist: 8,
  minOpponentDist: 4,
  kicksPerMatch: 40,
  shotTimerSec: 30,
  placementTimerSec: 0,
  kitPair: DEFAULT_KIT_PAIR,
});

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}

/** Inclusive numeric range. `offAllowed`: 0 means "off" and is also valid. */
export interface SettingRange {
  min: number;
  max: number;
  /** Values snap to multiples of this (kicks: 2 = even). */
  step: number;
  offAllowed?: boolean;
}

/**
 * §2.9 ranges. minOpponentDist's max depends on minTeammateDist (Y ≤ X − 1);
 * use `settingRange` to get the effective range.
 */
export const SETTING_RANGES: Readonly<Record<keyof Settings, SettingRange>> = Object.freeze({
  pitchLength: { min: 90, max: 120, step: 1 },
  pitchWidth: { min: 60, max: 90, step: 1 },
  minTeammateDist: { min: 5, max: 15, step: 0.5 },
  minOpponentDist: { min: 2, max: 14, step: 0.5 },
  kicksPerMatch: { min: 10, max: 100, step: 2 },
  shotTimerSec: { min: 10, max: 60, step: 1, offAllowed: true },
  placementTimerSec: { min: 20, max: 120, step: 1, offAllowed: true },
  kitPair: { min: 0, max: KIT_PAIRS.length - 1, step: 1 },
});

/** The effective range of one setting given the others (Y ≤ X − 1). */
export function settingRange(key: keyof Settings, s: Pick<Settings, 'minTeammateDist'>): SettingRange {
  const r = SETTING_RANGES[key];
  if (key === 'minOpponentDist') return { ...r, max: Math.min(r.max, s.minTeammateDist - 1) };
  return r;
}

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Human-readable problems with a settings object; empty = valid. */
export function validateSettings(s: Settings): string[] {
  const errors: string[] = [];
  for (const key of KEYS) {
    const v = s[key];
    const r = settingRange(key, s);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${key} must be a number`);
      continue;
    }
    if (r.offAllowed && v === 0) continue;
    if (v < r.min || v > r.max) {
      errors.push(`${key} must be ${r.offAllowed ? 'off or ' : ''}between ${r.min} and ${r.max}`);
      continue;
    }
    if (key === 'kicksPerMatch' && v % 2 !== 0) errors.push('kicksPerMatch must be even');
  }
  return errors;
}

function sanitizeOne(key: keyof Settings, raw: unknown, s: Pick<Settings, 'minTeammateDist'>): number {
  const r = settingRange(key, s);
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_SETTINGS[key];
  if (r.offAllowed && v <= 0) return 0;
  const snapped = Math.round(v / r.step) * r.step;
  return Math.min(r.max, Math.max(r.min, snapped));
}

/**
 * A valid Settings from anything (e.g. a stored or received object): missing
 * or non-finite values take the default, others are snapped and clamped into
 * range (kicks to an even number, timers ≤ 0 to off).
 */
export function sanitizeSettings(partial: Partial<Record<keyof Settings, unknown>> = {}): Settings {
  const out = defaultSettings();
  // Teammate spacing first: the opponent range depends on it.
  out.minTeammateDist = sanitizeOne('minTeammateDist', partial.minTeammateDist, out);
  for (const key of KEYS) {
    if (key === 'minTeammateDist') continue;
    out[key] = sanitizeOne(key, partial[key], out);
  }
  return out;
}

/** Kicks before half-time. */
export function halfTimeAfter(s: Pick<Settings, 'kicksPerMatch'>): number {
  return s.kicksPerMatch / 2;
}
