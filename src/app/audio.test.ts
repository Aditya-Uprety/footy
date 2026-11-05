import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioManager, unlockAudioOnGesture } from './audio';

/** Just enough of the Web Audio API to see what the manager does. */
function installFakeAudio() {
  const created = { contexts: 0, sources: [] as { rate: number; gain: number; loop: boolean; started: boolean }[] };
  class Param {
    value = 0;
    cancelScheduledValues() {}
    setTargetAtTime(v: number) {
      this.value = v;
    }
  }
  class Node {
    connect(n: unknown) {
      return n;
    }
    disconnect() {}
  }
  class Gain extends Node {
    gain = new Param();
  }
  class Source extends Node {
    buffer: unknown = null;
    loop = false;
    playbackRate = new Param();
    onended: (() => void) | null = null;
    private rec = { rate: 1, gain: 0, loop: false, started: false };
    constructor() {
      super();
      created.sources.push(this.rec);
    }
    start() {
      this.rec.started = true;
      this.rec.rate = this.playbackRate.value;
      this.rec.loop = this.loop;
    }
    stop() {}
  }
  class Ctx {
    state: 'suspended' | 'running' | 'closed' = 'suspended';
    currentTime = 0;
    sampleRate = 8000;
    destination = new Node();
    constructor() {
      created.contexts++;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    createGain() {
      return new Gain();
    }
    createDynamicsCompressor() {
      return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
    }
    createBufferSource() {
      return new Source();
    }
    createBuffer(_c: number, len: number) {
      return { length: len, copyToChannel() {} };
    }
  }
  const listeners = new Map<string, (() => void)[]>();
  const win = {
    AudioContext: Ctx,
    addEventListener: (e: string, f: () => void) => listeners.set(e, [...(listeners.get(e) ?? []), f]),
    removeEventListener: (e: string, f: () => void) => listeners.set(e, (listeners.get(e) ?? []).filter((g) => g !== f)),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  return { created, win, listeners };
}

describe('audio manager (M14.1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('without Web Audio (Node / old browsers)', () => {
    it('is locked, every call is a silent no-op, and unlock marks it unsupported', () => {
      const a = createAudioManager();
      expect(a.state).toBe('locked');
      expect(() => {
        a.play('kick');
        a.playEvent({ kind: 'goal', t: 1, goalOf: 0 });
        a.whistle('full');
        a.setAmbience(true);
        a.setVolume(0.5);
        a.setMuted(true);
      }).not.toThrow();
      expect(a.log).toEqual([]);
      a.unlock();
      expect(a.state).toBe('unsupported');
    });
  });

  describe('with a fake AudioContext', () => {
    let fake: ReturnType<typeof installFakeAudio>;
    beforeEach(() => {
      fake = installFakeAudio();
    });

    it('creates no context before unlock, so nothing can warn before the first click', () => {
      const a = createAudioManager();
      a.playEvent({ kind: 'kick', t: 0, speed: 20 });
      a.setAmbience(true);
      expect(fake.created.contexts).toBe(0);
      expect(a.log).toEqual([]);
    });

    it('plays event sounds after unlock and logs them', async () => {
      const a = createAudioManager();
      a.unlock();
      await Promise.resolve();
      expect(a.state).toBe('running');
      a.playEvent({ kind: 'kick', t: 0, speed: 32 });
      a.playEvent({ kind: 'post', t: 1, x: 0, y: 1, z: 0, speed: 12 });
      expect(a.log.map((l) => l.sound)).toEqual(['kick', 'post', 'groan']);
      a.whistle('half');
      expect(a.log.at(-1)!.sound).toBe('whistle2');
    });

    it('drops the same sound played twice within its minimum gap', async () => {
      const a = createAudioManager();
      a.unlock();
      await Promise.resolve();
      a.play('bounce');
      a.play('bounce');
      expect(a.log.filter((l) => l.sound === 'bounce')).toHaveLength(1);
    });

    it('starts the looping crowd bed when asked, and only once', async () => {
      const a = createAudioManager();
      a.setAmbience(true); // before unlock: remembered
      a.unlock();
      await Promise.resolve();
      await Promise.resolve();
      a.setAmbience(true);
      const beds = fake.created.sources.filter((s) => s.loop);
      expect(beds).toHaveLength(1);
      expect(beds[0]!.started).toBe(true);
      a.setAmbience(false);
    });

    it('clamps and stores volume and mute', () => {
      const a = createAudioManager();
      a.setVolume(2);
      expect(a.volume).toBe(1);
      a.setVolume(-1);
      expect(a.volume).toBe(0);
      a.setVolume(Number.NaN);
      expect(a.volume).toBe(0);
      a.setMuted(true);
      expect(a.muted).toBe(true);
    });

    it('unlockAudioOnGesture registers and removes its listeners', () => {
      // Listener bookkeeping only (the shared instance does the unlocking).
      const off = unlockAudioOnGesture(fake.win as unknown as Window);
      expect(fake.listeners.get('pointerdown')).toHaveLength(1);
      expect(fake.listeners.get('keydown')).toHaveLength(1);
      off();
      expect(fake.listeners.get('pointerdown')).toHaveLength(0);
    });
  });
});
