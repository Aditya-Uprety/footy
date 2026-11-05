// Ball mesh (PLAN M4.1): a procedural truncated-icosahedron panel texture,
// rolling / airborne rotation and a shadow (the sun's shadow map plus a soft
// contact blob that fades with height, for depth perception).
//
// The blob sits under the ball's *current* position only, so it never hints at
// where the ball will land (no aim aids, CLAUDE.md).
import * as THREE from 'three';
import { PHYS } from '../sim/constants';

/** Texture size (equirectangular, 2:1). */
const TEX_W = 512;
const TEX_H = 256;
/** Truncated icosahedron angular inradii (pentagon / hexagon), rad. */
const PENT_IN = 16.47 * (Math.PI / 180);
const HEX_IN = 20.9 * (Math.PI / 180);
/** Seam half-width in normalized cell distance. */
const SEAM = 0.035;

const COLORS = {
  hex: [244, 245, 240],
  pent: [24, 30, 46],
  seam: [150, 154, 160],
} as const;

/** Unit directions of the 12 icosahedron vertices (pentagon centers) and 20 face centers (hexagon centers). */
function panelCenters(): { pent: THREE.Vector3[]; hex: THREE.Vector3[] } {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.getAttribute('position');
  const pent: THREE.Vector3[] = [];
  const hex: THREE.Vector3[] = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let f = 0; f < pos.count / 3; f++) {
    for (let k = 0; k < 3; k++) {
      v[k]!.fromBufferAttribute(pos, f * 3 + k).normalize();
      if (!pent.some((p) => p.distanceToSquared(v[k]!) < 1e-6)) pent.push(v[k]!.clone());
    }
    hex.push(v[0]!.clone().add(v[1]!).add(v[2]!).normalize());
  }
  ico.dispose();
  return { pent, hex };
}

/**
 * Paints the panel texture: every texel's direction is classified to the
 * nearest panel center, scaled by that panel's angular inradius (a cheap
 * approximation of the truncated icosahedron's cells), with grey seams where
 * two cells meet.
 */
function makePanelTextures(): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TEX_W, TEX_H);
  // Height map for the stitched seams: panels high, seams low.
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = TEX_W;
  bumpCanvas.height = TEX_H;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(TEX_W, TEX_H);
  const { pent, hex } = panelCenters();
  const centers = [...pent.map((c) => ({ c, s: 1 / PENT_IN, pent: true })), ...hex.map((c) => ({ c, s: 1 / HEX_IN, pent: false }))];
  const d = new THREE.Vector3();
  for (let j = 0; j < TEX_H; j++) {
    // SphereGeometry UVs: v = 1 at the top (+y); phi measured from +y.
    const theta = ((j + 0.5) / TEX_H) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let i = 0; i < TEX_W; i++) {
      const phi = ((i + 0.5) / TEX_W) * Math.PI * 2;
      // Matches SphereGeometry: x = −cos(phi)·sin(theta), y = cos(theta), z = sin(phi)·sin(theta).
      d.set(-Math.cos(phi) * st, ct, Math.sin(phi) * st);
      let best = Infinity;
      let second = Infinity;
      let bestPent = false;
      for (const k of centers) {
        const a = Math.acos(Math.min(1, Math.max(-1, d.dot(k.c)))) * k.s;
        if (a < best) {
          second = best;
          best = a;
          bestPent = k.pent;
        } else if (a < second) {
          second = a;
        }
      }
      const isSeam = second - best < SEAM;
      const col = isSeam ? COLORS.seam : bestPent ? COLORS.pent : COLORS.hex;
      const o = (j * TEX_W + i) * 4;
      // Soft shoulder next to the seam so the groove reads at a distance.
      const h = isSeam ? 40 : second - best < SEAM * 2.2 ? 170 : 235;
      bumpImg.data[o] = h;
      bumpImg.data[o + 1] = h;
      bumpImg.data[o + 2] = h;
      bumpImg.data[o + 3] = 255;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.anisotropy = 4;
  return { color: tex, bump };
}

/** Soft radial blob for the contact shadow. */
function makeBlobTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export interface BallView {
  /** Root object; its position is the ball's center. */
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  /** Moves the ball (center) and the contact blob under it. */
  setPosition(x: number, y: number, z: number): void;
  /** Rolls the ball by a horizontal displacement: angle = distance / r about ŷ × v̂. */
  roll(dx: number, dz: number): void;
  /** Spins the ball by angular velocity ω (rad/s) for dt seconds. */
  spin(wx: number, wy: number, wz: number, dt: number): void;
  /** Resets the orientation (e.g. before a replay). */
  resetRotation(): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

export interface BallOptions {
  /** Ball radius, m (default PHYS.BALL_R). */
  radius?: number;
}

const BLOB_Y = 0.012;
/** The blob fades out completely by this height, m. */
const BLOB_FADE_H = 12;

export function createBallView(opts: BallOptions = {}): BallView {
  const r = opts.radius ?? PHYS.BALL_R;
  const group = new THREE.Group();
  group.name = 'ball';

  const { color: tex, bump: bumpTex } = makePanelTextures();
  const geo = new THREE.SphereGeometry(r, 40, 28);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    bumpMap: bumpTex,
    bumpScale: 0.6,
    roughness: 0.42,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ball-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  group.add(mesh);

  // Contact blob: a ground-hugging quad, kept in world space (not a child of the ball).
  const blobTex = makeBlobTexture();
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({
    map: blobTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.name = 'ball-blob';
  blob.renderOrder = 2;
  const blobHolder = new THREE.Group();
  blobHolder.name = 'ball-blob-holder';
  blobHolder.add(blob);

  // The outer group holds both so callers add one object to the scene.
  const root = new THREE.Group();
  root.name = 'ball-root';
  root.add(group, blobHolder);

  const axis = new THREE.Vector3();
  const q = new THREE.Quaternion();

  function setPosition(x: number, y: number, z: number): void {
    group.position.set(x, y, z);
    const h = Math.max(0, y - r);
    const k = Math.min(1, h / BLOB_FADE_H);
    blob.position.set(x, BLOB_Y, z);
    const s = r * 2.6 * (1 + 1.8 * k);
    blob.scale.set(s, 1, s);
    blobMat.opacity = 0.55 * (1 - k) * (1 - k);
    blob.visible = blobMat.opacity > 0.01;
  }

  function rotate(ax: number, ay: number, az: number, angle: number): void {
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (len < 1e-9 || Math.abs(angle) < 1e-9) return;
    axis.set(ax / len, ay / len, az / len);
    q.setFromAxisAngle(axis, angle);
    mesh.quaternion.premultiply(q);
  }

  setPosition(0, r, 0);

  return {
    group: root,
    mesh,
    setPosition,
    roll(dx, dz) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Axis ŷ × v̂ = (vz, 0, −vx)/|v|.
      if (dist > 0) rotate(dz, 0, -dx, dist / r);
    },
    spin(wx, wy, wz, dt) {
      const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (w > 0) rotate(wx, wy, wz, w * dt);
    },
    resetRotation() {
      mesh.quaternion.identity();
    },
    setVisible(v) {
      root.visible = v;
    },
    dispose() {
      root.removeFromParent();
      geo.dispose();
      mat.dispose();
      tex.dispose();
      bumpTex.dispose();
      blobGeo.dispose();
      blobMat.dispose();
      blobTex.dispose();
    },
  };
}
