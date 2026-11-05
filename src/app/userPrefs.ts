// Saved names and match settings (PLAN §12 M15.4): the setup screens start
// with what the player used last time. One JSON object in localStorage.
// Storage can be missing or throw (private windows, blocked site data), so
// every access is guarded and the game just runs with the defaults then.
// Separate from the sound prefs (`footy-audio`). Per device, never synced.
import { NAME_MAX } from '../game/rules';
import { sanitizeSettings, type Settings } from '../game/settings';
import type { PrefsStorage } from './audioPrefs';

export const USER_PREFS_KEY = 'footy-prefs';

export interface UserPrefs {
  /** Hot-seat names, Player 1 and Player 2 ('' = not set → the default name). */
  hotseatNames: [string, string];
  /** The name used when hosting or joining online ('' = not set). */
  onlineName: string;
  /** The last match settings (hot-seat setup or host lobby); null = never changed. */
  settings: Settings | null;
}

export function defaultUserPrefs(): UserPrefs {
  return { hotseatNames: ['', ''], onlineName: '', settings: null };
}

function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/** Reads saved prefs from a JSON string; anything unreadable falls back to the default for that field. */
export function parseUserPrefs(raw: string | null | undefined): UserPrefs {
  const out = defaultUserPrefs();
  if (!raw) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof v !== 'object' || v === null) return out;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.hotseatNames)) out.hotseatNames = [cleanName(o.hotseatNames[0]), cleanName(o.hotseatNames[1])];
  out.onlineName = cleanName(o.onlineName);
  if (typeof o.settings === 'object' && o.settings !== null) {
    out.settings = sanitizeSettings(o.settings as Partial<Record<keyof Settings, unknown>>);
  }
  return out;
}

export function serializeUserPrefs(p: UserPrefs): string {
  return JSON.stringify({
    hotseatNames: [cleanName(p.hotseatNames[0]), cleanName(p.hotseatNames[1])],
    onlineName: cleanName(p.onlineName),
    settings: p.settings ? sanitizeSettings(p.settings) : null,
  });
}

function defaultStorage(): PrefsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadUserPrefs(storage: PrefsStorage | null = defaultStorage()): UserPrefs {
  try {
    return parseUserPrefs(storage?.getItem(USER_PREFS_KEY));
  } catch {
    return defaultUserPrefs();
  }
}

/** Saves the changed fields on top of what is stored (so other modes' fields survive). */
export function saveUserPrefs(patch: Partial<UserPrefs>, storage: PrefsStorage | null = defaultStorage()): void {
  try {
    const next = { ...loadUserPrefs(storage), ...patch };
    storage?.setItem(USER_PREFS_KEY, serializeUserPrefs(next));
  } catch {
    /* storage full or blocked: nothing is remembered */
  }
}

/**
 * The settings a setup screen starts with: the saved ones (or the defaults),
 * with the query-flag overrides (`?shot=`, `?place=`, …) on top.
 */
export function startingSettings(
  flags: Partial<Settings> | undefined,
  storage: PrefsStorage | null = defaultStorage(),
): Settings {
  const saved = loadUserPrefs(storage).settings;
  return sanitizeSettings({ ...(saved ?? {}), ...(flags ?? {}) });
}
