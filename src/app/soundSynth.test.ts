import { describe, expect, it } from 'vitest';
import {
  barSound,
  bounceSound,
  catchSound,
  crowdBed,
  groanSound,
  kickSound,
  netSound,
  postSound,
  renderSound,
  roarSound,
  thudSound,
  whistleFullTime,
  whistleHalfTime,
  whistleKickoff,
  type SoundName,
} from './soundSynth';

const RATE = 22050; // lower than the real rate: same code, faster tests
const NAMES: SoundName[] = ['kick', 'bounce', 'thud', 'post', 'bar', 'net', 'catch', 'roar', 'groan', 'crowd', 'whistle1', 'whistle2', 'whistle3'];

function peak(x: Float32Array): number {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m;
}
function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

describe('procedural sounds (M14.1)', () => {
  it.each(NAMES)('%s is finite, audible, within [-1, 1] and deterministic', (name) => {
    const a = renderSound(name, RATE);
    const b = renderSound(name, RATE);
    expect(a.length).toBeGreaterThan(RATE * 0.1);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(peak(a)).toBeGreaterThan(0.2);
    expect(peak(a)).toBeLessThanOrEqual(1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('impacts are short and end silent (no click at the end)', () => {
    for (const x of [kickSound(RATE), bounceSound(RATE), thudSound(RATE), postSound(RATE), barSound(RATE), netSound(RATE), catchSound(RATE)]) {
      expect(x.length / RATE).toBeLessThan(1.5);
      expect(Math.abs(x[x.length - 1]!)).toBeLessThan(0.01);
    }
  });

  it('a kick is loudest at the start and dies away', () => {
    const k = kickSound(RATE);
    expect(rms(k, 0, Math.round(RATE * 0.05))).toBeGreaterThan(rms(k, Math.round(RATE * 0.15)) * 3);
  });

  it('the bar rings longer than the post', () => {
    expect(barSound(RATE).length).toBeGreaterThan(postSound(RATE).length);
  });

  it('whistles last longer with more blasts, and are silent in the gaps', () => {
    const w1 = whistleKickoff(RATE);
    const w2 = whistleHalfTime(RATE);
    const w3 = whistleFullTime(RATE);
    expect(w1.length).toBeLessThan(w2.length);
    expect(w2.length).toBeLessThan(w3.length);
    // Half-time: blasts at 0.02–0.44 and 0.62–1.04, so ~0.53 s is the gap.
    expect(rms(w2, Math.round(0.5 * RATE), Math.round(0.58 * RATE))).toBeLessThan(0.001);
    expect(rms(w2, Math.round(0.1 * RATE), Math.round(0.3 * RATE))).toBeGreaterThan(0.1);
  });

  it('the whistle sits in the 2–4 kHz band (zero-crossing rate)', () => {
    const w = whistleKickoff(RATE);
    const a = Math.round(0.1 * RATE);
    const b = Math.round(0.4 * RATE);
    let cross = 0;
    for (let i = a + 1; i < b; i++) if (w[i - 1]! < 0 !== w[i]! < 0) cross++;
    const hz = cross / 2 / ((b - a) / RATE);
    expect(hz).toBeGreaterThan(2000);
    expect(hz).toBeLessThan(4500);
  });

  it('the crowd bed loops without a seam', () => {
    const c = crowdBed(RATE, 3);
    const typical = rms(c);
    // First and last samples are neighbours in the underlying noise: the jump is an ordinary step.
    expect(Math.abs(c[0]! - c[c.length - 1]!)).toBeLessThan(typical * 3);
    expect(c.length).toBe(3 * RATE);
  });

  it('the roar swells then fades; the groan falls away', () => {
    const r = roarSound(RATE);
    expect(rms(r, Math.round(0.4 * RATE), Math.round(0.9 * RATE))).toBeGreaterThan(rms(r, Math.round(3.5 * RATE), Math.round(4.5 * RATE)) * 2);
    expect(rms(r, 0, Math.round(0.05 * RATE))).toBeLessThan(rms(r, Math.round(0.5 * RATE), Math.round(0.8 * RATE)));
    const g = groanSound(RATE);
    expect(rms(g, Math.round(0.2 * RATE), Math.round(0.5 * RATE))).toBeGreaterThan(rms(g, Math.round(1.3 * RATE), Math.round(1.7 * RATE)));
  });
});
