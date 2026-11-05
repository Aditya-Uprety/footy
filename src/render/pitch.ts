// Pitch rendering: striped grass, apron, surroundings (M1.1) and the line
// markings (M1.2). All geometry derives from `derivePitch` (PLAN §2.2).
import * as THREE from 'three';
import { LAW1, type Pitch } from '../shared/pitch';

/** Apron beyond the lines on every side, metres (PLAN M1.1). */
export const APRON = 6;
/** Target width of one mowing stripe, metres (the real width is fitted so each half has a whole number). */
const STRIPE_TARGET = 5.5;
/** Grass detail texture tile size, metres. */
const DETAIL_TILE = 8;
/** Grass detail texture resolution (texels per side; 8 m / 256 ≈ 3 cm per texel). */
export const DETAIL_SIZE = 256;
/** Radius of the dull outer ground beyond the apron (fades into the fog). */
const OUTER_RADIUS = 1400;
/** Markings sit this far above the grass (plus a polygon offset) to avoid z-fighting. */
const MARK_Y = 0.004;
/** Spot radius (center spot, penalty marks). */
const SPOT_R = 0.11;

const COLORS = {
  stripeLight: new THREE.Color(0x4f9a3f),
  stripeDark: new THREE.Color(0x3f8634),
  apron: new THREE.Color(0x3b7d31),
  outer: 0x52734a,
  line: 0xf4f6f2,
};

export interface PitchView {
  readonly group: THREE.Group;
  dispose(): void;
}

