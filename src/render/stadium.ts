// Stadium (M12.3): a stepped stand bowl around the pitch, an instanced crowd,
// advertising boards and four floodlight towers. Purely visual: the ball and
// players never touch any of it (a ball that leaves the pitch during a tail
// may pass through the boards, PLAN §5.8: tails are visual only).
//
// Draw-call budget: stand 1 + crowd 2 + boards 1 + towers 2 = 6.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../shared/rng';
import type { Pitch } from '../shared/pitch';
import { APRON } from './pitch';

// ---------------------------------------------------------------------------
// Dimensions (metres)
// ---------------------------------------------------------------------------

/** Ad boards: front face distance from the lines (inside the 6 m apron). */
export const BOARD_GAP = 4.5;
export const BOARD_H = 0.9;
export const BOARD_T = 0.12;
const BOARD_CORNER_R = 2.5;
/** One texture tile holds 8 ads of 3.6 m. */
const ADS_PER_TILE = 8;
const AD_LEN = 3.6;
const TILE_LEN = ADS_PER_TILE * AD_LEN;

/** Stand front wall: distance from the lines. */
export const STAND_GAP = 9;
/** Corner radius of the bowl at its front wall. */
const STAND_CORNER_R = 8;
const WALL_H = 1.1;
const LOWER_ROWS = 14;
const UPPER_ROWS = 12;
const TREAD = 0.8;
const RISE_LOWER = 0.42;
const RISE_UPPER = 0.55;
const WALKWAY = 3.2;
/** Spacing between spectators along a row. */
const SEAT_SPACING = 0.6;

const TOWER_H = 40;

// ---------------------------------------------------------------------------
// Ring: a rounded rectangle swept around the pitch (pure)
// ---------------------------------------------------------------------------

/** Rounded rectangle: arc centers at (±a, ±b), radius r0 + offset. */
export interface RingSpec {
  a: number;
  b: number;
  r0: number;
}

export interface RingPoint {
  x: number;
  z: number;
  /** Outward unit normal (xz). */
  nx: number;
  nz: number;
}

interface RingPiece {
  len: number;
  at(t: number): RingPoint;
}

/** A ring whose offset-0 outline is the rectangle ±halfX × ±halfZ with corner radius r0. */
export function ringSpec(halfX: number, halfZ: number, r0: number): RingSpec {
  return { a: halfX - r0, b: halfZ - r0, r0 };
}

const CORNERS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
] as const;
const EDGE_NORMALS = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
] as const;

/** The 8 pieces of the ring at outward offset `o`: arc, edge, arc, edge, … */
export function ringPieces(spec: RingSpec, o: number): RingPiece[] {
  const rho = spec.r0 + o;
  const pieces: RingPiece[] = [];
  for (let k = 0; k < 4; k++) {
    const [sx, sz] = CORNERS[k]!;
    const cx = sx * spec.a;
    const cz = sz * spec.b;
    const a0 = (k * Math.PI) / 2;
    pieces.push({
      len: (rho * Math.PI) / 2,
      at(t) {
        const f = a0 + (t * Math.PI) / 2;
        const nx = Math.cos(f);
        const nz = Math.sin(f);
        return { x: cx + rho * nx, z: cz + rho * nz, nx, nz };
      },
    });
    const [ex, ez] = CORNERS[(k + 1) % 4]!;
    const [nx, nz] = EDGE_NORMALS[k]!;
    const x0 = cx + rho * nx;
    const z0 = cz + rho * nz;
    const x1 = ex * spec.a + rho * nx;
    const z1 = ez * spec.b + rho * nz;
    pieces.push({
      len: Math.hypot(x1 - x0, z1 - z0),
      at: (t) => ({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz }),
    });
  }
  return pieces;
}

const ARC_STEPS = 8;
const EDGE_STEP = 8;

/** Closed polyline (last point = first) with the same sample layout for every offset. */
export function ringPoints(spec: RingSpec, o: number): RingPoint[] {
  const pieces = ringPieces(spec, o);
  const pts: RingPoint[] = [];
  for (let k = 0; k < 4; k++) {
    const arc = pieces[2 * k]!;
    const edge = pieces[2 * k + 1]!;
    for (let j = 0; j < ARC_STEPS; j++) pts.push(arc.at(j / ARC_STEPS));
    // Edge length does not depend on the offset, so every ring gets the same count.
    const n = Math.max(1, Math.ceil(edge.len / EDGE_STEP));
    for (let j = 0; j < n; j++) pts.push(edge.at(j / n));
  }
  pts.push(pts[0]!);
  return pts;
}

