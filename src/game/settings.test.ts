import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultSettings, halfTimeAfter, sanitizeSettings, settingRange, validateSettings } from './settings';

describe('settings (§2.9)', () => {
  it('defaults are valid and match the plan', () => {
    expect(validateSettings(defaultSettings())).toEqual([]);
    expect(DEFAULT_SETTINGS).toMatchObject({ pitchLength: 105, pitchWidth: 68, minTeammateDist: 8, minOpponentDist: 4, kicksPerMatch: 40, shotTimerSec: 20, placementTimerSec: 0 });
    expect(halfTimeAfter(DEFAULT_SETTINGS)).toBe(20);
  });

  it('flags out-of-range, odd and non-finite values', () => {
    const s = { ...defaultSettings(), pitchLength: 130, kicksPerMatch: 41, shotTimerSec: 5, pitchWidth: Number.NaN };
    const errs = validateSettings(s);
    expect(errs.some((e) => e.startsWith('pitchLength'))).toBe(true);
    expect(errs).toContain('kicksPerMatch must be even');
    expect(errs.some((e) => e.startsWith('shotTimerSec'))).toBe(true);
    expect(errs).toContain('pitchWidth must be a number');
  });

  it('timers accept 0 as off', () => {
    expect(validateSettings({ ...defaultSettings(), shotTimerSec: 0, placementTimerSec: 0 })).toEqual([]);
    expect(validateSettings({ ...defaultSettings(), placementTimerSec: 60 })).toEqual([]);
  });

  it('opponent spacing is capped at X − 1', () => {
    expect(settingRange('minOpponentDist', { minTeammateDist: 6 }).max).toBe(5);
    expect(validateSettings({ ...defaultSettings(), minTeammateDist: 6, minOpponentDist: 5.5 })).toHaveLength(1);
  });

  it('sanitize fills defaults, snaps and clamps', () => {
    expect(sanitizeSettings()).toEqual(defaultSettings());
    const s = sanitizeSettings({ pitchLength: 200, kicksPerMatch: 33, shotTimerSec: -1, minTeammateDist: 6, minOpponentDist: 9, pitchWidth: 'x' });
    expect(s.pitchLength).toBe(120);
    expect(s.kicksPerMatch % 2).toBe(0);
    expect(s.shotTimerSec).toBe(0);
    expect(s.minOpponentDist).toBe(5);
    expect(s.pitchWidth).toBe(68);
    expect(validateSettings(s)).toEqual([]);
  });
});
