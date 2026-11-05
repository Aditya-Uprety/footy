// Procedural sound effects (PLAN §12 M14.1): every sound is computed here as a
// mono Float32Array, so there are no audio files to license (see
// public/sfx/LICENSES.md) and the whole thing runs in Node tests. app/audio.ts
// wraps the arrays into AudioBuffers. All sounds are deterministic (seeded
// noise) and peak-normalized to at most 1.
import { createRng } from '../shared/rng';

export const SAMPLE_RATE = 44100;
const TAU = Math.PI * 2;

/** The sounds the game can play (app/audioCues.ts maps sim events to these). */
export type SoundName = 'kick' | 'bounce' | 'thud' | 'post' | 'bar' | 'net' | 'catch' | 'roar' | 'groan' | 'crowd' | 'whistle1' | 'whistle2' | 'whistle3';

function alloc(rate: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(rate * seconds)));
}

function whiteNoise(n: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** One-pole low-pass, in place. */
function lowpass(x: Float32Array, cutoff: number, rate: number): Float32Array {
  const a = 1 - Math.exp((-TAU * cutoff) / rate);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i]! - y);
    x[i] = y;
  }
  return x;
}

/** One-pole high-pass, in place. */
function highpass(x: Float32Array, cutoff: number, rate: number): Float32Array {
  const a = 1 - Math.exp((-TAU * cutoff) / rate);
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    lp += a * (x[i]! - lp);
    x[i] = x[i]! - lp;
  }
  return x;
}

/** State-variable band-pass whose center follows `fc(t)`; returns a new array. */
function bandpass(x: Float32Array, fc: (t: number) => number, q: number, rate: number): Float32Array {
  const out = new Float32Array(x.length);
  let low = 0;
  let band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(fc(i / rate), rate * 0.2)) / rate);
    low += f * band;
    const high = x[i]! - low - damp * band;
    band += f * high;
    out[i] = band;
  }
  return out;
}

/** Scales so the loudest sample is `peak` (silence stays silence). */
function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!));
  if (m < 1e-9) return x;
  const g = peak / m;
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * g;
  return x;
}

/** Fades the last `sec` seconds to zero, in place (no click at the end). */
function fadeOut(x: Float32Array, sec: number, rate: number): Float32Array {
  const n = Math.min(x.length, Math.round(sec * rate));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] = x[x.length - 1 - i]! * (i / n);
  return x;
}

/** A sine whose frequency glides f0 → f1 (exponential, time constant `glide`), times an exp decay. */
function sweepTone(rate: number, seconds: number, f0: number, f1: number, glide: number, decay: number): Float32Array {
  const out = alloc(rate, seconds);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const f = f1 + (f0 - f1) * Math.exp(-t / glide);
    phase += (TAU * f) / rate;
    out[i] = Math.sin(phase) * Math.exp(-t / decay);
  }
  return out;
}

function mixInto(dst: Float32Array, src: Float32Array, gain: number, offset = 0): void {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] = dst[i + offset]! + src[i]! * gain;
}

/** Noise burst with an exp decay, low-passed at `cutoff`. */
function noiseBurst(rate: number, seconds: number, cutoff: number, decay: number, seed: number): Float32Array {
  const n = lowpass(whiteNoise(alloc(rate, seconds).length, seed), cutoff, rate);
  for (let i = 0; i < n.length; i++) n[i] = n[i]! * Math.exp(-i / rate / decay);
  return n;
}

// ---- impacts -----------------------------------------------------------------

/** A boot striking the ball: a short low "thump" with a leathery click. */
export function kickSound(rate = SAMPLE_RATE): Float32Array {
  const out = sweepTone(rate, 0.24, 62, 150, 0.018, 0.055).map((v, i) => v * (1 - Math.exp(-i / rate / 0.0015)));
  mixInto(out, noiseBurst(rate, 0.24, 2600, 0.007, 11), 0.7);
  return fadeOut(normalize(out), 0.02, rate);
}

/** The ball bouncing on grass: softer, more hollow. */
export function bounceSound(rate = SAMPLE_RATE): Float32Array {
  const out = sweepTone(rate, 0.26, 72, 118, 0.02, 0.06);
  mixInto(out, noiseBurst(rate, 0.26, 1400, 0.012, 23), 0.35);
  return fadeOut(normalize(out), 0.03, rate);
}

