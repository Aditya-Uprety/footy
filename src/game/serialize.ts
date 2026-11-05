// PURE. Wire helpers (PLAN §5.9, §8.2): trajectory frames travel as base64 of
// the Float32Array bytes (little-endian, written explicitly so the format
// doesn't depend on the machine), everything else as plain JSON.
import type { KickResult } from '../sim/types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

/** Bytes → base64 (standard alphabet, padded). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** base64 → bytes. Throws on characters outside the alphabet or a bad length. */
export function base64ToBytes(s: string): Uint8Array {
  if (s.length % 4 !== 0) throw new Error('base64: length must be a multiple of 4');
  let pad = 0;
  if (s.endsWith('==')) pad = 2;
  else if (s.endsWith('=')) pad = 1;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const c = s.charCodeAt(i + j);
      let v: number;
      if (c === 61 /* = */ && i + 4 === s.length && j >= 4 - pad) v = 0;
      else {
        v = c < 128 ? LOOKUP[c]! : -1;
        if (v < 0) throw new Error('base64: bad character');
      }
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Float32Array → base64 of its little-endian bytes. */
export function framesToBase64(frames: Float32Array): string {
  const bytes = new Uint8Array(frames.length * 4);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < frames.length; i++) dv.setFloat32(i * 4, frames[i]!, true);
  return bytesToBase64(bytes);
}

/** base64 (little-endian float32 bytes) → Float32Array. Throws unless the byte count is a multiple of 4. */
export function base64ToFrames(s: string): Float32Array {
  const bytes = base64ToBytes(s);
  if (bytes.length % 4 !== 0) throw new Error('frames: byte count must be a multiple of 4');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/** A KickResult with its frames as base64 (net/protocol `WireKickResult`). */
export type WireKick = Omit<KickResult, 'frames'> & { frames: string };

export function toWireKick(r: KickResult): WireKick {
  return { ...r, frames: framesToBase64(r.frames) };
}

/** Throws if the frames don't decode, or aren't whole [t, x, y, z] records. */
export function fromWireKick(w: WireKick): KickResult {
  const frames = base64ToFrames(w.frames);
  if (frames.length % 4 !== 0) throw new Error('frames: not whole [t, x, y, z] records');
  return { ...w, frames };
}

/** Deep copy through JSON: what the other side of the wire sees. */
export function jsonClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
