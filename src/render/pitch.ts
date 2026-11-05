// Pitch rendering. M0.3: a temporary flat green ground sized from derivePitch.
// M1.1/M1.2 replace it with striped grass, apron and markings.
import * as THREE from 'three';
import type { Pitch } from '../shared/pitch';

/** Apron beyond the lines on every side, metres (PLAN M1.1). */
export const APRON = 6;

export function createTempGround(pitch: Pitch): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(pitch.length + 2 * APRON, pitch.width + 2 * APRON);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x3f8f3a });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'temp-ground';
  mesh.receiveShadow = true;
  return mesh;
}