/** The ball hitting a player: a dull body thud. */
export function thudSound(rate = SAMPLE_RATE): Float32Array {
  const out = noiseBurst(rate, 0.22, 520, 0.045, 31);
  mixInto(out, sweepTone(rate, 0.22, 78, 95, 0.02, 0.05), 1.4);
  return fadeOut(normalize(out), 0.03, rate);
}

/** Metal ringing: inharmonic partials, each with its own decay. */
function clang(rate: number, f0: number, decay: number, seed: number): Float32Array {
  const ratios = [1, 2.32, 4.25, 6.63];
  const amps = [1, 0.6, 0.38, 0.22];
  const out = alloc(rate, decay * 3);
  ratios.forEach((r, k) => {
    const tau = decay * [1, 0.7, 0.5, 0.35][k]!;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      out[i] = out[i]! + Math.sin(TAU * f0 * r * t) * amps[k]! * Math.exp(-t / tau);
    }
  });
  mixInto(out, noiseBurst(rate, 0.05, 6000, 0.004, seed), 0.8);
  return fadeOut(normalize(out), 0.05, rate);
}

/** The ball off a post: a short bright "ting". */
export function postSound(rate = SAMPLE_RATE): Float32Array {
  return clang(rate, 640, 0.28, 41);
}

/** The ball off the crossbar: lower and longer. */
export function barSound(rate = SAMPLE_RATE): Float32Array {
  return clang(rate, 410, 0.42, 43);
}

/** The ball into the netting: a soft swish that falls in pitch. */
export function netSound(rate = SAMPLE_RATE): Float32Array {
  const n = whiteNoise(alloc(rate, 0.55).length, 53);
  const band = bandpass(n, (t) => 5200 - 3600 * Math.min(1, t / 0.4), 1.1, rate);
  for (let i = 0; i < band.length; i++) {
    const t = i / rate;
    band[i] = band[i]! * (1 - Math.exp(-t / 0.02)) * Math.exp(-t / 0.15);
  }
  return fadeOut(normalize(band, 0.8), 0.06, rate);
}

/** A keeper's gloves clapping around the ball. */
export function catchSound(rate = SAMPLE_RATE): Float32Array {
  const band = bandpass(whiteNoise(alloc(rate, 0.2).length, 61), () => 2300, 1.4, rate);
  for (let i = 0; i < band.length; i++) band[i] = band[i]! * Math.exp(-i / rate / 0.026);
  mixInto(band, sweepTone(rate, 0.2, 100, 150, 0.015, 0.045), 1.2);
  return fadeOut(normalize(band), 0.03, rate);
}

// ---- whistle -------------------------------------------------------------------

/** A referee's pea whistle blown in `blasts` ([start, length] in seconds), `total` seconds long. */
export function whistleSound(blasts: readonly (readonly [number, number])[], total: number, rate = SAMPLE_RATE): Float32Array {
  const out = alloc(rate, total);
  const breath = highpass(whiteNoise(out.length, 71), 2500, rate);
  let phase = 0;
  for (const [start, len] of blasts) {
    const i0 = Math.round(start * rate);
    const n = Math.round(len * rate);
    for (let i = 0; i < n && i0 + i < out.length; i++) {
      const t = i / rate;
      // Pitch rises a little as the blast goes on; the pea adds a fast trill.
      const f = 2780 + 140 * Math.min(1, t / 0.12) + 70 * Math.sin(TAU * 36 * t);
      phase += (TAU * f) / rate;
      const env = Math.min(1, t / 0.025) * Math.min(1, (len - t) / 0.06);
      const trill = 0.82 + 0.18 * Math.sin(TAU * 36 * t);
      const tone = Math.sin(phase) + 0.32 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
      out[i0 + i] = (tone * trill * 0.7 + breath[i0 + i]! * 0.12) * env;
    }
  }
  return normalize(out, 0.7);
}

export const whistleKickoff = (rate = SAMPLE_RATE): Float32Array => whistleSound([[0.02, 0.5]], 0.62, rate);
export const whistleHalfTime = (rate = SAMPLE_RATE): Float32Array =>
  whistleSound(
    [
      [0.02, 0.42],
      [0.62, 0.42],
    ],
    1.15,
    rate,
  );
export const whistleFullTime = (rate = SAMPLE_RATE): Float32Array =>
  whistleSound(
    [
      [0.02, 0.4],
      [0.58, 0.4],
      [1.14, 0.95],
    ],
    2.2,
    rate,
  );