/** The stand bowl's ring (offset 0 = front wall). */
export function standSpec(pitch: Pitch): RingSpec {
  return ringSpec(pitch.halfLength + STAND_GAP, pitch.halfWidth + STAND_GAP, STAND_CORNER_R);
}

/** The advertising boards' ring (offset 0 = the face toward the pitch). */
export function boardSpec(pitch: Pitch): RingSpec {
  return ringSpec(pitch.halfLength + BOARD_GAP, pitch.halfWidth + BOARD_GAP, BOARD_CORNER_R);
}

// ---------------------------------------------------------------------------
// Stand cross-section (pure)
// ---------------------------------------------------------------------------

export type SegKind = 'fascia' | 'walk' | 'riser' | 'tread' | 'rail' | 'back';

/** One straight piece of the stand's cross-section: (offset, height) pairs. */
export interface ProfileSeg {
  o0: number;
  h0: number;
  o1: number;
  h1: number;
  kind: SegKind;
  /** 0 = lower tier, 1 = upper tier. */
  tier: 0 | 1;
}

/** A row of seats: spectators stand at offset `o` on a tread at height `h`. */
export interface SeatRow {
  o: number;
  h: number;
  tier: 0 | 1;
}

export interface StandProfile {
  segs: ProfileSeg[];
  rows: SeatRow[];
  /** Offset of the back wall. */
  depth: number;
  /** Height of the top of the stand. */
  height: number;
}

export function standProfile(): StandProfile {
  const segs: ProfileSeg[] = [];
  const rows: SeatRow[] = [];
  let o = 0;
  let h = 0;
  const go = (dO: number, dH: number, kind: SegKind, tier: 0 | 1 = 0): void => {
    segs.push({ o0: o, h0: h, o1: o + dO, h1: h + dH, kind, tier });
    o += dO;
    h += dH;
  };
  go(0, WALL_H, 'fascia');
  go(0.8, 0, 'walk');
  for (let i = 0; i < LOWER_ROWS; i++) {
    go(0, RISE_LOWER, 'riser', 0);
    go(TREAD, 0, 'tread', 0);
    rows.push({ o: o - TREAD / 2, h, tier: 0 });
  }
  go(0, 0.45, 'rail', 0);
  go(WALKWAY, 0, 'walk', 0);
  for (let i = 0; i < UPPER_ROWS; i++) {
    go(0, RISE_UPPER, 'riser', 1);
    go(TREAD, 0, 'tread', 1);
    rows.push({ o: o - TREAD / 2, h, tier: 1 });
  }
  go(0, 1.0, 'rail', 1);
  go(0.8, 0, 'walk', 1);
  const top = h;
  go(0, -top, 'back', 1);
  return { segs, rows, depth: o, height: top };
}

// ---------------------------------------------------------------------------
// Mesh building helpers
// ---------------------------------------------------------------------------

interface Vtx {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u?: number;
  v?: number;
}

