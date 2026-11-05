import { describe, expect, it } from 'vitest';
import { detectQuality, FrameWatchdog, parsePerfFlag, profileFor, WATCHDOG } from './quality';

const desktop = { coarse: false, deviceMemory: 8, cores: 8 };

describe('detectQuality', () => {
  it('gives a normal desktop the full look', () => {
    expect(detectQuality(desktop)).toBe('high');
    expect(detectQuality({ coarse: false })).toBe('high'); // Safari/Firefox hide the details
  });
  it('gives phones, tablets, weak and data-saving devices performance mode', () => {
    expect(detectQuality({ ...desktop, coarse: true })).toBe('low');
    expect(detectQuality({ ...desktop, deviceMemory: 2 })).toBe('low');
    expect(detectQuality({ ...desktop, cores: 2 })).toBe('low');
    expect(detectQuality({ ...desktop, saveData: true })).toBe('low');
    expect(detectQuality({ ...desktop, cores: 4, deviceMemory: 4 })).toBe('high');
  });
  it('lets ?perf override the device either way', () => {
    expect(detectQuality({ ...desktop, coarse: true }, 'high')).toBe('high');
    expect(detectQuality(desktop, 'low')).toBe('low');
  });
  it('parses the flag', () => {
    expect(parsePerfFlag('low')).toBe('low');
    expect(parsePerfFlag('HIGH')).toBe('high');
    expect(parsePerfFlag('auto')).toBeNull();
    expect(parsePerfFlag(null)).toBeNull();
  });
});

describe('profiles', () => {
  it('low is cheaper than high on every knob', () => {
    const hi = profileFor('high');
    const lo = profileFor('low');
    expect(lo.maxDpr).toBeLessThan(hi.maxDpr);
    expect(lo.shadowMapSize).toBeLessThan(hi.shadowMapSize);
    expect(lo.crowdDensity).toBeLessThan(hi.crowdDensity);
    expect(lo.antialias).toBe(false);
    expect(hi.antialias).toBe(true);
  });
});

function run(wd: FrameWatchdog, seconds: number, frame: number): boolean {
  let fired = false;
  for (let t = 0; t < seconds; t += frame) fired = wd.push(frame) || fired;
  return fired;
}

describe('FrameWatchdog', () => {
  it('stays quiet at 60 fps', () => {
    expect(run(new FrameWatchdog(), 60, 1 / 60)).toBe(false);
  });
  it('ignores a slow warm-up', () => {
    const wd = new FrameWatchdog();
    expect(run(wd, WATCHDOG.warmup, 0.1)).toBe(false);
    expect(run(wd, 20, 1 / 60)).toBe(false);
  });
  it('fires once after sustained low frame rate', () => {
    const wd = new FrameWatchdog();
    expect(run(wd, WATCHDOG.warmup + 1, 1 / 15)).toBe(false);
    let fires = 0;
    for (let i = 0; i < 400; i++) if (wd.push(1 / 15)) fires++;
    expect(fires).toBe(1);
  });
  it('does not fire on one slow window between good ones', () => {
    const wd = new FrameWatchdog();
    run(wd, WATCHDOG.warmup + 0.5, 1 / 60);
    for (let i = 0; i < 5; i++) {
      expect(run(wd, WATCHDOG.window, 1 / 15)).toBe(false);
      expect(run(wd, WATCHDOG.window, 1 / 60)).toBe(false);
    }
  });
  it('does not count a hidden tab or a pause', () => {
    const wd = new FrameWatchdog();
    run(wd, WATCHDOG.warmup + 0.5, 1 / 60);
    for (let i = 0; i < 50; i++) expect(wd.push(3)).toBe(false);
    expect(run(wd, 10, 1 / 60)).toBe(false);
  });
});
