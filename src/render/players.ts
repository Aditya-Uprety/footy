// Player meshes (PLAN M4.2, M12.1): low-poly humanoids built from primitives.
// Each figure is one merged, vertex-coloured mesh (kit shirt and sleeves,
// shorts, socks, boots, skin, hair, gloves) plus a shirt number on the back
// and a number sprite above the head. Keepers are bigger, in their own kit,
// with gloves and an arms-spread pose. Figures always stay inside their
// physics hitbox (§5.2). Players idle with a slow sway. Under ?debug (and in
// the Lab) the exact hitboxes are drawn as wireframes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HITBOX, type HitboxShape } from '../sim/constants';
import type { Team } from '../sim/types';
import type { Stage } from './scene';

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

/** Shorts / socks / glove colours (outfield shorts white; keepers dark with white gloves). */
const SHORTS = 0xf2f2f2;
const GK_DARK = 0x25252b;
const GLOVES = 0xf4f4f4;
const BOOTS = 0x17171b;
const SKIN_TONES = [0xf1c9a5, 0xd9a47a, 0xa8714b, 0x6b4430] as const;
const HAIR_COLORS = [0x1b1410, 0x4a2c17, 0xc9a24a, 0x7a3a1c, 0x2a2a2e] as const;

/** Per-player look: skin tone, hair colour and style. */
export interface Look {
  skin: number;
  hair: number;
  /** 0 = cropped, 1 = fuller on top, 2 = shaved (hair is skin-coloured stubble). */
  style: 0 | 1 | 2;
}

/** A deterministic look for a player id (so both devices draw the same people). */
export function lookFor(id: number): Look {
  const skinIx = (id * 5 + 1) % SKIN_TONES.length;
  const hairIx = (id * 3 + (id >> 2)) % HAIR_COLORS.length;
  const style = (id % 7 === 0 ? 2 : id % 2) as 0 | 1 | 2;
  const skin = SKIN_TONES[skinIx]!;
  return { skin, hair: style === 2 ? skin : HAIR_COLORS[hairIx]!, style };
}

const DEFAULT_LOOK: Look = { skin: SKIN_TONES[0], hair: HAIR_COLORS[0], style: 0 };

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
 * One humanoid figure, standing at the origin and facing +x, as a single
 * vertex-coloured geometry (≈ 1.8 m outfield, a little bigger for keepers).
 * Exported for the "fits inside the hitbox" test.
 */
export function buildFigureGeometry(gk: boolean, kitHex: number, look: Look = DEFAULT_LOOK): THREE.BufferGeometry {
  const s = gk ? 1.06 : 1; // keepers are a little bigger
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number): void => {
    parts.push(painted(g, hex));
  };
  /** Vertical tube from y0 to y1 at (x, z), radii top → bottom (all scaled by s). */
  const tube = (rTop: number, rBot: number, y0: number, y1: number, x: number, z: number, hex: number, seg = 10): void => {
    const g = new THREE.CylinderGeometry(rTop * s, rBot * s, (y1 - y0) * s, seg);
    g.translate(x * s, ((y0 + y1) / 2) * s, z * s);
    add(g, hex);
  };

  const shortsHex = gk ? GK_DARK : SHORTS;
  const sockHex = gk ? GK_DARK : kitHex;
  const sleeveHex = kitHex; // keepers wear long sleeves; outfield sleeves stop at the elbow

  // Legs: boot, sock, bare knee, shorts leg.
  for (const side of [-1, 1]) {
    const z = side * 0.1;
    const boot = new THREE.BoxGeometry(0.27 * s, 0.09 * s, 0.11 * s);
    boot.translate(0.05 * s, 0.045 * s, z * s);
    add(boot, BOOTS);
    tube(0.052, 0.058, 0.08, 0.5, 0, z, sockHex);
    tube(0.06, 0.056, 0.5, 0.58, 0, z, look.skin, 8);
    tube(0.1, 0.082, 0.56, 0.92, 0, z, shortsHex, 12);
  }
  // Hips / waistband.
  const hips = new THREE.CylinderGeometry(0.185 * s, 0.19 * s, 0.14 * s, 16);
  hips.scale(0.82, 1, 1);
  hips.translate(0, 0.86 * s, 0);
  add(hips, shortsHex);

  // Torso (shirt): a capsule from the waist to the shoulders, a bit flat front-to-back.
  const torsoR = 0.18 * s;
  const torsoLen = 0.3 * s;
  const torsoBottom = 0.84 * s;
  const torsoY = torsoBottom + torsoR + torsoLen / 2;
  const torso = new THREE.CapsuleGeometry(torsoR, torsoLen, 4, 14);
  torso.scale(0.82, 1, 1);
  torso.translate(0, torsoY, 0);
  add(torso, kitHex);
  const shoulderY = torsoY + torsoLen / 2 + 0.02 * s;

  // Neck and head.
  tube(0.05, 0.055, 1.46, 1.58, 0.01, 0, look.skin, 8);
  const headR = 0.115 * s;
  const headY = 1.67 * s;
  const head = new THREE.SphereGeometry(headR, 16, 12);
  head.scale(1.05, 1.1, 0.95); // a touch longer than wide
  head.translate(0.01 * s, headY, 0);
  add(head, look.skin);
  // Hair: a cap on the top/back of the head, tilted so the forehead shows.
  const hairR = headR * (look.style === 1 ? 1.1 : 1.04);
  const hair = new THREE.SphereGeometry(hairR, 16, 8, 0, Math.PI * 2, 0, Math.PI * (look.style === 1 ? 0.62 : 0.55));
  hair.scale(1.05, 1.1, 0.97);
  hair.rotateZ(0.42);
  hair.translate(0.01 * s, headY, 0);
  add(hair, look.hair);
  // Ears.
  for (const side of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.025 * s, 6, 5);
    ear.translate(0, headY - 0.01 * s, side * (headR * 0.93));
    add(ear, look.skin);
  }

  // Arms: pivot at the shoulder, built hanging down (−y) then rotated about x.
  // Outfield: by the sides, slightly away from the body. Keepers: spread out.
  const upper = gk ? 0.24 : 0.25;
  const lower = gk ? 0.2 : 0.25;
  const armR = 0.05 * s;
  const angle = gk ? (100 * Math.PI) / 180 : (9 * Math.PI) / 180;
  for (const side of [-1, 1]) {
    const arm: THREE.BufferGeometry[] = [];
    const seg = (g: THREE.BufferGeometry, hex: number): void => {
      arm.push(painted(g, hex));
    };
    const up = new THREE.CylinderGeometry(armR * 1.05, armR, upper * s, 8);
    up.translate(0, (-upper / 2) * s, 0);
    seg(up, sleeveHex);
    const lo = new THREE.CylinderGeometry(armR, armR * 0.85, lower * s, 8);
    lo.translate(0, (-upper - lower / 2) * s, 0);
    seg(lo, gk ? sleeveHex : look.skin);
    const handR = (gk ? 0.068 : 0.048) * s;
    const hand = new THREE.SphereGeometry(handR, 8, 6);
    hand.translate(0, (-upper - lower - handR / s * 0.8) * s, 0);
    seg(hand, gk ? GLOVES : look.skin);
    const limb = mergeGeometries(arm, false)!;
    for (const a of arm) a.dispose();
    limb.rotateX(-side * angle);
    limb.translate(0, shoulderY - 0.04 * s, side * (torsoR * 0.95 + armR * 0.9));
    parts.push(limb);
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
  /** The render loop; gives the players their idle sway. Without it they stand still. */
  stage?: Pick<Stage, 'onFrame'>;
}

