// Player meshes (PLAN M4.2, M12.1, M12.2): low-poly humanoids built from primitives.
// Each figure is one merged, vertex-coloured mesh (kit shirt and sleeves,
// shorts, socks, boots, skin, hair, gloves) plus a shirt number on the back
// and a number sprite above the head. Keepers are bigger, in their own kit,
// with gloves and an arms-spread pose. Figures always stay inside their
// physics hitbox (§5.2). Players idle with a slow sway. The kicker plays a
// wind-up and kick, a keeper a catch pose, and the player on the ball can wear a
// ring on the ground (M12.2). Animating players swap their merged mesh for a
// small rig (body + legs + arms) so the idle draw-call count stays low. Under
// ?debug (and in the Lab) the exact hitboxes are drawn as wireframes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { activeKitPair, kitOf } from '../shared/kits';
import { angleDiff } from '../shared/math';
import { HITBOX, type HitboxShape } from '../sim/constants';
import type { Team } from '../sim/types';
import {
  catchPose,
  copyPose,
  IDLE_POSE,
  KICK_DURATION,
  kickPose,
  relaxPose,
  RELAX_TIME,
  ringPulse,
  windupPose,
  type Pose,
} from './figureAnim';
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

/** The active kit pair's colors (§2.1.3; chosen in the lobby settings, shared/kits.ts). */
export const KIT_COLORS: Readonly<Record<Team, { outfield: number; gk: number }>> = {
  get 0() {
    return kitOf(0);
  },
  get 1() {
    return kitOf(1);
  },
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

/** The animatable pieces of a figure (M12.2): the body plus one leg and one arm, each built around its joint. */
export interface FigureParts {
  /** Keepers are a little bigger. */
  scale: number;
  /** Everything that doesn't move on its own: hips, torso, neck, head, hair, ears. */
  body: THREE.BufferGeometry;
  /** A leg hanging from the hip (origin = hip joint); the same shape for both sides. */
  leg: THREE.BufferGeometry;
  /** An arm hanging from the shoulder (origin = shoulder joint); the same shape for both sides. */
  arm: THREE.BufferGeometry;
  /** Joint positions for the +z (right) side; the left side mirrors z. */
  hip: { y: number; z: number };
  shoulder: { y: number; z: number };
  /** Resting spread of the arms about the forward axis, rad. */
  armRest: number;
}

function mergeAndFree(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('players: could not merge figure geometry');
  return merged;
}

/** The pieces of one humanoid figure, facing +x, standing at the origin. */
export function buildFigureParts(gk: boolean, kitHex: number, look: Look = DEFAULT_LOOK): FigureParts {
  const s = gk ? 1.06 : 1; // keepers are a little bigger
  const shortsHex = gk ? GK_DARK : SHORTS;
  const sockHex = gk ? GK_DARK : kitHex;
  const sleeveHex = kitHex; // keepers wear long sleeves; outfield sleeves stop at the elbow
  const add = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, hex: number): void => {
    list.push(painted(g, hex));
  };
  /** Vertical tube from y0 to y1 at (x, 0), radii top → bottom (all scaled by s). */
  const tube = (list: THREE.BufferGeometry[], rTop: number, rBot: number, y0: number, y1: number, x: number, hex: number, seg = 10): void => {
    const g = new THREE.CylinderGeometry(rTop * s, rBot * s, (y1 - y0) * s, seg);
    g.translate(x * s, ((y0 + y1) / 2) * s, 0);
    add(list, g, hex);
  };

  // Leg: boot, sock, bare knee, shorts leg — built standing, then moved so the hip is the origin.
  const hipY = 0.86 * s;
  const legParts: THREE.BufferGeometry[] = [];
  const boot = new THREE.BoxGeometry(0.27 * s, 0.09 * s, 0.11 * s);
  boot.translate(0.05 * s, 0.045 * s, 0);
  add(legParts, boot, BOOTS);
  tube(legParts, 0.052, 0.058, 0.08, 0.5, 0, sockHex);
  tube(legParts, 0.06, 0.056, 0.5, 0.58, 0, look.skin, 8);
  tube(legParts, 0.1, 0.082, 0.56, 0.92, 0, shortsHex, 12);
  const leg = mergeAndFree(legParts);
  leg.translate(0, -hipY, 0);

  const bodyParts: THREE.BufferGeometry[] = [];
  // Hips / waistband.
  const hips = new THREE.CylinderGeometry(0.185 * s, 0.19 * s, 0.14 * s, 16);
  hips.scale(0.82, 1, 1);
  hips.translate(0, 0.86 * s, 0);
  add(bodyParts, hips, shortsHex);

  // Torso (shirt): a capsule from the waist to the shoulders, a bit flat front-to-back.
  const torsoR = 0.18 * s;
  const torsoLen = 0.3 * s;
  const torsoBottom = 0.84 * s;
  const torsoY = torsoBottom + torsoR + torsoLen / 2;
  const torso = new THREE.CapsuleGeometry(torsoR, torsoLen, 4, 14);
  torso.scale(0.82, 1, 1);
  torso.translate(0, torsoY, 0);
  add(bodyParts, torso, kitHex);
  const shoulderY = torsoY + torsoLen / 2 + 0.02 * s;

  // Neck and head.
  tube(bodyParts, 0.05, 0.055, 1.46, 1.58, 0.01, look.skin, 8);
  const headR = 0.115 * s;
  const headY = 1.67 * s;
  const head = new THREE.SphereGeometry(headR, 16, 12);
  head.scale(1.05, 1.1, 0.95); // a touch longer than wide
  head.translate(0.01 * s, headY, 0);
  add(bodyParts, head, look.skin);
  // Hair: a cap on the top/back of the head, tilted so the forehead shows.
  const hairR = headR * (look.style === 1 ? 1.1 : 1.04);
  const hair = new THREE.SphereGeometry(hairR, 16, 8, 0, Math.PI * 2, 0, Math.PI * (look.style === 1 ? 0.62 : 0.55));
  hair.scale(1.05, 1.1, 0.97);
  hair.rotateZ(0.42);
  hair.translate(0.01 * s, headY, 0);
  add(bodyParts, hair, look.hair);
  // Ears.
  for (const side of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.025 * s, 6, 5);
    ear.translate(0, headY - 0.01 * s, side * (headR * 0.93));
    add(bodyParts, ear, look.skin);
  }

  // Arm: hangs down (−y) from the shoulder joint. Outfield rests slightly away
  // from the body; keepers spread (the rest spread is applied by the caller).
  const upper = gk ? 0.32 : 0.25; // M17: longer keeper arms for the wider reach
  const lower = gk ? 0.28 : 0.25;
  const armR = 0.05 * s;
  const armParts: THREE.BufferGeometry[] = [];
  const up = new THREE.CylinderGeometry(armR * 1.05, armR, upper * s, 8);
  up.translate(0, (-upper / 2) * s, 0);
  add(armParts, up, sleeveHex);
  const lo = new THREE.CylinderGeometry(armR, armR * 0.85, lower * s, 8);
  lo.translate(0, (-upper - lower / 2) * s, 0);
  add(armParts, lo, gk ? sleeveHex : look.skin);
  const handR = (gk ? 0.068 : 0.048) * s;
  const hand = new THREE.SphereGeometry(handR, 8, 6);
  hand.translate(0, (-upper - lower - (handR / s) * 0.8) * s, 0);
  add(armParts, hand, gk ? GLOVES : look.skin);

  return {
    scale: s,
    body: mergeAndFree(bodyParts),
    leg,
    arm: mergeAndFree(armParts),
    hip: { y: hipY, z: 0.1 * s },
    shoulder: { y: shoulderY - 0.04 * s, z: torsoR * 0.95 + armR * 0.9 },
    armRest: gk ? (100 * Math.PI) / 180 : (9 * Math.PI) / 180,
  };
}

