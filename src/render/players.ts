// Player meshes (PLAN M4.2): placeholder figures until the M12 humanoids.
// Each figure is one merged, vertex-coloured mesh (body in the kit colour,
// shorts, legs, head) plus a shirt-number sprite. Keepers are bigger with an
// arms-spread silhouette. Figures always stay inside their physics hitbox
// (§5.2). Under ?debug (and in the Lab) the exact hitboxes are drawn as
// wireframes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HITBOX, type HitboxShape } from '../sim/constants';
import type { Team } from '../sim/types';

/** What the view needs to draw a player (game PlayerSpot fits). */
export interface PlayerVisual {
  id: number;
  team: Team;
  x: number;
  z: number;
  gk: boolean;
  /** Shirt number (GK 1, others 2–11). Defaults to the id. */
  shirt?: number;
  /** Facing yaw, rad (d̂ = (cos, 0, sin)). Defaults to facing the opponent's goal. */
  yaw?: number;
}

/** Default kits (§2.1.3): A red, B blue; keepers yellow (A) and green (B). */
export const KIT_COLORS: Readonly<Record<Team, { outfield: number; gk: number }>> = {
  0: { outfield: 0xd8352f, gk: 0xf0cf2a },
  1: { outfield: 0x2c63d6, gk: 0x34b35a },
};

const SKIN = 0xe0b48e;
const SHORTS = 0xf2f2f2;
const SOCKS = 0x1d1d22;

function painted(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/**
 * One placeholder figure, standing at the origin and facing +x, as a single
 * vertex-coloured geometry. Exported for the "fits inside the hitbox" test.
 */
export function buildFigureGeometry(gk: boolean, kitHex: number): THREE.BufferGeometry {
  const s = gk ? 1.06 : 1; // keepers are a little bigger
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number): void => {
    parts.push(painted(g, hex));
  };

  // Legs (socks), two thin cylinders from the ground to the shorts.
  const legH = 0.78 * s;
  for (const side of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.075 * s, 0.065 * s, legH, 10);
    leg.translate(0, legH / 2, side * 0.11 * s);
    add(leg, SOCKS);
  }
  // Shorts.
  const shorts = new THREE.CylinderGeometry(0.2 * s, 0.21 * s, 0.24 * s, 14);
  shorts.translate(0, legH + 0.08 * s, 0);
  add(shorts, SHORTS);
  // Torso (kit colour): a capsule from the waist to the shoulders.
  const torsoLen = 0.42 * s;
  const torsoR = 0.2 * s;
  const torso = new THREE.CapsuleGeometry(torsoR, torsoLen, 4, 14);
  const torsoY = legH + 0.2 * s + torsoLen / 2 + 0.04 * s;
  torso.scale(0.8, 1, 1); // slightly flatter front-to-back
  torso.translate(0, torsoY, 0);
  add(torso, kitHex);
  const shoulderY = torsoY + torsoLen / 2;
  // Head.
  const headR = 0.12 * s;
  const head = new THREE.SphereGeometry(headR, 14, 10);
  head.translate(0, shoulderY + 0.2 * s + headR * 0.6, 0);
  add(head, SKIN);

  // Arms: by the sides for outfield players, spread up and out for keepers.
  const armLen = gk ? 0.5 : 0.58;
  for (const side of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.055 * s, armLen, 3, 8);
    arm.translate(0, -armLen / 2, 0); // pivot at the shoulder
    // Outfield: hanging, slightly away from the body. GK: spread out, just above horizontal.
    const angle = gk ? (100 * Math.PI) / 180 : (7 * Math.PI) / 180;
    arm.rotateX(-side * angle);
    arm.translate(0, shoulderY - 0.04 * s, side * (torsoR + 0.02));
    add(arm, gk ? kitHex : SKIN);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('players: could not merge figure geometry');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Wireframe of a hitbox (§5.2): open cylinder to HC plus the hemisphere cap. */
export function buildHitboxGeometry(shape: HitboxShape): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(shape.R, shape.R, shape.HC, 20, 2, true);
  cyl.translate(0, shape.HC / 2, 0);
  const cap = new THREE.SphereGeometry(shape.R, 20, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, shape.HC, 0);
  const a = new THREE.WireframeGeometry(cyl);
  const b = new THREE.WireframeGeometry(cap);
  cyl.dispose();
  cap.dispose();
  const merged = mergeGeometries([a, b], false)!;
  a.dispose();
  b.dispose();
  return merged;
}