/** Collects quads (wound to match the vertex normals) into one BufferGeometry. */
class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly uv: number[] = [];
  private useColor = false;
  private useUv = false;

  quad(v0: Vtx, v1: Vtx, v2: Vtx, v3: Vtx, color?: THREE.Color): void {
    const e = (a: Vtx, b: Vtx): [number, number, number] => [b.x - a.x, b.y - a.y, b.z - a.z];
    const cross = (p: number[], q: number[]): [number, number, number] => [
      p[1]! * q[2]! - p[2]! * q[1]!,
      p[2]! * q[0]! - p[0]! * q[2]!,
      p[0]! * q[1]! - p[1]! * q[0]!,
    ];
    const c1 = cross(e(v0, v1), e(v0, v2));
    const c2 = cross(e(v0, v2), e(v0, v3));
    const sx = v0.nx + v1.nx + v2.nx + v3.nx;
    const sy = v0.ny + v1.ny + v2.ny + v3.ny;
    const sz = v0.nz + v1.nz + v2.nz + v3.nz;
    const dot = (c1[0] + c2[0]) * sx + (c1[1] + c2[1]) * sy + (c1[2] + c2[2]) * sz;
    const order = dot >= 0 ? [v0, v1, v2, v0, v2, v3] : [v0, v2, v1, v0, v3, v2];
    for (const v of order) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(v.nx, v.ny, v.nz);
      if (color) {
        this.col.push(color.r, color.g, color.b);
        this.useColor = true;
      }
      if (v.u !== undefined) {
        this.uv.push(v.u, v.v ?? 0);
        this.useUv = true;
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.useUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Cheap deterministic hash in [0, 1). */
function hash01(n: number): number {
  let t = Math.imul(n | 0, 0x9e3779b1) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 0x85ebca6b) >>> 0;
  t ^= t >>> 13;
  return (t >>> 0) / 4294967296;
}

const STAND_COLORS = {
  fascia: [0x1f3a5f, 0x2a4b78],
  walk: [0x9aa1a8, 0x8f969d],
  riser: [0x7f8891, 0x78818a],
  rail: [0x30343b, 0x30343b],
  back: [0xb3b9be, 0xa4abb1],
  tread: [
    [0x2f5f9e, 0x3a6fb3, 0x2b548c, 0x335f99],
    [0x34445f, 0x3c4e6b, 0x2d3b54, 0x38486a],
  ],
} as const;

const colorCache = new Map<number, THREE.Color>();
function hexColor(hex: number): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

function sectionColor(seg: ProfileSeg, section: number, segIndex: number): THREE.Color {
  if (seg.kind === 'tread') {
    const palette = STAND_COLORS.tread[seg.tier];
    // Seat blocks: a few sections wide share a color.
    return hexColor(palette[Math.floor(hash01(Math.floor(section / 2) * 31 + seg.tier * 7 + 3) * palette.length)]!);
  }
  const pair = STAND_COLORS[seg.kind];
  return hexColor(pair[(section + segIndex) % 2 === 0 ? 0 : 1]!);
}

/** The stepped bowl: fascia wall, two tiers with a walkway, rails and a back wall. */
export function buildStandGeometry(pitch: Pitch): THREE.BufferGeometry {
  const spec = standSpec(pitch);
  const profile = standProfile();
  const rings = new Map<number, RingPoint[]>();
  const ringAt = (o: number): RingPoint[] => {
    let r = rings.get(o);
    if (!r) {
      r = ringPoints(spec, o);
      rings.set(o, r);
    }
    return r;
  };

  const mb = new MeshBuilder();
  profile.segs.forEach((seg, si) => {
    const r0 = ringAt(seg.o0);
    const r1 = ringAt(seg.o1);
    // Normal in (offset, height) space; for a riser it points toward the pitch, for a tread up.
    const dO = seg.o1 - seg.o0;
    const dH = seg.h1 - seg.h0;
    const len = Math.hypot(dO, dH);
    const no = -dH / len;
    const ny = dO / len;
    for (let i = 0; i < r0.length - 1; i++) {
      const color = sectionColor(seg, i, si);
      const v = (p: RingPoint, h: number): Vtx => ({ x: p.x, y: h, z: p.z, nx: no * p.nx, ny, nz: no * p.nz });
      mb.quad(v(r0[i]!, seg.h0), v(r0[i + 1]!, seg.h0), v(r1[i + 1]!, seg.h1), v(r1[i]!, seg.h1), color);
    }
  });
  return mb.build();
}

// ---------------------------------------------------------------------------
// Ad boards
// ---------------------------------------------------------------------------

/** Texture layout: ads in the top 128 px, a dark band below for the board's top and back. */
const AD_TEX_W = ADS_PER_TILE * 512;
const AD_TEX_H = 144;
const AD_BAND = 16 / AD_TEX_H;
const V_AD0 = AD_BAND;
const V_DARK = AD_BAND / 2;

export interface BoardGeometry {
  geometry: THREE.BufferGeometry;
  /** Whole texture tiles around the ring (the length is stretched slightly to fit). */
  tiles: number;
  /** Ring length at the front face, metres. */
  length: number;
}

export function buildBoardGeometry(pitch: Pitch): BoardGeometry {
  const spec = boardSpec(pitch);
  const front = ringPoints(spec, 0);
  const back = ringPoints(spec, BOARD_T);
  const cum: number[] = [0];
  for (let i = 1; i < front.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(front[i]!.x - front[i - 1]!.x, front[i]!.z - front[i - 1]!.z));
  }
  const length = cum[cum.length - 1]!;
  const tiles = Math.max(1, Math.round(length / TILE_LEN));
  const u = (i: number): number => (cum[i]! / length) * tiles;

  const mb = new MeshBuilder();
  for (let i = 0; i < front.length - 1; i++) {
    const f0 = front[i]!;
    const f1 = front[i + 1]!;
    const b0 = back[i]!;
    const b1 = back[i + 1]!;
    // Face toward the pitch (inward normal), carrying the ads.
    const fv = (p: RingPoint, h: number, uu: number, vv: number): Vtx => ({ x: p.x, y: h, z: p.z, nx: -p.nx, ny: 0, nz: -p.nz, u: uu, v: vv });
    mb.quad(fv(f0, 0, u(i), V_AD0), fv(f1, 0, u(i + 1), V_AD0), fv(f1, BOARD_H, u(i + 1), 1), fv(f0, BOARD_H, u(i), 1));
    // Top.
    const tv = (p: RingPoint, uu: number): Vtx => ({ x: p.x, y: BOARD_H, z: p.z, nx: 0, ny: 1, nz: 0, u: uu, v: V_DARK });
    mb.quad(tv(f0, u(i)), tv(f1, u(i + 1)), tv(b1, u(i + 1)), tv(b0, u(i)));
    // Back.
    const bv = (p: RingPoint, h: number, uu: number): Vtx => ({ x: p.x, y: h, z: p.z, nx: p.nx, ny: 0, nz: p.nz, u: uu, v: V_DARK });
    mb.quad(bv(b0, 0, u(i)), bv(b1, 0, u(i + 1)), bv(b1, BOARD_H, u(i + 1)), bv(b0, BOARD_H, u(i)));
  }
  return { geometry: mb.build(), tiles, length };
}

