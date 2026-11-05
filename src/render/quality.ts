// Quality levels (PLAN §12 M16.3). "high" is the full look; "low" (performance
// mode) trades pixels for frame rate: lower pixel ratio, a smaller shadow map,
// no multisampling and a thinner crowd. Nothing here touches Three.js, so the
// choice and the frame watchdog are unit-tested in Node.
//
// The level is picked once at boot (`detectQuality`: ?perf flag, else the device)
// and can drop from high to low during a session when the frame rate stays low
// (`FrameWatchdog`). It never goes back up on its own, and nothing is saved.

export type QualityLevel = 'high' | 'low';

export interface QualityProfile {
  level: QualityLevel;
  /** Highest device pixel ratio rendered. */
  maxDpr: number;
  /** Sun shadow map size (square). */
  shadowMapSize: number;
  /** Share of seats filled in the stands, 0–1. */
  crowdDensity: number;
  /** Multisample antialiasing (only chosen when the renderer is created). */
  antialias: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  high: { level: 'high', maxDpr: 2, shadowMapSize: 4096, crowdDensity: 1, antialias: true },
  low: { level: 'low', maxDpr: 1.25, shadowMapSize: 1024, crowdDensity: 0.4, antialias: false },
};

export function profileFor(level: QualityLevel): QualityProfile {
  return QUALITY_PROFILES[level];
}

/** What the browser says about the device (all optional: Safari and Firefox hide several). */
export interface DeviceInfo {
  /** `(pointer: coarse)`: a touch-first device, i.e. a phone or tablet. */
  coarse: boolean;
  /** `navigator.deviceMemory`, GB (Chrome only, capped at 8). */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** `navigator.connection.saveData`: the user asked for a lighter page. */
  saveData?: boolean;
}

/** `?perf=low|high` → the level; anything else (or `auto`) → null. */
export function parsePerfFlag(raw: string | null): QualityLevel | null {
  const v = raw?.trim().toLowerCase();
  return v === 'low' || v === 'high' ? v : null;
}

/** The starting level: the flag wins, then phones/tablets and weak or data-saving devices get "low". */
export function detectQuality(dev: DeviceInfo, flag: QualityLevel | null = null): QualityLevel {
  if (flag) return flag;
  if (dev.coarse || dev.saveData) return 'low';
  if (dev.deviceMemory !== undefined && dev.deviceMemory <= 2) return 'low';
  if (dev.cores !== undefined && dev.cores <= 2) return 'low';
  return 'high';
}

/** Reads the device from the browser (guarded: every field may be missing or throw). */
export function readDevice(): DeviceInfo {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  let coarse = false;
  try {
    coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    /* no matchMedia */
  }
  return { coarse, deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency, saveData: nav.connection?.saveData };
}

// ---------------------------------------------------------------------------
// Frame watchdog: asks for "low" when the game cannot keep up.
// ---------------------------------------------------------------------------

export const WATCHDOG = {
  /** Frames during the first seconds (shaders compiling, assets decoding) are ignored, s. */
  warmup: 4,
  /** Each judged window lasts this long, s. */
  window: 2,
  /** A window is "slow" when its average frame time exceeds this, s (below ~30 fps). */
  slowFrame: 1 / 30,
  /** This many slow windows in a row trigger the downgrade. */
  slowWindows: 2,
  /** A single frame longer than this (a hidden tab, a debugger pause) is not counted, s. */
  maxFrame: 0.5,
} as const;

export class FrameWatchdog {
  private elapsed = 0;
  private acc = 0;
  private frames = 0;
  private slow = 0;
  private fired = false;

  /** Feed the real (unclamped) time of every rendered frame; true once when the level should drop. */
  push(dt: number): boolean {
    if (this.fired || !(dt > 0) || dt > WATCHDOG.maxFrame) return false;
    this.elapsed += dt;
    if (this.elapsed <= WATCHDOG.warmup) return false;
    this.acc += dt;
    this.frames++;
    if (this.acc < WATCHDOG.window) return false;
    const slowWindow = this.acc / this.frames > WATCHDOG.slowFrame;
    this.acc = 0;
    this.frames = 0;
    this.slow = slowWindow ? this.slow + 1 : 0;
    if (this.slow >= WATCHDOG.slowWindows) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
