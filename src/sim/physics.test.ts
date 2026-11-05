// Ball-flight physics on an empty plane (PLAN M2.5, §5.10).
import { describe, expect, it } from 'vitest';
import { kickStats, lateralAt } from './analyze';
import { PHYS } from './constants';
import { initialBallState, kickDirection, kickRight, kickoffSpot } from './kick';
import { simulateKick } from './simulate';
import { newStepInfo, step } from './step';
import type { KickInput, KickOrigin, KickResult } from './types';

const DEG = Math.PI / 180;
const center: KickOrigin = { kind: 'ghost', ...kickoffSpot() };

function kick(power: number, loftDeg: number, curve = 0, yaw = 0, origin: KickOrigin = center): KickResult {
  const loft = (loftDeg * DEG) / PHYS.LOFT_MAX;
  return simulateKick({ input: { yaw, power, curve, loft }, origin, team: 0 });
}

/** Offset of the final position from the start, split along d̂ and r̂. */
function endOffset(r: KickResult): { along: number; lateral: number } {
  if (r.outcome.kind !== 'stop') throw new Error('expected a stop');
  const d = kickDirection(r.input.yaw);
  const rt = kickRight(r.input.yaw);
  const dx = r.outcome.x - r.start.x;
  const dz = r.outcome.z - r.start.z;
  return { along: dx * d.x + dz * d.z, lateral: dx * rt.x + dz * rt.z };
}

describe('determinism (§5.11)', () => {
  it('two runs of the same kick give identical frames, events and outcome', () => {
    const input: KickInput = { yaw: 1.234, power: 0.83, curve: -0.61, loft: 0.37 };
    const origin: KickOrigin = { kind: 'player', playerId: 4, team: 1, x: -12.5, z: 7.25, gk: false };
    const a = simulateKick({ input, origin, team: 1 });
    const b = simulateKick({ input: { ...input }, origin: { ...origin }, team: 1 });
    expect(Buffer.from(a.frames.buffer).equals(Buffer.from(b.frames.buffer))).toBe(true);
    expect(a.events).toEqual(b.events);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.duration).toBe(b.duration);
  });
});

describe('direction and curve', () => {
  const yaws = [0, 0.7, 2.4, -1.9, Math.PI];

  it('a no-curve kick stays on its line (lateral < 1e-9)', () => {
    for (const yaw of yaws) {
      for (const [power, loft] of [
        [1, 0],
        [0.6, 20],
        [1, 55],
      ] as const) {
        const r = kick(power, loft, 0, yaw);
        expect(Math.abs(endOffset(r).lateral)).toBeLessThan(1e-9);
        const rt = kickRight(yaw);
        for (const e of r.events) {
          if (e.kind !== 'ground') continue;
          const lat = (e.x - r.start.x) * rt.x + (e.z - r.start.z) * rt.z;
          expect(Math.abs(lat)).toBeLessThan(1e-9);
        }
        expect(endOffset(r).along).toBeGreaterThan(10);
      }
    }
  });

  it('curve > 0 goes right of d̂, curve < 0 left, mirror-symmetric', () => {
    for (const yaw of yaws) {
      for (const loft of [0, 12]) {
        const right = endOffset(kick(0.7, loft, 1, yaw)).lateral;
        const left = endOffset(kick(0.7, loft, -1, yaw)).lateral;
        expect(right).toBeGreaterThan(1);
        expect(left).toBeLessThan(-1);
        expect(right + left).toBeCloseTo(0, 6);
      }
    }
  });

  it('more curve bends more', () => {
    const lat = [0.25, 0.5, 1].map((c) => lateralAt(kick(0.75, 10, c), 25)!);
    expect(lat[0]!).toBeGreaterThan(0);
    expect(lat[1]!).toBeGreaterThan(lat[0]!);
    expect(lat[2]!).toBeGreaterThan(lat[1]!);
  });
});