/** Fictional sponsors (no real brands). */
const ADS: { text: string; bg: string; fg: string; accent: string }[] = [
  { text: 'FOOTY', bg: '#12263f', fg: '#ffffff', accent: '#ffd23f' },
  { text: 'TOP BINS', bg: '#c1272d', fg: '#ffffff', accent: '#ffffff' },
  { text: 'KICK-OFF CUP', bg: '#ffd23f', fg: '#1a1a1a', accent: '#c1272d' },
  { text: 'GOLAZO', bg: '#0b6e4f', fg: '#ffffff', accent: '#ffd23f' },
  { text: 'CURVE+', bg: '#6a2c91', fg: '#ffffff', accent: '#ffffff' },
  { text: 'LOFT 55', bg: '#f4f4f0', fg: '#12263f', accent: '#1f6fd1' },
  { text: 'NUTMEG', bg: '#1f6fd1', fg: '#ffffff', accent: '#ffd23f' },
  { text: 'VOLLEY', bg: '#ee7d11', fg: '#1a1a1a', accent: '#ffffff' },
];

function createAdTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = AD_TEX_W;
  canvas.height = AD_TEX_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, AD_TEX_W, AD_TEX_H);
  ADS.forEach((ad, i) => {
    const x = i * 512;
    ctx.fillStyle = ad.bg;
    ctx.fillRect(x, 0, 512, 128);
    ctx.fillStyle = ad.accent;
    ctx.fillRect(x, 112, 512, 8);
    ctx.fillRect(x, 0, 8, 128);
    ctx.fillStyle = ad.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 76;
    ctx.font = `800 ${size}px Arial, Helvetica, sans-serif`;
    while (ctx.measureText(ad.text).width > 440 && size > 24) {
      size -= 4;
      ctx.font = `800 ${size}px Arial, Helvetica, sans-serif`;
    }
    ctx.fillText(ad.text, x + 256, 58);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Crowd
// ---------------------------------------------------------------------------

/** Shirt palette: 0–2 reds, 3–5 blues, the rest neutral. */
const SHIRTS = [
  0xc8202f, 0xe03c3c, 0x9e1b2a, 0x1f4fb4, 0x3d7be0, 0x163a82, 0xf0f0f0, 0x222222, 0xe8c23a, 0x2f8f5b, 0x8a8f96, 0xee7d11, 0x6a2c91, 0xd9d2c0,
];
const SHIRT_RED = 3;
const SHIRT_BLUE = 6;
const SKINS = [0xf1c9a5, 0xe0a97d, 0xc68642, 0x8d5524, 0x5a3825, 0xffdbac];

export interface Crowd {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Rotation about y so the spectator faces the pitch. */
  yaw: Float32Array;
  scale: Float32Array;
  shirt: Uint8Array;
  skin: Uint8Array;
}

/**
 * Where every spectator stands. Deterministic for a seed; `density` (0–1)
 * thins the crowd (performance mode). Supporters of the team defending −x
 * (Team A, red) lean to that end, Team B's (blue) to +x.
 */
export function crowdPlacements(pitch: Pitch, seed = 1, density = 1): Crowd {
  const rng = createRng(seed);
  const spec = standSpec(pitch);
  const profile = standProfile();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const yaws: number[] = [];
  const scales: number[] = [];
  const shirts: number[] = [];
  const skins: number[] = [];
  const hl = pitch.halfLength;

  for (const row of profile.rows) {
    const fill = Math.min(1, (row.tier === 0 ? 0.92 : 0.82) * density);
    for (const piece of ringPieces(spec, row.o)) {
      const n = Math.floor(piece.len / SEAT_SPACING);
      for (let k = 0; k < n; k++) {
        const present = rng.next() < fill;
        const jitter = (rng.next() - 0.5) * 0.2;
        const sc = rng.range(0.92, 1.1);
        const pick = rng.next();
        const sub = rng.next();
        const skin = rng.int(SKINS.length);
        if (!present) continue;
        const p = piece.at(Math.min(1, Math.max(0, (k + 0.5 + jitter) / n)));
        const bias = p.x / (hl + 40);
        const pr = Math.min(0.6, Math.max(0.05, 0.3 - 0.45 * bias));
        const pb = Math.min(0.6, Math.max(0.05, 0.3 + 0.45 * bias));
        let shirt: number;
        if (pick < pr) shirt = Math.floor(sub * 3);
        else if (pick < pr + pb) shirt = SHIRT_RED + Math.floor(sub * 3);
        else shirt = SHIRT_BLUE + Math.floor(sub * (SHIRTS.length - SHIRT_BLUE));
        xs.push(p.x);
        ys.push(row.h);
        zs.push(p.z);
        yaws.push(Math.atan2(-p.nx, -p.nz));
        scales.push(sc);
        shirts.push(shirt);
        skins.push(skin);
      }
    }
  }
  return {
    count: xs.length,
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    yaw: Float32Array.from(yaws),
    scale: Float32Array.from(scales),
    shirt: Uint8Array.from(shirts),
    skin: Uint8Array.from(skins),
  };
}

/** Shoulders and torso of a seated spectator, facing +z, feet at the origin. */
function bodyGeometry(): THREE.BufferGeometry {
  const poly: [number, number][] = [
    [-0.26, 0],
    [0.26, 0],
    [0.26, 0.5],
    [0.17, 0.62],
    [-0.17, 0.62],
    [-0.26, 0.5],
  ];
  const pos: number[] = [];
  for (let i = 1; i < poly.length - 1; i++) {
    for (const k of [0, i, i + 1]) pos.push(poly[k]![0], poly[k]![1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 0, 1]).flat(), 3));
  return g;
}

function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(0.115, 10);
  g.translate(0, 0.765, 0);
  return g;
}

