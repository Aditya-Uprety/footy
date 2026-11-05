// Kick side bar rules (M5.2): ranges, steps, restart caps, curve detent and
// the slider → physics input mapping.
import { describe, expect, it } from 'vitest';
import { PHYS } from '../sim/constants';
import { capKickInput } from '../sim/kick';
import {
  clampSliders,
  curveDetent,
  DEFAULT_SLIDERS,
  formatSlider,
  LOFT_MAX_DEG,
  powerCap,
  sliderFraction,
  snap,
  stepSlider,
  toKickInput,
} from './kickPanel';

describe('kick sliders', () => {
  it('loft runs 0–55° (LOFT_MAX)', () => {
    expect(LOFT_MAX_DEG).toBe(55);
    expect(clampSliders({ power: 50, curve: 0, loft: 90 }).loft).toBe(55);
  });

  it('snaps to the §6.2 steps: power 1 %, curve 1 %, loft 0.5°', () => {
    expect(snap('power', 47.4)).toBe(47);
    expect(snap('curve', -12.6)).toBe(-13);
    expect(snap('loft', 12.3)).toBe(12.5);
    expect(snap('loft', 12.2)).toBe(12);
    expect(Object.is(snap('curve', -0.2), -0)).toBe(false);
  });

  it('throw-in caps: power ≤ 45 %, curve locked at 0', () => {
    expect(powerCap({ throwIn: true })).toBe(45);
    expect(powerCap({})).toBe(100);
    const v = clampSliders({ power: 90, curve: -60, loft: 20 }, { throwIn: true });
    expect(v).toEqual({ power: 45, curve: 0, loft: 20 });
    // Stepping can't push past the cap or move the curve.
    expect(stepSlider(v, 'power', 10, { throwIn: true }).value.power).toBe(45);
    expect(stepSlider(v, 'curve', 10, { throwIn: true }).value.curve).toBe(0);
  });

  it('the panel input matches what the sim applies after capKickInput', () => {
    const v = { power: 80, curve: 35, loft: 27.5 };
    for (const caps of [{}, { throwIn: true }]) {
      const inp = toKickInput(v, 1.25, caps);
      expect(capKickInput(inp, caps)).toEqual(inp);
    }
    const inp = toKickInput(v, 1.25);
    expect(inp).toEqual({ yaw: 1.25, power: 0.8, curve: 0.35, loft: 27.5 / 55 });
    expect(toKickInput({ power: 50, curve: 0, loft: LOFT_MAX_DEG }, 0).loft).toBe(1);
  });

  it('curve detent: drags near 0 snap to 0; keys stop at 0 when crossing', () => {
    expect(curveDetent(3)).toBe(0);
    expect(curveDetent(-4)).toBe(0);
    expect(curveDetent(5)).toBe(5);
    const r = stepSlider({ ...DEFAULT_SLIDERS, curve: 2 }, 'curve', -5);
    expect(r.value.curve).toBe(0);
    expect(r.detent).toBe(true);
    const r2 = stepSlider({ ...DEFAULT_SLIDERS, curve: 0 }, 'curve', -5);
    expect(r2.value.curve).toBe(-5);
    expect(r2.detent).toBe(false);
  });

  it('fractions and labels', () => {
    expect(sliderFraction('curve', 0)).toBe(0.5);
    expect(sliderFraction('power', 100)).toBe(1);
    expect(sliderFraction('height', 1.7)).toBe(0);
    expect(formatSlider('curve', 25)).toBe('R 25');
    expect(formatSlider('curve', -100)).toBe('L 100');
    expect(formatSlider('loft', 12.5)).toBe('12.5°');
  });

  it('default sliders give the acceptance kick (power 50, curve 0, loft 0)', () => {
    expect(toKickInput(DEFAULT_SLIDERS, 0)).toEqual({ yaw: 0, power: 0.5, curve: 0, loft: 0 });
    expect(PHYS.THROW_POWER_CAP).toBe(0.45);
  });
});
