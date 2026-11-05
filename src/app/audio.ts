// Audio manager (PLAN §12 M14): WebAudio playback of the procedural sounds in
// app/soundSynth.ts. One shared instance (`audio`) for every mode.
//
//   sources ─> voice gain ─┐
//   crowd bed ─> bed gain ─┴─> master gain (volume / mute) ─> compressor ─> out
//
// Browsers only allow audio after a user gesture, so nothing is created until
// `unlock()` (main.ts calls it on the first pointer/key press). Before that
// every call is a silent no-op: no AudioContext, so no console warnings.
// Sound buffers are rendered lazily the first time they are played.
import { cuesFor, WHISTLE_SOUND, type CuePlay, type WhistleKind } from './audioCues';
import { renderSound, type SoundName } from './soundSynth';
import type { SimEvent } from '../sim/types';

/** Loudness of the crowd bed (0..1 of the master). */
export const BED_LEVEL = 0.2;
/** Max sounds playing at once; further ones are dropped. */
export const MAX_VOICES = 28;
/** Minimum seconds between two plays of the same sound (fast-forward piles bounces up). */
const MIN_GAP: Partial<Record<SoundName, number>> = { bounce: 0.05, thud: 0.05, kick: 0.05, net: 0.08, post: 0.08, bar: 0.08 };
const DEFAULT_GAP = 0.02;

export type AudioState = 'locked' | 'running' | 'suspended' | 'unsupported';

/** One entry of the play log (`audio.log`): handy for checks and tests. */
export interface PlayLogEntry {
  sound: SoundName;
  gain: number;
  rate: number;
  /** Context time, s. */
  at: number;
}

export interface AudioManager {
  readonly state: AudioState;
  /** Master volume 0..1 and mute (M14.2 persists and edits these). */
  readonly volume: number;
  readonly muted: boolean;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  /** Creates/resumes the context; call from a user gesture. Safe to call again. */
  unlock(): void;
  /** Plays a sound now. */
  play(sound: SoundName, opts?: { gain?: number; rate?: number }): void;
  /** Plays what a simulation event sounds like (kick, bounce, post, goal roar, …). */
  playEvent(ev: SimEvent): void;
  /** Referee whistle: one blast (kickoff), two (half-time), three (full-time). */
  whistle(kind: WhistleKind): void;
  /** Crowd murmur on/off (fades). */
  setAmbience(on: boolean): void;
  /** The last plays, oldest first (capped). */
  readonly log: readonly PlayLogEntry[];
  /** Stops everything and forgets the context (tests). */
  reset(): void;
}

const LOG_MAX = 80;

type Ctor = typeof AudioContext;

function contextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createAudioManager(): AudioManager {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bedGain: GainNode | null = null;
  let bedSrc: AudioBufferSourceNode | null = null;
  const buffers = new Map<SoundName, AudioBuffer>();
  const lastPlayed = new Map<SoundName, number>();
  const log: PlayLogEntry[] = [];
  let voices = 0;
  let volume = 0.8;
  let muted = false;
  let wantAmbience = false;
  let unsupported = false;
  let groan: { gain: GainNode } | null = null;

  /** Slider position to gain: squared, so the low end of the slider is usable. */
  const masterGain = (): number => (muted ? 0 : volume * volume);

  function applyMaster(): void {
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.015);
  }

  function bufferFor(sound: SoundName): AudioBuffer | null {
    if (!ctx) return null;
    let b = buffers.get(sound);
    if (!b) {
      const data = renderSound(sound, ctx.sampleRate);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      buffers.set(sound, b);
    }
    return b;
  }

  function syncAmbience(): void {
    if (!ctx || !bedGain) return;
    const now = ctx.currentTime;
    if (wantAmbience) {
      if (!bedSrc) {
        const b = bufferFor('crowd');
        if (!b) return;
        bedSrc = ctx.createBufferSource();
        bedSrc.buffer = b;
        bedSrc.loop = true;
        bedSrc.connect(bedGain);
        bedSrc.start();
      }
      bedGain.gain.cancelScheduledValues(now);
      bedGain.gain.setTargetAtTime(BED_LEVEL, now, 0.6);
    } else if (bedSrc) {
      const src = bedSrc;
      bedSrc = null;
      bedGain.gain.cancelScheduledValues(now);
      bedGain.gain.setTargetAtTime(0, now, 0.25);
      src.stop(now + 1.5);
    }
  }

  function playCue(c: CuePlay): void {
    if (!ctx || !master || ctx.state !== 'running') return;
    if (voices >= MAX_VOICES) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[c.sound] ?? DEFAULT_GAP;
    const last = lastPlayed.get(c.sound);
    if (last !== undefined && now - last < gap) return;
    const buf = bufferFor(c.sound);
    if (!buf) return;
    lastPlayed.set(c.sound, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.rate;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, Math.max(0, c.gain));
    src.connect(g).connect(master);
    voices += 1;
    const isGroan = c.sound === 'groan';
    if (isGroan) groan = { gain: g };
    src.onended = () => {
      voices -= 1;
      src.disconnect();
      g.disconnect();
      if (groan?.gain === g) groan = null;
    };
    src.start();
    log.push({ sound: c.sound, gain: c.gain, rate: c.rate, at: now });
    if (log.length > LOG_MAX) log.shift();
    // A goal cuts a groan short (the ball hit the post and went in).
    if (c.sound === 'roar' && groan) {
      const gg = groan.gain.gain;
      gg.cancelScheduledValues(now);
      gg.setTargetAtTime(0, now, 0.05);
    }
  }

  const onVisibility = (): void => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  };

  const manager: AudioManager = {
    get state(): AudioState {
      if (unsupported) return 'unsupported';
      if (!ctx) return 'locked';
      return ctx.state === 'running' ? 'running' : 'suspended';
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    get log() {
      return log;
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : volume));
      applyMaster();
    },
    setMuted(m) {
      muted = m;
      applyMaster();
    },
    unlock() {
      if (unsupported) return;
      if (!ctx) {
        const C = contextCtor();
        if (!C) {
          unsupported = true;
          return;
        }
        try {
          ctx = new C();
        } catch {
          unsupported = true;
          return;
        }
        master = ctx.createGain();
        master.gain.value = masterGain();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.004;
        comp.release.value = 0.2;
        master.connect(comp).connect(ctx.destination);
        bedGain = ctx.createGain();
        bedGain.gain.value = 0;
        bedGain.connect(master);
        document.addEventListener('visibilitychange', onVisibility);
      }
      if (ctx.state !== 'running') {
        void ctx
          .resume()
          .then(syncAmbience)
          .catch(() => {});
      } else {
        syncAmbience();
      }
    },
    play(sound, opts = {}) {
      playCue({ sound, gain: opts.gain ?? 1, rate: opts.rate ?? 1 });
    },
    playEvent(ev) {
      if (!ctx) return;
      for (const c of cuesFor(ev)) playCue(c);
    },
    whistle(kind) {
      playCue({ sound: WHISTLE_SOUND[kind], gain: 0.8, rate: 1 });
    },
    setAmbience(on) {
      wantAmbience = on;
      syncAmbience();
    },
    reset() {
      try {
        bedSrc?.stop();
      } catch {
        /* already stopped */
      }
      bedSrc = null;
      if (ctx) {
        document.removeEventListener('visibilitychange', onVisibility);
        void ctx.close().catch(() => {});
      }
      ctx = null;
      master = null;
      bedGain = null;
      buffers.clear();
      lastPlayed.clear();
      log.length = 0;
      voices = 0;
      groan = null;
      wantAmbience = false;
      unsupported = false;
    },
  };
  return manager;
}

/** The shared instance every mode uses. */
export const audio: AudioManager = createAudioManager();

/**
 * Unlocks audio on the first user gesture (browsers refuse earlier). Returns a
 * function that removes the listeners.
 */
export function unlockAudioOnGesture(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const handler = (): void => {
    audio.unlock();
    // Keep listening until the context really runs (a first press may only create it).
    if (audio.state === 'running') off();
  };
  const off = (): void => {
    for (const e of events) target.removeEventListener(e, handler);
  };
  for (const e of events) target.addEventListener(e, handler);
  return off;
}
