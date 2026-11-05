// Pure shot-timer model (PLAN §2.4.4, §8.4, M8.3). It runs only while the
// kicker is aiming (started when the aim view is ready, stopped on a kick);
// at 0 it fires once and the view auto-kicks with the current direction and
// sliders. `seconds` = 0 means the timer is off.

/** Under this many seconds the ring turns red (§9). */
export const SHOT_TIMER_WARN = 5;

export interface ShotTimer {
  readonly seconds: number;
  readonly running: boolean;
  /** Seconds left (the full time when idle). */
  readonly remaining: number;
  /** 1 = full, 0 = empty. */
  readonly fraction: number;
  readonly warn: boolean;
  /** Starts (or restarts) the countdown. No-op when the timer is off. */
  start(): void;
  stop(): void;
  /** Advances by dt seconds; returns true exactly once, when it reaches 0. */
  update(dt: number): boolean;
}

export function createShotTimer(seconds: number): ShotTimer {
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  let running = false;
  let remaining = total;
  return {
    seconds: total,
    get running() {
      return running;
    },
    get remaining() {
      return remaining;
    },
    get fraction() {
      return total > 0 ? remaining / total : 0;
    },
    get warn() {
      return running && remaining < SHOT_TIMER_WARN;
    },
    start() {
      remaining = total;
      running = total > 0;
    },
    stop() {
      running = false;
    },
    update(dt) {
      if (!running || !(dt > 0)) return false;
      remaining = Math.max(0, remaining - dt);
      if (remaining > 0) return false;
      running = false;
      return true;
    },
  };
}
