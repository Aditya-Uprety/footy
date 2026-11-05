import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, validateSettings } from '../game/settings';
import { changeSetting, formatSetting, settingsSummary, SETTING_META } from './settingsPanel';

describe('settings panel model', () => {
  it('covers every setting once (the kit pair has its own swatch chooser)', () => {
    const sliders = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'kitPair');
    expect(SETTING_META.map((m) => m.key).sort()).toEqual(sliders.sort());
  });

  it('changeSetting snaps into range and keeps Y ≤ X − 1', () => {
    const s = sanitizeSettings({});
    expect(changeSetting(s, 'kicksPerMatch', 11).kicksPerMatch).toBe(12);
    expect(changeSetting(s, 'kicksPerMatch', 10).kicksPerMatch).toBe(10);
    expect(changeSetting(s, 'kicksPerMatch', 5).kicksPerMatch).toBe(10);
    expect(changeSetting(s, 'shotTimerSec', 0).shotTimerSec).toBe(0);
    const tight = changeSetting(changeSetting(s, 'minOpponentDist', 7), 'minTeammateDist', 5);
    expect(tight.minOpponentDist).toBeLessThanOrEqual(tight.minTeammateDist - 1);
    expect(validateSettings(tight)).toEqual([]);
  });

  it('formats values and the summary', () => {
    expect(formatSetting({ unit: 's' }, 0)).toBe('Off');
    expect(formatSetting({ unit: 'm' }, 105)).toBe('105 m');
    expect(formatSetting({ unit: '' }, 40)).toBe('40');
    expect(settingsSummary(sanitizeSettings({}))).toBe('40 kicks · 30 s shot timer · 105 × 68 m');
    expect(settingsSummary(sanitizeSettings({ shotTimerSec: 0, placementTimerSec: 45 }))).toContain('no shot timer');
    expect(settingsSummary(sanitizeSettings({ placementTimerSec: 45 }))).toContain('45 s per placement');
  });
});
