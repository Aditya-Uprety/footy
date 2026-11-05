// Saved sound preferences (PLAN §12 M14.2): volume and mute survive a reload.
// Stored as JSON under one localStorage key. Storage can be missing or throw
// (private windows, blocked site data), so every access is guarded and the
// game simply runs with the defaults then.

export const AUDIO_PREFS_KEY = 'footy-audio';

export interface AudioPrefs {
  /** Master volume 0..1. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_PREFS: Readonly<AudioPrefs> = Object.freeze({ volume: 0.8, muted: false });

/** The bits of Storage we use (tests pass a plain object). */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads saved prefs from a JSON string; anything unreadable falls back to the default for that field. */
export function parseAudioPrefs(raw: string | null | undefined): AudioPrefs {
  const out: AudioPrefs = { ...DEFAULT_AUDIO_PREFS };
  if (!raw) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof v !== 'object' || v === null) return out;
  const o = v as Record<string, unknown>;
  if (typeof o.volume === 'number' && Number.isFinite(o.volume)) out.volume = Math.min(1, Math.max(0, o.volume));
  if (typeof o.muted === 'boolean') out.muted = o.muted;
  return out;
}

export function serializeAudioPrefs(p: AudioPrefs): string {
  return JSON.stringify({ volume: Math.round(p.volume * 100) / 100, muted: p.muted });
}

function defaultStorage(): PrefsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadAudioPrefs(storage: PrefsStorage | null = defaultStorage()): AudioPrefs {
  try {
    return parseAudioPrefs(storage?.getItem(AUDIO_PREFS_KEY));
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function saveAudioPrefs(p: AudioPrefs, storage: PrefsStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(AUDIO_PREFS_KEY, serializeAudioPrefs(p));
  } catch {
    /* storage full or blocked: the preference just isn't remembered */
  }
}

/** What the prefs need from the audio manager (app/audio AudioManager fits). */
export interface PrefsTarget {
  readonly volume: number;
  readonly muted: boolean;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  onChange(cb: () => void): () => void;
}

/** Applies the saved prefs to `audio`, then saves every later change. Returns an unsubscribe function. */
export function bindAudioPrefs(audio: PrefsTarget, storage: PrefsStorage | null = defaultStorage()): () => void {
  const p = loadAudioPrefs(storage);
  audio.setVolume(p.volume);
  audio.setMuted(p.muted);
  return audio.onChange(() => saveAudioPrefs({ volume: audio.volume, muted: audio.muted }, storage));
}
