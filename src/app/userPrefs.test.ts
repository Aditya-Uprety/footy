import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import type { PrefsStorage } from './audioPrefs';
import { defaultUserPrefs, loadUserPrefs, parseUserPrefs, saveUserPrefs, serializeUserPrefs, startingSettings, USER_PREFS_KEY } from './userPrefs';

function memory(initial: Record<string, string> = {}): PrefsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('saved names and settings (M15.4)', () => {
  it('starts empty on a first visit', () => {
    expect(loadUserPrefs(memory())).toEqual(defaultUserPrefs());
    expect(startingSettings(undefined, memory())).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('round-trips names and settings', () => {
    const prefs = {
      hotseatNames: ['Ada', 'Bo'] as [string, string],
      onlineName: 'Cy',
      settings: { ...DEFAULT_SETTINGS, kicksPerMatch: 10, shotTimerSec: 0, kitPair: 2 },
    };
    expect(parseUserPrefs(serializeUserPrefs(prefs))).toEqual(prefs);
  });

  it('drops broken data field by field and clamps settings into range', () => {
    expect(parseUserPrefs('not json')).toEqual(defaultUserPrefs());
    expect(parseUserPrefs('[1]')).toEqual(defaultUserPrefs());
    const p = parseUserPrefs(JSON.stringify({ hotseatNames: [5, '  Al   B  '], onlineName: 7, settings: { kicksPerMatch: 9999, pitchLength: 'x' } }));
    expect(p.hotseatNames).toEqual(['', 'Al B']);
    expect(p.onlineName).toBe('');
    expect(p.settings?.kicksPerMatch).toBe(100);
    expect(p.settings?.pitchLength).toBe(DEFAULT_SETTINGS.pitchLength);
  });

  it('limits saved names to the name length', () => {
    expect(parseUserPrefs(JSON.stringify({ onlineName: 'x'.repeat(60) })).onlineName.length).toBeLessThanOrEqual(16);
  });

  it('a save only changes the given fields', () => {
    const st = memory();
    saveUserPrefs({ hotseatNames: ['A', 'B'] }, st);
    saveUserPrefs({ onlineName: 'Zed' }, st);
    saveUserPrefs({ settings: { ...DEFAULT_SETTINGS, kicksPerMatch: 20 } }, st);
    const p = loadUserPrefs(st);
    expect(p.hotseatNames).toEqual(['A', 'B']);
    expect(p.onlineName).toBe('Zed');
    expect(p.settings?.kicksPerMatch).toBe(20);
    expect(st.data[USER_PREFS_KEY]).toBeTruthy();
  });

  it('query flags override saved settings, the rest stays saved', () => {
    const st = memory();
    saveUserPrefs({ settings: { ...DEFAULT_SETTINGS, kicksPerMatch: 10, shotTimerSec: 30 } }, st);
    const s = startingSettings({ shotTimerSec: 0 }, st);
    expect(s.shotTimerSec).toBe(0);
    expect(s.kicksPerMatch).toBe(10);
  });

  it('survives storage that is missing or throws', () => {
    const broken: PrefsStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(loadUserPrefs(broken)).toEqual(defaultUserPrefs());
    expect(() => saveUserPrefs({ onlineName: 'x' }, broken)).not.toThrow();
    expect(loadUserPrefs(null)).toEqual(defaultUserPrefs());
    expect(() => saveUserPrefs({ onlineName: 'x' }, null)).not.toThrow();
  });
});
