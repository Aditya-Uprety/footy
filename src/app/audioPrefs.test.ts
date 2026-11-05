import { describe, expect, it } from 'vitest';
import { createAudioManager } from './audio';
import { AUDIO_PREFS_KEY, bindAudioPrefs, DEFAULT_AUDIO_PREFS, loadAudioPrefs, parseAudioPrefs, saveAudioPrefs, serializeAudioPrefs, type PrefsStorage } from './audioPrefs';

function memory(initial: Record<string, string> = {}): PrefsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('saved audio preferences (M14.2)', () => {
  it('round-trips volume and mute', () => {
    const s = serializeAudioPrefs({ volume: 0.35, muted: true });
    expect(parseAudioPrefs(s)).toEqual({ volume: 0.35, muted: true });
  });

  it('falls back to defaults for missing, broken or out-of-range data', () => {
    expect(parseAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('not json')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('42')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('{"volume":"loud","muted":"yes"}')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('{"volume":7}').volume).toBe(1);
    expect(parseAudioPrefs('{"volume":-3,"muted":true}')).toEqual({ volume: 0, muted: true });
    expect(parseAudioPrefs('{"muted":true}')).toEqual({ volume: DEFAULT_AUDIO_PREFS.volume, muted: true });
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
    expect(loadAudioPrefs(broken)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(() => saveAudioPrefs({ volume: 0.5, muted: false }, broken)).not.toThrow();
    expect(loadAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(() => saveAudioPrefs({ volume: 0.5, muted: false }, null)).not.toThrow();
  });

  it('bindAudioPrefs restores the saved values and saves every change (a reload keeps mute)', () => {
    const store = memory({ [AUDIO_PREFS_KEY]: '{"volume":0.4,"muted":true}' });
    const a = createAudioManager();
    bindAudioPrefs(a, store);
    expect(a.volume).toBe(0.4);
    expect(a.muted).toBe(true);
    a.setVolume(0.9);
    a.setMuted(false);
    expect(parseAudioPrefs(store.data[AUDIO_PREFS_KEY])).toEqual({ volume: 0.9, muted: false });
    // "Reload": a fresh manager reads what was saved.
    const b = createAudioManager();
    bindAudioPrefs(b, store);
    expect(b.volume).toBe(0.9);
    expect(b.muted).toBe(false);
  });

  it('a first visit saves nothing until something changes', () => {
    const store = memory();
    const a = createAudioManager();
    bindAudioPrefs(a, store);
    expect(store.data).toEqual({});
    a.setMuted(true);
    expect(parseAudioPrefs(store.data[AUDIO_PREFS_KEY]).muted).toBe(true);
  });
});
