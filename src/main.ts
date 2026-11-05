// Boot: stage + temporary ground + orbit camera. M0.4 adds the router.
import './ui/styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_SETTINGS } from './game/settings';
import { createFpsCounter } from './render/debug';
import { createTempGround } from './render/pitch';
import { createStage, type Stage } from './render/scene';
import { h } from './ui/dom';
import { derivePitch } from './shared/pitch';

const app = document.getElementById('app')!;
const stageEl = document.createElement('div');
stageEl.id = 'stage';
const uiEl = document.createElement('div');
uiEl.id = 'ui';
app.append(stageEl, uiEl);

let stage: Stage;
try {
  stage = createStage(stageEl);
} catch (err) {
  console.warn('WebGL unavailable:', err);
  uiEl.append(
    h('div', { class: 'panel placeholder' },
      h('h1', {}, 'WebGL is not available'),
      h('p', {}, 'Footy needs WebGL. Enable hardware acceleration in your browser settings, or try another browser.'),
    ),
  );
  throw new Error('Footy: no WebGL context');
}
const pitch = derivePitch(DEFAULT_SETTINGS);

stage.scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a5a2a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-30, 60, 25);
stage.scene.add(sun);
stage.scene.add(createTempGround(pitch));

const camera = stage.camera as THREE.PerspectiveCamera;
camera.position.set(0, pitch.halfLength * 0.9, pitch.halfWidth * 2.1);
const controls = new OrbitControls(camera, stage.canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 3;
controls.maxDistance = pitch.length * 1.5;
controls.update();
stage.onFrame(() => controls.update());

if (new URLSearchParams(location.search).has('debug')) {
  createFpsCounter(stage, uiEl);
}
