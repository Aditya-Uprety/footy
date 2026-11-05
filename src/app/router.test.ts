import { describe, expect, it } from 'vitest';
import { flagSettings, normalizeRoomCode, parseFlags, parseRoute, routeToHash } from './router';

describe('parseRoute', () => {
  it('maps every PLAN §3.3 route', () => {
    expect(parseRoute('')).toEqual({ name: 'menu' });
    expect(parseRoute('#/')).toEqual({ name: 'menu' });
    expect(parseRoute('#/hotseat')).toEqual({ name: 'hotseat' });
    expect(parseRoute('#/host')).toEqual({ name: 'host' });
    expect(parseRoute('#/join/ABCDE')).toEqual({ name: 'join', code: 'ABCDE' });
    expect(parseRoute('#/join')).toEqual({ name: 'join', code: null });
    expect(parseRoute('#/practice')).toEqual({ name: 'practice' });
    expect(parseRoute('#/howto')).toEqual({ name: 'howto' });
    expect(parseRoute('#/lab')).toEqual({ name: 'lab' });
  });

  it('normalizes join codes and rejects bad ones', () => {
    expect(parseRoute('#/join/ab-cde')).toEqual({ name: 'join', code: 'ABCDE' });
    expect(parseRoute('#/join/ABC')).toEqual({ name: 'join', code: null });
    expect(normalizeRoomCode('O0I1Z')).toBeNull(); // ambiguous characters are not in the alphabet
  });

  it('sends unknown paths to the menu and ignores a hash query', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'menu' });
    expect(parseRoute('#/lab?debug')).toEqual({ name: 'lab' });
  });

  it('round-trips through routeToHash', () => {
    for (const h of ['#/', '#/hotseat', '#/host', '#/join/K7MPQ', '#/practice', '#/howto', '#/lab']) {
      expect(routeToHash(parseRoute(h))).toBe(h);
    }
  });
});

describe('parseFlags', () => {
  it('defaults to all off', () => {
    expect(parseFlags('')).toEqual({ debug: false, seed: null, autoplace: false, shot: null, place: null, touch: false, perf: null });
  });

  it('reads flags before or after the hash', () => {
    expect(parseFlags('?debug&seed=42&autoplace')).toEqual({ debug: true, seed: 42, autoplace: true, shot: null, place: null, touch: false, perf: null });
    expect(parseFlags('?shot=0&place=25')).toMatchObject({ shot: 0, place: 25 });
    expect(flagSettings(parseFlags('?shot=12&place=x'))).toEqual({ shotTimerSec: 12 });
    expect(parseFlags('', '#/lab?debug&seed=7')).toEqual({ debug: true, seed: 7, autoplace: false, shot: null, place: null, touch: false, perf: null });
  });

  it('treats debug=0 / false as off and ignores a non-numeric seed', () => {
    expect(parseFlags('?debug=0&seed=abc').debug).toBe(false);
    expect(parseFlags('?touch').touch).toBe(true);
    expect(parseFlags('?touch=0').touch).toBe(false);
    expect(parseFlags('?perf=low').perf).toBe('low');
    expect(parseFlags('?perf=high').perf).toBe('high');
    expect(parseFlags('?perf=auto').perf).toBeNull();
    expect(parseFlags('?debug=false').debug).toBe(false);
    expect(parseFlags('?seed=abc').seed).toBeNull();
    expect(parseFlags('?seed=-1').seed).toBe(4294967295);
  });
});
