// Goals (posts, crossbar, net) and corner flags. PLAN §2.2, §5.2, M1.3.
// Posts and bar match the physics capsules exactly (front faces flush with the
// goal line); the net is the same box the physics uses (back, two sides, roof).
import * as THREE from 'three';
import type { Pitch, PitchEnd, Point3 } from '../shared/pitch';

/** Spacing of the visual net mesh, metres. */
const NET_CELL = 0.2;
/** Radius of the thin visual net-support tubes. */
const NET_FRAME_R = 0.022;
const FLAG_POLE_H = 1.5;
const FLAG_POLE_R = 0.018;

export interface GoalsView {
  readonly group: THREE.Group;
  dispose(): void;
}

export function createGoalsView(pitch: Pitch): GoalsView {
  const group = new THREE.Group();
  group.name = 'goals';

  const mats = {
    frame: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
    support: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.5, metalness: 0.3 }),
    netFill: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    netLines: new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.5, depthWrite: false }),
    pole: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xffcf3a, roughness: 0.8, side: THREE.DoubleSide }),
  };

  for (const end of pitch.ends) group.add(buildGoal(end, mats));
  for (const c of pitch.corners) group.add(buildCornerFlag(c.x, c.z, mats.pole, mats.flag));

  return {
    group,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      for (const m of Object.values(mats)) m.dispose();
      group.removeFromParent();
    },
  };
}

/** A cylinder (with rounded ends when `caps`) between two points. */
function tube(a: Point3, b: Point3, r: number, mat: THREE.Material, caps = false): THREE.Object3D {
  const va = new THREE.Vector3(a.x, a.y, a.z);
  const vb = new THREE.Vector3(b.x, b.y, b.z);
  const len = va.distanceTo(vb);
  const geo = caps ? new THREE.CapsuleGeometry(r, len, 6, 16) : new THREE.CylinderGeometry(r, r, len, 16, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface GoalMats {
  frame: THREE.Material;
  support: THREE.Material;
  netFill: THREE.Material;
  netLines: THREE.LineBasicMaterial;
}

function buildGoal(end: PitchEnd, mats: GoalMats): THREE.Group {
  const g = end.goal;
  const goal = new THREE.Group();
  goal.name = `goal-${end.team === 0 ? 'A' : 'B'}`;

  // Posts and crossbar: capsules of radius 0.06 (§5.2). Posts are cylinders from
  // the ground (flat bottom) with a rounded top hidden in the bar's rounded ends.
  goal.add(tube(g.leftPost.a, g.leftPost.b, g.postRadius, mats.frame));
  goal.add(tube(g.rightPost.a, g.rightPost.b, g.postRadius, mats.frame));
  goal.add(tube(g.crossbar.a, g.crossbar.b, g.postRadius, mats.frame, true));

  // Net box: from the post axis back to netBackX, z = ±postZ, y = 0..postTop.
  const x0 = g.postX;
  const x1 = g.netBackX;
  const zL = -g.postZ;
  const zR = g.postZ;
  const yT = g.postTop;

  // Visual supports along the back and roof edges (not part of the physics).
  const P = (x: number, y: number, z: number): Point3 => ({ x, y, z });
  const r = NET_FRAME_R;
  for (const [a, b] of [
    [P(x1, 0, zL), P(x1, yT, zL)],
    [P(x1, 0, zR), P(x1, yT, zR)],
    [P(x1, yT, zL), P(x1, yT, zR)],
    [P(x0, yT, zL), P(x1, yT, zL)],
    [P(x0, yT, zR), P(x1, yT, zR)],
    [P(x0, r, zL), P(x1, r, zL)],
    [P(x0, r, zR), P(x1, r, zR)],
    [P(x1, r, zL), P(x1, r, zR)],
  ] as const) {
    goal.add(tube(a, b, r, mats.support));
  }

  // Faint fill so the net reads as a surface, plus the mesh lines.
  const fill = new THREE.BufferGeometry();
  const quads: number[] = [];
  const quad = (a: Point3, b: Point3, c: Point3, d: Point3): void => {
    quads.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };
  quad(P(x1, 0, zL), P(x1, 0, zR), P(x1, yT, zR), P(x1, yT, zL)); // back
  quad(P(x0, 0, zL), P(x1, 0, zL), P(x1, yT, zL), P(x0, yT, zL)); // side L
  quad(P(x0, 0, zR), P(x1, 0, zR), P(x1, yT, zR), P(x0, yT, zR)); // side R
  quad(P(x0, yT, zL), P(x1, yT, zL), P(x1, yT, zR), P(x0, yT, zR)); // roof
  fill.setAttribute('position', new THREE.Float32BufferAttribute(quads, 3));
  const fillMesh = new THREE.Mesh(fill, mats.netFill);
  fillMesh.name = 'net-fill';
  fillMesh.renderOrder = 2;
  goal.add(fillMesh);

  const lines: number[] = [];
  const seg = (a: Point3, b: Point3): void => {
    lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  /** Grid on the rectangle origin + s·u + t·v, s ∈ [0, su], t ∈ [0, tv]. */
  const grid = (o: Point3, u: Point3, su: number, v: Point3, tv: number): void => {
    const at = (s: number, t: number): Point3 => P(o.x + u.x * s + v.x * t, o.y + u.y * s + v.y * t, o.z + u.z * s + v.z * t);
    const nu = Math.max(1, Math.round(su / NET_CELL));
    const nv = Math.max(1, Math.round(tv / NET_CELL));
    for (let i = 0; i <= nu; i++) seg(at((su * i) / nu, 0), at((su * i) / nu, tv));
    for (let j = 0; j <= nv; j++) seg(at(0, (tv * j) / nv), at(su, (tv * j) / nv));
  };
  const depth = Math.abs(x1 - x0);
  const back = Math.sign(x1 - x0);
  grid(P(x1, 0, zL), P(0, 0, 1), zR - zL, P(0, 1, 0), yT); // back
  grid(P(x0, 0, zL), P(back, 0, 0), depth, P(0, 1, 0), yT); // side L
  grid(P(x0, 0, zR), P(back, 0, 0), depth, P(0, 1, 0), yT); // side R
  grid(P(x0, yT, zL), P(back, 0, 0), depth, P(0, 0, 1), zR - zL); // roof
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const netLines = new THREE.LineSegments(lineGeo, mats.netLines);
  netLines.name = 'net-lines';
  netLines.renderOrder = 3;
  goal.add(netLines);

  return goal;
}

function buildCornerFlag(x: number, z: number, poleMat: THREE.Material, flagMat: THREE.Material): THREE.Group {
  const flag = new THREE.Group();
  flag.name = 'corner-flag';
  flag.position.set(x, 0, z);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(FLAG_POLE_R, FLAG_POLE_R, FLAG_POLE_H, 8), poleMat);
  pole.position.y = FLAG_POLE_H / 2;
  pole.castShadow = true;
  flag.add(pole);

  // Small pennant hanging from the top, pointing away from the pitch along the goal line.
  const cloth = new THREE.BufferGeometry();
  const w = 0.42;
  const hgt = 0.3;
  const top = FLAG_POLE_H - 0.02;
  cloth.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, top, 0, 0, top - hgt, 0, w, top - hgt * 0.55, 0.04, 0, top, 0, w, top - hgt * 0.55, 0.04, w, top - 0.04, 0.02], 3),
  );
  cloth.computeVertexNormals();
  const clothMesh = new THREE.Mesh(cloth, flagMat);
  clothMesh.castShadow = true;
  clothMesh.rotation.y = Math.sign(x) > 0 ? 0 : Math.PI;
  flag.add(clothMesh);
  return flag;
}