/** Shirt-number sprite textures, cached per number. */
function numberTexture(n: number): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${n >= 10 ? 38 : 44}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(String(n), size / 2, size / 2 + 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(n), size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface PlayersView {
  readonly group: THREE.Group;
  /** Replaces the drawn players. */
  setPlayers(list: readonly PlayerVisual[]): void;
  /** Hides one player's figure (e.g. the kicker in the aim view), or none. */
  setHidden(id: number | null): void;
  /** Turns one player to face yaw (d̂ = (cos, 0, sin)); e.g. the kicker after a kick. */
  setYaw(id: number, yaw: number): void;
  setHitboxesVisible(v: boolean): void;
  /** Figure + hitbox meshes for raycasting; each carries userData.playerId. */
  pickTargets(): THREE.Object3D[];
  /** Player id of a raycast hit object, or null. */
  idOf(obj: THREE.Object3D): number | null;
  dispose(): void;
}

export interface PlayersOptions {
  /** Draw the hitbox wireframes (?debug / Lab). */
  hitboxes?: boolean;
}

interface Entry {
  root: THREE.Group;
  figure: THREE.Mesh;
}

/** Height of the number sprite's center above a figure's hitbox top, m. */
const NUMBER_GAP = 0.35;
const NUMBER_SIZE = 0.5;

export function createPlayersView(opts: PlayersOptions = {}): PlayersView {
  const group = new THREE.Group();
  group.name = 'players';

  const figureMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const figureGeos = new Map<string, THREE.BufferGeometry>();
  const figureGeo = (team: Team, gk: boolean): THREE.BufferGeometry => {
    const key = `${team}:${gk ? 'gk' : 'of'}`;
    let g = figureGeos.get(key);
    if (!g) {
      g = buildFigureGeometry(gk, gk ? KIT_COLORS[team].gk : KIT_COLORS[team].outfield);
      figureGeos.set(key, g);
    }
    return g;
  };

  const hitGeos = { of: buildHitboxGeometry(HITBOX.OUTFIELD), gk: buildHitboxGeometry(HITBOX.GK) };
  const hitMats = {
    of: new THREE.LineBasicMaterial({ color: 0xffee55, transparent: true, opacity: 0.7 }),
    gk: new THREE.LineBasicMaterial({ color: 0xff55dd, transparent: true, opacity: 0.8 }),
  };
  const numberMats = new Map<number, THREE.SpriteMaterial>();
  const numberMat = (n: number): THREE.SpriteMaterial => {
    let m = numberMats.get(n);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: numberTexture(n), depthWrite: false, transparent: true });
      numberMats.set(n, m);
    }
    return m;
  };

  let hitboxesVisible = !!opts.hitboxes;
  let hiddenId: number | null = null;
  const entries = new Map<number, Entry>();
  const hitboxes: THREE.LineSegments[] = [];

  function clearAll(): void {
    for (const e of entries.values()) e.root.removeFromParent();
    entries.clear();
    hitboxes.length = 0;
  }

  return {
    group,
    setPlayers(list) {
      clearAll();
      for (const p of list) {
        const root = new THREE.Group();
        root.name = `player-${p.id}`;
        root.position.set(p.x, 0, p.z);
        // Facing: rotation.y = −yaw turns local +x into d̂ = (cos yaw, 0, sin yaw).
        const yaw = p.yaw ?? (p.team === 0 ? 0 : Math.PI);
        root.rotation.y = -yaw;
        root.userData.playerId = p.id;

        const figure = new THREE.Mesh(figureGeo(p.team, p.gk), figureMat);
        figure.name = 'player-figure';
        figure.castShadow = true;
        figure.receiveShadow = true;
        figure.userData.playerId = p.id;
        root.add(figure);

        const shape = p.gk ? HITBOX.GK : HITBOX.OUTFIELD;
        const sprite = new THREE.Sprite(numberMat(p.shirt ?? p.id));
        sprite.name = 'player-number';
        sprite.scale.set(NUMBER_SIZE, NUMBER_SIZE, 1);
        sprite.position.y = shape.HC + shape.R + NUMBER_GAP;
        root.add(sprite);

        const hb = new THREE.LineSegments(p.gk ? hitGeos.gk : hitGeos.of, p.gk ? hitMats.gk : hitMats.of);
        hb.name = 'debug-hitbox';
        hb.userData.playerId = p.id;
        hb.visible = hitboxesVisible;
        root.add(hb);
        hitboxes.push(hb);

        root.visible = p.id !== hiddenId;
        group.add(root);
        entries.set(p.id, { root, figure });
      }
    },
    setHidden(id) {
      hiddenId = id;
      for (const [pid, e] of entries) e.root.visible = pid !== id;
    },
    setYaw(id, yaw) {
      const e = entries.get(id);
      if (e) e.root.rotation.y = -yaw;
    },
    setHitboxesVisible(v) {
      hitboxesVisible = v;
      for (const hb of hitboxes) hb.visible = v;
    },
    pickTargets() {
      return [...entries.values()].map((e) => e.figure);
    },
    idOf(obj) {
      for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
        if (typeof o.userData.playerId === 'number') return o.userData.playerId as number;
      }
      return null;
    },
    dispose() {
      clearAll();
      group.removeFromParent();
      for (const g of figureGeos.values()) g.dispose();
      figureMat.dispose();
      hitGeos.of.dispose();
      hitGeos.gk.dispose();
      hitMats.of.dispose();
      hitMats.gk.dispose();
      for (const m of numberMats.values()) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}
