// Applies a kit pair everywhere at once (M13.4): the shared "active kit" that
// the renderer, maps and match texts read, plus the CSS variables
// `--team-0` / `--team-1` that style the DOM (scoreboard, banners, rings).
import { hexString, KIT_PAIRS, sanitizeKitPair, setActiveKitPair } from '../shared/kits';

/** Makes `index` the active kit pair (sanitized) and returns the index in use. */
export function applyKitTheme(index: unknown): number {
  const i = sanitizeKitPair(index);
  setActiveKitPair(i);
  if (typeof document !== 'undefined') {
    const root = document.documentElement.style;
    const [a, b] = KIT_PAIRS[i]!.teams;
    root.setProperty('--team-0', hexString(a.outfield));
    root.setProperty('--team-1', hexString(b.outfield));
  }
  return i;
}

/** Back to the default kits (leaving a match). */
export function resetKitTheme(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.removeProperty('--team-0');
    document.documentElement.style.removeProperty('--team-1');
  }
  setActiveKitPair(0);
}