describe('loft, spin and stopping', () => {
  it('higher loft gives a higher apex', () => {
    for (const power of [0.3, 0.7, 1]) {
      const apex = [0, 10, 20, 35, 55].map((l) => kickStats(kick(power, l)).apex);
      expect(apex[0]).toBeCloseTo(PHYS.BALL_R, 12);
      for (let i = 1; i < apex.length; i++) expect(apex[i]!).toBeGreaterThan(apex[i - 1]!);
    }
  });

  it('spin decays (exponentially in the air, faster on the ground) and never grows', () => {
    const b = initialBallState({ yaw: 0, power: 1, curve: 1, loft: 0.6 }, center);
    const info = newStepInfo();
    let prev = Math.abs(b.w.y);
    let t = 0;
    let airSteps = 0;
    while (!b.rolling && !info.stopped) {
      step(b, PHYS, info);
      t += PHYS.DT;
      const w = Math.abs(b.w.y);
      expect(w).toBeLessThan(prev);
      prev = w;
      if (info.ground === 0) airSteps++;
      else break;
    }
    // First flight: ω(t) = ω0·(1 − DT/τ)^n ≈ ω0·e^(−t/τ), n = air steps + the landing
    // step (which decays first, then keeps SPIN_KEEP_GROUND on the bounce).
    expect(airSteps).toBeGreaterThan(100);
    const expected = PHYS.W_MAX * (1 - PHYS.DT / PHYS.TAU_AIR) ** (airSteps + 1);
    expect(Math.abs(b.w.y) / PHYS.SPIN_KEEP_GROUND).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(PHYS.W_MAX * Math.exp(-t / PHYS.TAU_AIR), 1);
    // Later bounces keep decaying it; once rolling it decays with TAU_GROUND each step.
    let rollingSteps = 0;
    while (!info.stopped) {
      const wasRolling = b.rolling;
      step(b, PHYS, info);
      const w = Math.abs(b.w.y);
      expect(w).toBeLessThanOrEqual(prev);
      if (wasRolling) {
        expect(w).toBeCloseTo(prev * (1 - PHYS.DT / PHYS.TAU_GROUND), 12);
        rollingSteps++;
      }
      prev = w;
    }
    expect(rollingSteps).toBeGreaterThan(50);
    expect(prev).toBeLessThan(0.05 * PHYS.W_MAX);
  });

  it('every slider extreme stops on its own within 12 s (well before T_MAX)', () => {
    for (const power of [0, 0.5, 1]) {
      for (const curve of [-1, 0, 1]) {
        for (const loft of [0, 0.5, 1]) {
          const r = simulateKick({ input: { yaw: 0.3, power, curve, loft }, origin: center, team: 0 });
          expect(r.outcome.kind).toBe('stop');
          expect(r.duration).toBeLessThan(12);
          expect(r.duration).toBeLessThan(PHYS.T_MAX);
        }
      }
    }
  });

  it('a throw-in from 1.8 m with no loft falls, bounces and stops', () => {
    const origin: KickOrigin = { kind: 'ghost', x: 0, y: PHYS.THROW_HEIGHT, z: 0 };
    const r = simulateKick({ input: { yaw: 0, power: 1, curve: 1, loft: 0 }, origin, team: 0, caps: { throwIn: true } });
    expect(r.events[1]!.kind).toBe('ground');
    expect(r.outcome.kind).toBe('stop');
    expect(endOffset(r).lateral).toBe(0); // curve locked
  });

  it('T_MAX ends a never-stopping ball as a stop at its current spot', () => {
    const c = { ...PHYS, MU_ROLL: 0, K_D: 0, T_MAX: 2 };
    const r = simulateKick({ input: { yaw: 0, power: 0, curve: 0, loft: 0 }, origin: center, team: 0, consts: c });
    expect(r.duration).toBeCloseTo(2, 9);
    expect(r.outcome).toMatchObject({ kind: 'stop', x: expect.closeTo(6, 6), z: 0 });
  });
});

describe('§5.10 tuning targets', () => {
  it('power 25 %, loft 0° (pass): rolls 25–34 m', () => {
    const s = kickStats(kick(0.25, 0));
    expect(s.carry).toBe(0);
    expect(s.total).toBeGreaterThanOrEqual(25);
    expect(s.total).toBeLessThanOrEqual(34);
  });

  it('power 50 %, loft 0°: rolls 48–63 m', () => {
    const s = kickStats(kick(0.5, 0));
    expect(s.total).toBeGreaterThanOrEqual(48);
    expect(s.total).toBeLessThanOrEqual(63);
  });

  it('power 100 %, loft 0°: rolls 85–103 m', () => {
    const s = kickStats(kick(1, 0));
    expect(s.total).toBeGreaterThanOrEqual(85);
    expect(s.total).toBeLessThanOrEqual(103);
  });

  it('power 100 %, loft 15°: carry 31–41 m, apex 2.5–3.6 m', () => {
    const s = kickStats(kick(1, 15));
    expect(s.carry).toBeGreaterThanOrEqual(31);
    expect(s.carry).toBeLessThanOrEqual(41);
    expect(s.apex).toBeGreaterThanOrEqual(2.5);
    expect(s.apex).toBeLessThanOrEqual(3.6);
  });

  it('power 100 %, loft 35°: carry 48–58 m, apex 10–14 m', () => {
    const s = kickStats(kick(1, 35));
    expect(s.carry).toBeGreaterThanOrEqual(48);
    expect(s.carry).toBeLessThanOrEqual(58);
    expect(s.apex).toBeGreaterThanOrEqual(10);
    expect(s.apex).toBeLessThanOrEqual(14);
  });

  it('power 30 %, loft 45° (chip): carry 10.5–14 m, apex 2.9–3.8 m', () => {
    const s = kickStats(kick(0.3, 45));
    expect(s.carry).toBeGreaterThanOrEqual(10.5);
    expect(s.carry).toBeLessThanOrEqual(14);
    expect(s.apex).toBeGreaterThanOrEqual(2.9);
    expect(s.apex).toBeLessThanOrEqual(3.8);
  });

  it('power 75 %, curve +100, loft 10°: +3.3…+5.0 m right at 25 m downrange', () => {
    const lat = lateralAt(kick(0.75, 10, 1), 25)!;
    expect(lat).toBeGreaterThanOrEqual(3.3);
    expect(lat).toBeLessThanOrEqual(5.0);
  });

  it('power 40 %, curve +100, loft 0° (ground): +2.0…+3.6 m right at 25 m downrange', () => {
    const lat = lateralAt(kick(0.4, 0, 1), 25)!;
    expect(lat).toBeGreaterThanOrEqual(2.0);
    expect(lat).toBeLessThanOrEqual(3.6);
  });

  it('performance budget (§5.11): 100 hard kicks run fast (< 10 ms each on average)', () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) kick(1, 0, (i % 3) - 1, i * 0.1);
    const msEach = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
    expect(msEach).toBeLessThan(10);
  });
});