// ---------------------------------------------------------------------------
// Floodlight towers
// ---------------------------------------------------------------------------

export interface Tower {
  x: number;
  z: number;
  /** Rotation about y so the lamp panel faces the pitch center. */
  yaw: number;
}

/** One tower behind each corner of the bowl. */
export function towerPlacements(pitch: Pitch): Tower[] {
  const spec = standSpec(pitch);
  const rho = spec.r0 + standProfile().depth + 4;
  return CORNERS.map(([sx, sz], k) => {
    const f = (k * Math.PI) / 2 + Math.PI / 4;
    const x = sx * spec.a + rho * Math.cos(f);
    const z = sz * spec.b + rho * Math.sin(f);
    return { x, z, yaw: Math.atan2(-x, -z) };
  });
}

function buildTowerGeometries(pitch: Pitch): { structure: THREE.BufferGeometry; lamps: THREE.BufferGeometry } {
  const structure: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const tilt = THREE.MathUtils.degToRad(24);
  for (const t of towerPlacements(pitch)) {
    const pole = new THREE.CylinderGeometry(0.35, 0.8, TOWER_H, 8);
    pole.translate(t.x, TOWER_H / 2, t.z);
    structure.push(pole);

    const dirX = Math.sin(t.yaw);
    const dirZ = Math.cos(t.yaw);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(t.x + dirX * 1.4, TOWER_H + 1, t.z + dirZ * 1.4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, t.yaw, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const frame = new THREE.BoxGeometry(8.4, 5, 0.5);
    frame.applyMatrix4(m);
    structure.push(frame);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 7; c++) {
        const lamp = new THREE.PlaneGeometry(0.95, 0.95);
        lamp.translate(-3.6 + c * 1.2, -1.8 + r * 1.2, 0.27);
        lamp.applyMatrix4(m);
        lamps.push(lamp);
      }
    }
  }
  return { structure: mergeGeometries(structure, false)!, lamps: mergeGeometries(lamps, false)! };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface StadiumOptions {
  maxAnisotropy?: number;
  /** 0–1: share of seats filled (performance mode lowers it). */
  crowdDensity?: number;
  seed?: number;
}