export function disposeFigureParts(p: FigureParts): void {
  p.body.dispose();
  p.leg.dispose();
  p.arm.dispose();
}

/**
 * One humanoid figure, standing at the origin and facing +x, as a single
 * vertex-coloured geometry (≈ 1.8 m outfield, a little bigger for keepers):
 * the animatable parts merged in their resting pose.
 * Exported for the "fits inside the hitbox" test.
 */
export function buildFigureGeometry(gk: boolean, kitHex: number, look: Look = DEFAULT_LOOK): THREE.BufferGeometry {
  const p = buildFigureParts(gk, kitHex, look);
  const parts: THREE.BufferGeometry[] = [p.body.clone()];
  for (const side of [-1, 1]) {
    parts.push(p.leg.clone().translate(0, p.hip.y, side * p.hip.z));
    parts.push(
      p.arm
        .clone()
        .rotateX(-side * p.armRest)
        .translate(0, p.shoulder.y, side * p.shoulder.z),
    );
  }
  disposeFigureParts(p);
  const merged = mergeAndFree(parts);
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
  /** The player on the ball gets a ring on the ground (null = none). Hidden while that player's figure is hidden. */
  setPossessor(id: number | null): void;
  /** The kicker draws the leg back (follows the flow's wind-up). */
  playWindup(id: number): void;
  /** The kicker strikes the ball and follows through (continues a wind-up if there was one). */
  playKick(id: number): void;
  /** A keeper catches a ball at `ball`: turns toward it and brings the arms together, held until `relax`. */
  playCatch(id: number, ball: { x: number; y: number; z: number }): void;
  /** Everybody eases back to standing (a new turn begins). */
  relax(): void;
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

interface Rig {
  group: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
}

/** What a figure is doing besides standing around. */
interface Anim {
  kind: 'windup' | 'kick' | 'catch' | 'relax';
  /** Seconds since it began. */
  t: number;
  /** The pose it began from (so one animation flows into the next). */
  from: Pose;
  ballY?: number;
  /** Catch: turn toward this yaw over TURN_TIME. */
  yawFrom?: number;
  yawTo?: number;
}

interface Entry {
  root: THREE.Group;
  /** Gets the idle sway (and a lean while animating); holds the figure or the rig and the back number. */
  sway: THREE.Group;
  /** The merged resting figure (what is drawn when nothing animates, and what raycasts hit). */
  figure: THREE.Mesh;
  /** The jointed figure, built the first time the player animates. */
  rig: Rig | null;
  gk: boolean;
  team: Team;
  /** Key of the cached figure parts. */
  partsKey: string;
  look: Look;
  anim: Anim | null;
  /** The pose last drawn. */
  pose: Pose;
  /** Idle-sway phase offset, rad (so the team doesn't move in lockstep). */
  phase: number;
}

/** Seconds a catching keeper takes to turn toward the ball. */
const TURN_TIME = 0.15;

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
  const partsCache = new Map<string, FigureParts>();
  const keyFor = (team: Team, gk: boolean, look: Look): string =>
    `${activeKitPair()}:${team}:${gk ? 'gk' : 'of'}:${look.skin}:${look.hair}:${look.style}`;
  const kitFor = (team: Team, gk: boolean): number => (gk ? KIT_COLORS[team].gk : KIT_COLORS[team].outfield);
  const figureGeo = (team: Team, gk: boolean, look: Look): THREE.BufferGeometry => {
    const key = keyFor(team, gk, look);
    let g = figureGeos.get(key);
    if (!g) {
      g = buildFigureGeometry(gk, kitFor(team, gk), look);
      figureGeos.set(key, g);
    }
    return g;
  };
  const partsOf = (e: Entry): FigureParts => {
    let p = partsCache.get(e.partsKey);
    if (!p) {
      p = buildFigureParts(e.gk, kitFor(e.team, e.gk), e.look);
      partsCache.set(e.partsKey, p);
    }
    return p;
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

  // Possessor ring: one flat ring that moves to the player on the ball.
  const ringGeos = {
    of: new THREE.RingGeometry(0.62, 0.78, 40).rotateX(-Math.PI / 2),
    gk: new THREE.RingGeometry(1.35, 1.55, 40).rotateX(-Math.PI / 2),
  };
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd23a,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ring = new THREE.Mesh(ringGeos.of, ringMat);
  ring.name = 'possessor-ring';
  ring.position.y = 0.03;
  ring.visible = false;
  ring.renderOrder = 2;
  group.add(ring);
  let possessorId: number | null = null;

  let hitboxesVisible = !!opts.hitboxes;
  let hiddenId: number | null = null;
  const entries = new Map<number, Entry>();
  const hitboxes: THREE.LineSegments[] = [];

  function syncRing(): void {
    const e = possessorId === null ? undefined : entries.get(possessorId);
    if (!e || !e.root.visible) {
      ring.visible = false;
      return;
    }
    ring.geometry = e.gk ? ringGeos.gk : ringGeos.of;
    ring.position.set(e.root.position.x, 0.03, e.root.position.z);
    ring.visible = true;
  }

  // ---- rig (animation) -------------------------------------------------------
  function buildRig(e: Entry): Rig {
    const parts = partsOf(e);
    const g = new THREE.Group();
    g.name = 'player-rig';
    const mesh = (geo: THREE.BufferGeometry): THREE.Mesh => {
      const m = new THREE.Mesh(geo, figureMat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    g.add(mesh(parts.body));
    const legs: THREE.Group[] = [];
    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(0, parts.hip.y, side * parts.hip.z);
      leg.add(mesh(parts.leg));
      g.add(leg);
      legs.push(leg);
      const arm = new THREE.Group();
      arm.position.set(0, parts.shoulder.y, side * parts.shoulder.z);
      arm.add(mesh(parts.arm));
      g.add(arm);
      arms.push(arm);
    }
    g.visible = false;
    e.sway.add(g);
    return { group: g, legs: legs as [THREE.Group, THREE.Group], arms: arms as [THREE.Group, THREE.Group] };
  }

  /** Draws a pose on the rig (switching from the merged figure the first time). */
  function applyPose(e: Entry, pose: Pose): void {
    e.rig ??= buildRig(e);
    const rig = e.rig;
    const rest = partsOf(e).armRest;
    rig.legs[0].rotation.z = pose.legL;
    rig.legs[1].rotation.z = pose.legR;
    // Arm: swing in the fore-aft plane first (z), then spread about the forward axis (x).
    rig.arms[0].rotation.set(rest + pose.armLAbd, 0, pose.armL); // side −1: x = −side·(rest + abd)
    rig.arms[1].rotation.set(-(rest + pose.armRAbd), 0, pose.armR);
    rig.group.visible = true;
    e.figure.visible = false;
    e.pose = pose;
  }

  /** Back to the merged resting figure. */
  function toStatic(e: Entry): void {
    if (e.rig) e.rig.group.visible = false;
    e.figure.visible = true;
    e.pose = copyPose(IDLE_POSE);
    e.anim = null;
  }

  function start(e: Entry, anim: Omit<Anim, 't' | 'from'>): void {
    e.anim = { ...anim, t: 0, from: copyPose(e.pose) };
  }

  function stepAnim(e: Entry, dt: number): void {
    const a = e.anim;
    if (!a) return;
    a.t += dt;
    switch (a.kind) {
      case 'windup':
        applyPose(e, windupPose(a.t, a.from)); // holds its last pose until the strike
        break;
      case 'kick':
        if (a.t >= KICK_DURATION) toStatic(e);
        else applyPose(e, kickPose(a.t, a.from));
        break;
      case 'catch': {
        applyPose(e, catchPose(a.t, a.ballY ?? 1.2, partsOf(e).armRest, a.from));
        if (a.yawFrom !== undefined && a.yawTo !== undefined) {
          const k = Math.min(1, a.t / TURN_TIME);
          e.root.rotation.y = -(a.yawFrom + angleDiff(a.yawFrom, a.yawTo) * k * (2 - k)); // ease-out
        }
        break; // held until relax()
      }
      case 'relax':
        if (a.t >= RELAX_TIME) toStatic(e);
        else applyPose(e, relaxPose(a.t, a.from));
        break;
    }
  }

  let clock = 0;
  const offFrame = opts.stage?.onFrame((dt) => {
    clock += dt;
    for (const e of entries.values()) {
      stepAnim(e, dt); // animations run on even while the figure is hidden (so a hidden kicker's kick is on time)
      if (!e.root.visible) continue;
      const { lean, nod, stretch } = swayPose(clock, e.phase);
      // Rotation about the feet (the sway group's origin); an animation leans the whole body forward (−z).
      e.sway.rotation.set(lean, 0, nod - e.pose.lean);
      e.sway.scale.y = stretch;
    }
    if (ring.visible) {
      const { scale, opacity } = ringPulse(clock);
      ring.scale.set(scale, 1, scale);
      ringMat.opacity = opacity;
    }
  });

  function clearAll(): void {
    for (const e of entries.values()) e.root.removeFromParent();
    entries.clear();
    hitboxes.length = 0;
    ring.visible = false;
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

        const sway = new THREE.Group();
        sway.name = 'player-sway';
        root.add(sway);

        const look = lookFor(p.id);
        const figure = new THREE.Mesh(figureGeo(p.team, p.gk, look), figureMat);
        figure.name = 'player-figure';
        figure.castShadow = true;
        figure.receiveShadow = true;
        figure.userData.playerId = p.id;
        sway.add(figure);

        const sc = p.gk ? 1.06 : 1;
        const back = new THREE.Mesh(backGeo, backMat(p.shirt ?? p.id));
        back.name = 'player-back-number';
        back.position.set(-0.18 * 0.82 * sc - 0.012, 1.2 * sc, 0);
        back.scale.setScalar(sc);
        sway.add(back);

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
        entries.set(p.id, {
          root,
          sway,
          figure,
          rig: null,
          gk: p.gk,
          team: p.team,
          partsKey: keyFor(p.team, p.gk, look),
          look,
          anim: null,
          pose: copyPose(IDLE_POSE),
          phase: (p.id * 2.399) % (Math.PI * 2),
        });
      }
      syncRing();
    },
    setHidden(id) {
      hiddenId = id;
      for (const [pid, e] of entries) e.root.visible = pid !== id;
      syncRing();
    },
    setYaw(id, yaw) {
      const e = entries.get(id);
      if (e) e.root.rotation.y = -yaw;
    },
    setPossessor(id) {
      possessorId = id;
      syncRing();
    },
    playWindup(id) {
      const e = entries.get(id);
      if (e) start(e, { kind: 'windup' });
    },
    playKick(id) {
      const e = entries.get(id);
      if (e) start(e, { kind: 'kick' });
    },
    playCatch(id, ball) {
      const e = entries.get(id);
      if (!e) return;
      const yawFrom = -e.root.rotation.y;
      const dx = ball.x - e.root.position.x;
      const dz = ball.z - e.root.position.z;
      const turn = dx * dx + dz * dz > 1e-6;
      start(e, { kind: 'catch', ballY: ball.y, yawFrom: turn ? yawFrom : undefined, yawTo: turn ? Math.atan2(dz, dx) : undefined });
    },
    relax() {
      for (const e of entries.values()) {
        if (!e.anim && !e.rig?.group.visible) continue;
        if (e.anim?.kind === 'relax') continue;
        start(e, { kind: 'relax' });
      }
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
      for (const p of partsCache.values()) disposeFigureParts(p);
      figureMat.dispose();
      ringGeos.of.dispose();
      ringGeos.gk.dispose();
      ringMat.dispose();
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
