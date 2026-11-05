import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { kick } from './rules';
import { base64ToBytes, base64ToFrames, bytesToBase64, framesToBase64, fromWireKick, jsonClone, toWireKick } from './serialize';
import { draftedMatch } from './testUtil';

describe('base64', () => {
  it('matches Node for every padding case', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect([...base64ToBytes(b64)]).toEqual([...bytes]);
    }
  });

  it('rejects bad input', () => {
    expect(() => base64ToBytes('abc')).toThrow();
    expect(() => base64ToBytes('ab!d')).toThrow();
    expect(() => base64ToBytes('a=bc')).toThrow();
    expect(() => base64ToFrames('AAAAAAA=')).toThrow(); // 5 bytes: not whole float32s
  });
});

describe('frames on the wire', () => {
  it('round-trips a Float32Array exactly (incl. specials)', () => {
    const f = new Float32Array([0, -0, 1.5, -3.25e-7, 123456.789, Number.MAX_VALUE, Infinity, NaN]);
    const back = base64ToFrames(framesToBase64(f));
    expect(back.length).toBe(f.length);
    for (let i = 0; i < f.length; i++) expect(Object.is(back[i], f[i])).toBe(true);
  });

  it('is little-endian (same bytes as Node on x86/ARM)', () => {
    const f = new Float32Array([1, 2, 3, 4]);
    expect(framesToBase64(f)).toBe(Buffer.from(f.buffer).toString('base64'));
  });

  it('a kick result survives JSON + base64 identically', () => {
    const s = draftedMatch(5);
    const { result } = kick(s, 0, { yaw: 0.2, power: 0.7, curve: -0.4, loft: 0.2 });
    const back = fromWireKick(jsonClone(toWireKick(result)));
    expect([...back.frames]).toEqual([...result.frames]);
    expect(back.events).toEqual(result.events);
    expect(back.outcome).toEqual(result.outcome);
    expect(back.duration).toBe(result.duration);
    expect(back.input).toEqual(result.input);
  });

  it('refuses frames that are not whole records', () => {
    const w = toWireKick(kick(draftedMatch(5), 0, { yaw: 0, power: 0.5, curve: 0, loft: 0 }).result);
    expect(() => fromWireKick({ ...w, frames: framesToBase64(new Float32Array(5)) })).toThrow();
  });
});
