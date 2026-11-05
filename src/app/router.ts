// Hash router (PLAN §3.3) and query flags (parsed once at boot).
// parseRoute / parseFlags are pure; startRouter wires them to window.

export type Route =
  | { name: 'menu' }
  | { name: 'hotseat' }
  | { name: 'host' }
  | { name: 'join'; code: string | null }
  | { name: 'practice' }
  | { name: 'lab' };

export type RouteName = Route['name'];

export interface Flags {
  /** ?debug: hitboxes, FPS/draw calls, ruler, window.__footy. */
  debug: boolean;
  /** ?seed=N: deterministic RNG seed (unsigned 32-bit), or null. */
  seed: number | null;
  /** ?autoplace: auto-fill a legal draft. */
  autoplace: boolean;
  /** ?shot=N: shot timer seconds (0 = off) until the lobby settings exist (M13). */
  shot: number | null;
  /** ?place=N: placement timer seconds (0 = off). */
  place: number | null;
}

/** Room-code alphabet (PLAN §8.1): no I, O, 0, 1. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** Uppercases and keeps only room-code characters; null if not a full code. */
export function normalizeRoomCode(raw: string): string | null {
  const code = [...raw.toUpperCase()].filter((c) => ROOM_CODE_ALPHABET.includes(c)).join('');
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

/** Parses a location.hash such as "#/join/ABCDE". Unknown paths map to the menu. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  const [head, arg] = parts;
  switch (head) {
    case undefined:
      return { name: 'menu' };
    case 'hotseat':
      return { name: 'hotseat' };
    case 'host':
      return { name: 'host' };
    case 'join': {
      let decoded = arg ?? '';
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* keep raw */
      }
      return { name: 'join', code: arg ? normalizeRoomCode(decoded) : null };
    }
    case 'practice':
      return { name: 'practice' };
    case 'lab':
      return { name: 'lab' };
    default:
      return { name: 'menu' };
  }
}

export function routeToHash(route: Route): string {
  if (route.name === 'menu') return '#/';
  if (route.name === 'join') return route.code ? `#/join/${route.code}` : '#/join';
  return `#/${route.name}`;
}

function truthy(v: string | null): boolean {
  return v !== null && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Reads flags from the query string. Flags may sit before the hash
 * (`/?debug#/lab`, the documented form) or after it (`#/lab?debug`).
 */
export function parseFlags(search: string, hash = ''): Flags {
  const params = new URLSearchParams(search);
  const hq = hash.indexOf('?');
  if (hq >= 0) {
    for (const [k, v] of new URLSearchParams(hash.slice(hq + 1))) {
      if (!params.has(k)) params.set(k, v);
    }
  }
  const seedRaw = params.get('seed');
  const seedNum = seedRaw === null || seedRaw === '' ? NaN : Number(seedRaw);
  return {
    debug: params.has('debug') && truthy(params.get('debug')),
    seed: Number.isFinite(seedNum) ? Math.trunc(seedNum) >>> 0 : null,
    autoplace: params.has('autoplace') && truthy(params.get('autoplace')),
    shot: num(params.get('shot')),
    place: num(params.get('place')),
  };
}

function num(raw: string | null): number | null {
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Match-setting overrides from the query flags (sanitized later by `sanitizeSettings`). */
export function flagSettings(f: Pick<Flags, 'shot' | 'place'>): { shotTimerSec?: number; placementTimerSec?: number } {
  return {
    ...(f.shot !== null ? { shotTimerSec: f.shot } : {}),
    ...(f.place !== null ? { placementTimerSec: f.place } : {}),
  };
}

let cachedFlags: Flags | null = null;

/** Flags for this page load (parsed on first call, then frozen). */
export function getFlags(): Flags {
  if (!cachedFlags) cachedFlags = Object.freeze(parseFlags(window.location.search, window.location.hash));
  return cachedFlags;
}

/**
 * Calls onRoute for the current hash and on every change. Unknown paths are
 * rewritten to "#/" without adding a history entry. Returns a stop function.
 */
export function startRouter(onRoute: (route: Route) => void): () => void {
  const handle = (): void => {
    const route = parseRoute(window.location.hash);
    if (route.name === 'menu' && !/^#?\/?(\?.*)?$/.test(window.location.hash)) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
    }
    onRoute(route);
  };
  window.addEventListener('hashchange', handle);
  handle();
  return () => window.removeEventListener('hashchange', handle);
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route);
}