/** Builds the whole pitch: outer ground, apron, striped grass and markings. */
export function createPitchView(pitch: Pitch, maxAnisotropy = 1): PitchView {
  const group = new THREE.Group();
  group.name = 'pitch';

  const detail = createGrassDetailTexture(maxAnisotropy);

  // Outer ground: everything beyond the apron, kept dull so the pitch pops.
  // It has a hole under the grass so the two never overlap (no distant z-fighting).
  const outerShape = new THREE.Shape().absarc(0, 0, OUTER_RADIUS, 0, Math.PI * 2, false);
  const ax = pitch.halfLength + APRON;
  const az = pitch.halfWidth + APRON;
  outerShape.holes.push(
    new THREE.Path().moveTo(-ax, -az).lineTo(ax, -az).lineTo(ax, az).lineTo(-ax, az).lineTo(-ax, -az),
  );
  const outerGeo = new THREE.ShapeGeometry(outerShape, 48);
  outerGeo.rotateX(-Math.PI / 2);
  const outerMat = new THREE.MeshLambertMaterial({ color: COLORS.outer });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.name = 'outer-ground';
  outer.position.y = -0.01;
  outer.receiveShadow = true;
  group.add(outer);

  const grassGeo = buildGrassGeometry(pitch);
  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.95,
    metalness: 0,
  });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.name = 'grass';
  grass.receiveShadow = true;
  group.add(grass);

  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute('position', new THREE.Float32BufferAttribute(liftMarkings(buildMarkings(pitch)), 3));
  markGeo.computeVertexNormals();
  const markMat = new THREE.MeshStandardMaterial({
    color: COLORS.line,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const markings = new THREE.Mesh(markGeo, markMat);
  markings.name = 'markings';
  markings.receiveShadow = true;
  markings.renderOrder = 1;
  group.add(markings);

  return {
    group,
    dispose() {
      for (const g of [outerGeo, grassGeo, markGeo]) g.dispose();
      for (const m of [outerMat, grassMat, markMat]) m.dispose();
      detail.dispose();
      group.removeFromParent();
    },
  };
}

/** Stripe boundaries along x for one pitch: symmetric about the halfway line. */
export function stripeEdges(pitch: Pitch): number[] {
  const perHalf = Math.max(1, Math.round(pitch.halfLength / STRIPE_TARGET));
  const w = pitch.halfLength / perHalf;
  const edges: number[] = [];
  for (let i = -perHalf; i <= perHalf; i++) edges.push(i * w);
  return edges;
}

/**
 * Grass plane: mowing stripes (bands alternating along x, mirrored about the
 * halfway line) over the field, plus a 6 m apron frame. Vertex colors carry
 * the stripes so their edges stay crisp; UVs are world-scaled for the detail map.
 */
function buildGrassGeometry(pitch: Pitch): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const quad = (x0: number, x1: number, z0: number, z1: number, c: THREE.Color): void => {
    // Two triangles, counter-clockwise seen from above (+y normal).
    const v = [
      [x0, z0],
      [x0, z1],
      [x1, z1],
      [x0, z0],
      [x1, z1],
      [x1, z0],
    ] as const;
    for (const [x, z] of v) {
      pos.push(x, 0, z);
      col.push(c.r, c.g, c.b);
      uv.push(x / DETAIL_TILE, z / DETAIL_TILE);
    }
  };

  const { halfLength: hl, halfWidth: hw } = pitch;
  const edges = stripeEdges(pitch);
  const perHalf = (edges.length - 1) / 2;
  for (let i = 0; i < edges.length - 1; i++) {
    // Distance (in stripes) from the halfway line; both stripes touching it share a color.
    const fromCenter = i < perHalf ? perHalf - 1 - i : i - perHalf;
    const c = fromCenter % 2 === 0 ? COLORS.stripeLight : COLORS.stripeDark;
    quad(edges[i]!, edges[i + 1]!, -hw, hw, c);
  }

  const ax = hl + APRON;
  const az = hw + APRON;
  quad(-ax, ax, -az, -hw, COLORS.apron);
  quad(-ax, ax, hw, az, COLORS.apron);
  quad(-ax, -hl, -hw, hw, COLORS.apron);
  quad(hl, ax, -hw, hw, COLORS.apron);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tileable grass luminance (RGBA bytes, `n × n`): broad soft patches (wear and
 * moisture), mid-scale mottling, short blade streaks along x (the mowing
 * direction) and fine speckle. Every layer wraps, so the texture tiles without
 * seams. Deterministic (no Math.random), so screenshots stay stable.
 */
export function grassDetailPixels(n = DETAIL_SIZE, seed = 0x9e3779b9): Uint8Array {
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  /** Wrapping value noise with `cells` lattice cells per side, smoothstep interpolated. */
  const valueNoise = (cells: number): Float32Array => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = lattice[(y0 % cells) * cells + (x0 % cells)]!;
        const b = lattice[(y0 % cells) * cells + ((x0 + 1) % cells)]!;
        const c = lattice[((y0 + 1) % cells) * cells + (x0 % cells)]!;
        const d = lattice[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)]!;
        out[y * n + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      }
    }
    return out;
  };
  const patches = valueNoise(4);
  const mottle = valueNoise(16);
  // Blade streaks: long in x (a few texels), thin in z, wrapped.
  const streaks = new Float32Array(n * n);
  const blades = Math.floor((n * n) / 24);
  for (let i = 0; i < blades; i++) {
    const x = Math.floor(rnd() * n);
    const y = Math.floor(rnd() * n);
    const len = 3 + Math.floor(rnd() * 5);
    const v = rnd() < 0.5 ? -1 : 1;
    const w = 0.5 + rnd() * 0.5;
    for (let k = 0; k < len; k++) {
      const idx = y * n + ((x + k) % n);
      streaks[idx] = streaks[idx]! + v * w * (1 - k / len);
    }
  }
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const lum =
      0.9 + (patches[i]! - 0.5) * 0.14 + (mottle[i]! - 0.5) * 0.08 + streaks[i]! * 0.05 + (rnd() - 0.5) * 0.15;
    const v = Math.max(0, Math.min(255, Math.round(lum * 255)));
    data[i * 4] = v;
    data[i * 4 + 1] = Math.min(255, v + 4);
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function createGrassDetailTexture(maxAnisotropy: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(grassDetailPixels(), DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Markings (M1.2)
// ---------------------------------------------------------------------------

/**
 * Triangles of every line marking as flat [x, z] pairs (6 numbers per
 * triangle), counter-clockwise seen from above. Lines are LINE_WIDTH wide and
 * lie inside the boundaries they mark (outer edges on the rule lines, §2.2).
 * Pure: no three.js objects, so it can be unit-tested.
 */
export function buildMarkings(pitch: Pitch): Float32Array {
  const out: number[] = [];
  const lw = pitch.lineWidth;
  const { halfLength: hl, halfWidth: hw } = pitch;

  const rect = (x0: number, x1: number, z0: number, z1: number): void => {
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const za = Math.min(z0, z1);
    const zb = Math.max(z0, z1);
    out.push(xa, za, xa, zb, xb, zb, xa, za, xb, zb, xb, za);
  };
  /** Ring sector from angle a0 to a1 (a0 < a1), radii r0 < r1, angle measured from +x toward +z. */
  const arc = (cx: number, cz: number, r0: number, r1: number, a0: number, a1: number): void => {
    const segs = Math.max(4, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 192));
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segs;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      const c0 = Math.cos(t0);
      const s0 = Math.sin(t0);
      const c1 = Math.cos(t1);
      const s1 = Math.sin(t1);
      const p0x = cx + r0 * c0;
      const p0z = cz + r0 * s0;
      const p1x = cx + r1 * c0;
      const p1z = cz + r1 * s0;
      const p2x = cx + r1 * c1;
      const p2z = cz + r1 * s1;
      const p3x = cx + r0 * c1;
      const p3z = cz + r0 * s1;
      // Angle increases from +x toward +z, which is clockwise seen from above (+y),
      // so emit (inner0, inner1, outer1) / (inner0, outer1, outer0) for CCW-from-above.
      out.push(p0x, p0z, p3x, p3z, p2x, p2z, p0x, p0z, p2x, p2z, p1x, p1z);
    }
  };
  const disc = (cx: number, cz: number, r: number): void => {
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const t0 = (Math.PI * 2 * i) / segs;
      const t1 = (Math.PI * 2 * (i + 1)) / segs;
      out.push(cx, cz, cx + r * Math.cos(t1), cz + r * Math.sin(t1), cx + r * Math.cos(t0), cz + r * Math.sin(t0));
    }
  };

  // Touchlines and goal lines (outer edges on the boundary).
  rect(-hl, hl, hw - lw, hw);
  rect(-hl, hl, -hw, -hw + lw);
  rect(hl - lw, hl, -hw + lw, hw - lw);
  rect(-hl, -hl + lw, -hw + lw, hw - lw);
  // Halfway line, centered on x = 0, between the touchlines.
  rect(-lw / 2, lw / 2, -hw + lw, hw - lw);
  // Center circle and spot.
  arc(0, 0, pitch.centerCircleR - lw, pitch.centerCircleR, 0, Math.PI * 2);
  disc(pitch.centerSpot.x, pitch.centerSpot.z, SPOT_R);

  for (const end of pitch.ends) {
    const inward = -end.side;
    const gx = end.goalLineX; // outer edge of the goal line
    const lineInnerX = gx + inward * lw; // boxes start at the goal line's inner edge
    for (const [depth, width] of [
      [LAW1.PENALTY_AREA_DEPTH, LAW1.PENALTY_AREA_WIDTH],
      [LAW1.GOAL_AREA_DEPTH, LAW1.GOAL_AREA_WIDTH],
    ] as const) {
      const frontX = gx + inward * depth; // outer edge of the box's front line
      const hz = width / 2;
      rect(frontX, frontX - inward * lw, -hz, hz); // front line
      rect(lineInnerX, frontX - inward * lw, hz - lw, hz); // side lines
      rect(lineInnerX, frontX - inward * lw, -hz, -hz + lw);
    }
    disc(end.penaltyMark.x, end.penaltyMark.z, SPOT_R);
    const pa = end.penaltyArc;
    arc(pa.center.x, pa.center.z, pa.radius - lw, pa.radius, pa.arcStart, pa.arcEnd);
  }

  // Corner arcs: quarter circles of radius 1 (outer edge) inside the field.
  for (const c of pitch.corners) {
    const sx = Math.sign(c.x);
    const sz = Math.sign(c.z);
    const mid = Math.atan2(-sz, -sx);
    arc(c.x, c.z, pitch.cornerArcR - lw, pitch.cornerArcR, mid - Math.PI / 4, mid + Math.PI / 4);
  }

  return new Float32Array(out);
}

/** [x, z] pairs → [x, MARK_Y, z] triples. */
function liftMarkings(xz: Float32Array): Float32Array {
  const n = xz.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = xz[i * 2]!;
    out[i * 3 + 1] = MARK_Y;
    out[i * 3 + 2] = xz[i * 2 + 1]!;
  }
  return out;
}