interface Entry {
  root: THREE.Group;
  figure: THREE.Mesh;
  /** Idle-sway phase offset, rad (so the team doesn't move in lockstep). */
  phase: number;
}

/** Idle sway: a slow lean about the feet, plus a faint breathing stretch. */
const SWAY_LEAN = 0.018; // rad, ≈ 1°
const SWAY_BREATH = 0.004;
/** Pure sway pose at time t (s) for a phase, exported for the test. */
export function swayPose(t: number, phase: number): { lean: number; nod: number; stretch: number } {
  return {
    lean: Math.sin(t * 0.9 + phase) * SWAY_LEAN,
    nod: Math.sin(t * 0.63 + phase * 1.7 + 1) * SWAY_LEAN * 0.6,
    stretch: 1 + Math.sin(t * 1.7 + phase) * SWAY_BREATH,
  };
}

/** Height of the number sprite's center above a figure's hitbox top, m. */
const NUMBER_GAP = 0.35;
const NUMBER_SIZE = 0.5;

export function createPlayersView(opts: PlayersOptions = {}): PlayersView {
  const group = new THREE.Group();
  group.name = 'players';

  const figureMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const figureGeos = new Map<string, THREE.BufferGeometry>();
  const figureGeo = (team: Team, gk: boolean, id: number): THREE.BufferGeometry => {
    const look = lookFor(id);
    const key = `${team}:${gk ? 'gk' : 'of'}:${look.skin}:${look.hair}:${look.style}`;
    let g = figureGeos.get(key);
    if (!g) {
      g = buildFigureGeometry(gk, gk ? KIT_COLORS[team].gk : KIT_COLORS[team].outfield, look);
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

  // Shirt number on the back (a small plane just behind the torso, facing −x).
  const backGeo = new THREE.PlaneGeometry(0.19, 0.19);
  backGeo.rotateY(-Math.PI / 2);
  const backMats = new Map<number, THREE.MeshBasicMaterial>();
  const backMat = (n: number): THREE.MeshBasicMaterial => {
    let m = backMats.get(n);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: numberTexture(n), transparent: true, alphaTest: 0.35, depthWrite: false, fog: true });
      backMats.set(n, m);
    }
    return m;
  };

  let hitboxesVisible = !!opts.hitboxes;
  let hiddenId: number | null = null;
  const entries = new Map<number, Entry>();
  const hitboxes: THREE.LineSegments[] = [];

  let clock = 0;
  const offFrame = opts.stage?.onFrame((dt) => {
    clock += dt;
    for (const e of entries.values()) {
      if (!e.root.visible) continue;
      const { lean, nod, stretch } = swayPose(clock, e.phase);
      e.figure.rotation.set(lean, 0, nod); // about the feet (the figure's origin)
      e.figure.scale.y = stretch;
    }
  });

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

        const figure = new THREE.Mesh(figureGeo(p.team, p.gk, p.id), figureMat);
        figure.name = 'player-figure';
        figure.castShadow = true;
        figure.receiveShadow = true;
        figure.userData.playerId = p.id;
        root.add(figure);

        const sc = p.gk ? 1.06 : 1;
        const back = new THREE.Mesh(backGeo, backMat(p.shirt ?? p.id));
        back.name = 'player-back-number';
        back.position.set(-0.18 * 0.82 * sc - 0.012, 1.2 * sc, 0);
        back.scale.setScalar(sc);
        figure.add(back);

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
        entries.set(p.id, { root, figure, phase: (p.id * 2.399) % (Math.PI * 2) });
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
      offFrame?.();
      clearAll();
      group.removeFromParent();
      backGeo.dispose();
      for (const m of backMats.values()) {
        m.map?.dispose();
        m.dispose();
      }
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