// ---- crowd -----------------------------------------------------------------------

/**
 * A loopable crowd murmur: band-limited noise with slow swells. The loop point
 * is cross-faded from the noise that follows it, so the seam is continuous.
 */
export function crowdBed(rate = SAMPLE_RATE, seconds = 6): Float32Array {
  const n = Math.round(seconds * rate);
  const x = Math.round(0.4 * rate);
  let src = whiteNoise(n + x, 83);
  src = highpass(lowpass(lowpass(src, 1100, rate), 1400, rate), 160, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = src[i]!;
    if (i < x) {
      const k = (i / x) * Math.PI * 0.5;
      v = v * Math.sin(k) + src[n + i]! * Math.cos(k);
    }
    // Swells with a whole number of cycles per loop, so they wrap too.
    const t = i / rate;
    const swell = 1 + 0.28 * Math.sin((TAU * 2 * t) / seconds) + 0.16 * Math.sin((TAU * 5 * t) / seconds + 1.3);
    out[i] = v * swell;
  }
  return normalize(out, 0.5);
}

/** A goal roar: a wall of noise that swells in half a second and dies away over ~4 s, with a "wooo" on top. */
export function roarSound(rate = SAMPLE_RATE): Float32Array {
  const total = 5;
  const n = alloc(rate, total).length;
  const body = bandpass(whiteNoise(n, 91), (t) => 900 + 500 * Math.min(1, t / 1.2), 0.9, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.5) * (t < 0.55 ? 1 : Math.exp(-(t - 0.55) / 1.7));
    const claps = 0.85 + 0.15 * Math.sin(TAU * 9 * t);
    out[i] = body[i]! * env * claps;
  }
  // The shout: a few voices rising together.
  let ph = [0, 0, 0];
  const base = [300, 372, 455];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (t > 3.2) break;
    const env = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.5) / 1.1);
    let v = 0;
    ph = ph.map((p, k) => {
      const f = base[k]! * (1 + 0.28 * Math.min(1, t / 0.6)) * (1 + 0.012 * Math.sin(TAU * (5.1 + k) * t));
      const np = p + (TAU * f) / rate;
      v += Math.sin(np) + 0.5 * Math.sin(2 * np) + 0.25 * Math.sin(3 * np);
      return np;
    });
    out[i] = out[i]! + v * env * 0.12;
  }
  return fadeOut(normalize(out, 0.9), 0.25, rate);
}

/** The "ooooh" of a near miss: voices sliding down over a short wash of noise. */
export function groanSound(rate = SAMPLE_RATE): Float32Array {
  const total = 1.8;
  const n = alloc(rate, total).length;
  const wash = bandpass(whiteNoise(n, 97), (t) => 950 - 520 * Math.min(1, t / 1.2), 2.2, rate);
  const out = new Float32Array(n);
  let ph = [0, 0, 0, 0];
  const base = [250, 301, 366, 420];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.18) * Math.exp(-Math.max(0, t - 0.25) / 0.7);
    let v = 0;
    ph = ph.map((p, k) => {
      const f = base[k]! * (0.66 + 0.34 * Math.exp(-t / 0.55)) * (1 + 0.015 * Math.sin(TAU * (4.6 + 0.7 * k) * t));
      const np = p + (TAU * f) / rate;
      v += Math.sin(np) + 0.45 * Math.sin(2 * np) + 0.2 * Math.sin(3 * np);
      return np;
    });
    out[i] = (v * 0.2 + wash[i]! * 0.6) * env;
  }
  return fadeOut(normalize(out, 0.8), 0.2, rate);
}

/** Builds a named sound at the given sample rate. */
export function renderSound(name: SoundName, rate = SAMPLE_RATE): Float32Array {
  switch (name) {
    case 'kick':
      return kickSound(rate);
    case 'bounce':
      return bounceSound(rate);
    case 'thud':
      return thudSound(rate);
    case 'post':
      return postSound(rate);
    case 'bar':
      return barSound(rate);
    case 'net':
      return netSound(rate);
    case 'catch':
      return catchSound(rate);
    case 'roar':
      return roarSound(rate);
    case 'groan':
      return groanSound(rate);
    case 'crowd':
      return crowdBed(rate);
    case 'whistle1':
      return whistleKickoff(rate);
    case 'whistle2':
      return whistleHalfTime(rate);
    case 'whistle3':
      return whistleFullTime(rate);
  }
}
