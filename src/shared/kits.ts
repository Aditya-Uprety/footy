// PURE. Kit pairs (PLAN §2.1.3, M13.4). A match's `Settings.kitPair` is an
// index into KIT_PAIRS; both devices read the same settings, so both draw the
// same colors. Pairs differ in lightness as well as hue, so they stay apart
// for the common kinds of color blindness.
//
// The "active" pair is a tiny piece of module state that the renderer, the
// maps and the HUD text read. The match view sets it from the match settings
// and resets it to the default when it is disposed.

export type KitTeam = 0 | 1;

export interface TeamKit {
  /** Name used in match texts ("Red #7 on the ball"). */
  name: string;
  /** Outfield shirt, 0xRRGGBB. */
  outfield: number;
  /** Goalkeeper shirt, 0xRRGGBB. */
  gk: number;
}

export interface KitPair {
  id: string;
  /** Label in the settings panel. */
  label: string;
  teams: readonly [TeamKit, TeamKit];
}

export const KIT_PAIRS: readonly KitPair[] = Object.freeze([
  {
    id: 'classic',
    label: 'Red · Blue',
    teams: [
      { name: 'Red', outfield: 0xd8352f, gk: 0xf0cf2a },
      { name: 'Blue', outfield: 0x2c63d6, gk: 0x34b35a },
    ],
  },
  {
    id: 'orange-blue',
    label: 'Orange · Navy',
    teams: [
      { name: 'Orange', outfield: 0xe8891a, gk: 0xcc79a7 },
      { name: 'Navy', outfield: 0x1f4e9c, gk: 0xf0e442 },
    ],
  },
  {
    id: 'yellow-purple',
    label: 'Yellow · Purple',
    teams: [
      { name: 'Yellow', outfield: 0xf0e442, gk: 0x1fb8c9 },
      { name: 'Purple', outfield: 0x6f3fb0, gk: 0xf08a24 },
    ],
  },
  {
    id: 'white-teal',
    label: 'White · Teal',
    teams: [
      { name: 'White', outfield: 0xf2f2f2, gk: 0xe8801f },
      { name: 'Teal', outfield: 0x0f8f87, gk: 0xf0cf2a },
    ],
  },
]);

export const DEFAULT_KIT_PAIR = 0;

/** A valid kit-pair index from anything (out-of-range or odd values → default). */
export function sanitizeKitPair(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < KIT_PAIRS.length ? v : DEFAULT_KIT_PAIR;
}

let active = DEFAULT_KIT_PAIR;

/** Makes this pair the one every kit lookup returns (sanitized). */
export function setActiveKitPair(index: number): void {
  active = sanitizeKitPair(index);
}

export function activeKitPair(): number {
  return active;
}

/** The active kit of one team. */
export function kitOf(team: KitTeam): TeamKit {
  return KIT_PAIRS[active]!.teams[team];
}

/** "#rrggbb" for a 0xRRGGBB number. */
export function hexString(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