export interface StadiumView {
  readonly group: THREE.Group;
  /** Spectators drawn. */
  readonly spectators: number;
  dispose(): void;
}

/** Stand bowl, crowd, ad boards and floodlight towers for `pitch`. */
export function createStadiumView(pitch: Pitch, opts: StadiumOptions = {}): StadiumView {
  const group = new THREE.Group();
  group.name = 'stadium';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  // Stands.
  const standGeo = track(buildStandGeometry(pitch));
  const standMat = track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.name = 'stand';
  group.add(stand);

  // Crowd: two instanced meshes (shirts, heads).
  const crowd = crowdPlacements(pitch, opts.seed ?? 1, opts.crowdDensity ?? 1);
  const bodyGeo = track(bodyGeometry());
  const headGeo = track(headGeometry());
  const crowdMat = track(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
  const bodies = new THREE.InstancedMesh(bodyGeo, crowdMat, Math.max(1, crowd.count));
  const heads = new THREE.InstancedMesh(headGeo, crowdMat, Math.max(1, crowd.count));
  bodies.name = 'crowd-bodies';
  heads.name = 'crowd-heads';
  bodies.count = heads.count = crowd.count;
  const dummy = new THREE.Object3D();
  const shirtColors = SHIRTS.map((h) => new THREE.Color(h));
  const skinColors = SKINS.map((h) => new THREE.Color(h));
  for (let i = 0; i < crowd.count; i++) {
    dummy.position.set(crowd.x[i]!, crowd.y[i]!, crowd.z[i]!);
    dummy.rotation.set(0, crowd.yaw[i]!, 0);
    dummy.scale.setScalar(crowd.scale[i]!);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, shirtColors[crowd.shirt[i]!]!);
    heads.setColorAt(i, skinColors[crowd.skin[i]!]!);
  }
  bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  bodies.frustumCulled = heads.frustumCulled = false;
  track({ dispose: () => bodies.dispose() });
  track({ dispose: () => heads.dispose() });
  group.add(bodies, heads);

  // Ad boards.
  const boards = buildBoardGeometry(pitch);
  const boardGeo = track(boards.geometry);
  const adTex = track(createAdTexture(opts.maxAnisotropy ?? 1));
  adTex.repeat.set(1, 1);
  const boardMat = track(
    new THREE.MeshLambertMaterial({ map: adTex, emissive: 0xffffff, emissiveMap: adTex, emissiveIntensity: 0.45 }),
  );
  const boardMesh = new THREE.Mesh(boardGeo, boardMat);
  boardMesh.name = 'ad-boards';
  group.add(boardMesh);

  // Floodlight towers.
  const towers = buildTowerGeometries(pitch);
  const structureGeo = track(towers.structure);
  const lampGeo = track(towers.lamps);
  const structureMat = track(new THREE.MeshLambertMaterial({ color: 0x77808a }));
  const lampMat = track(new THREE.MeshBasicMaterial({ color: 0xfff4d6, side: THREE.DoubleSide }));
  const structureMesh = new THREE.Mesh(structureGeo, structureMat);
  const lampMesh = new THREE.Mesh(lampGeo, lampMat);
  structureMesh.name = 'tower-structure';
  lampMesh.name = 'tower-lamps';
  group.add(structureMesh, lampMesh);

  return {
    group,
    spectators: crowd.count,
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}

/** Distance from the lines to the farthest part of the stands (camera sanity checks). */
export function stadiumReach(): number {
  return STAND_GAP + standProfile().depth;
}

// Boards must sit inside the apron so nothing floats over the dull outer ground.
if (BOARD_GAP + BOARD_T >= APRON) throw new Error('ad boards must stay inside the apron');
