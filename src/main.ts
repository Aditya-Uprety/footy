// Boot: DOM layers → 3D stage (if WebGL is available) → router.
import './ui/styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getFlags, startRouter, type Route } from './app/router';
import { DEFAULT_SETTINGS } from './game/settings';
import { createFpsCounter } from './render/debug';
import { createTempGround } from './render/pitch';
import { createStage, type Stage } from './render/scene';
import { derivePitch } from './shared/pitch';
import { clear, h } from './ui/dom';
import { placeholderScreen } from './ui/placeholders';

const flags = getFlags();

const app = document.getElementById('app')!;
const stageEl = h('div', { id: 'stage' });
const uiEl = h('div', { id: 'ui' });
const screenEl = h('div', { id: 'screen' });
uiEl.append(screenEl);
app.append(stageEl, uiEl);

function tryCreateStage(): Stage | null {
  try {
    return createStage(stageEl);
  } catch (err) {
    console.warn('Footy: WebGL is not available.', err);
    uiEl.append(
      h(
        'div',
        { class: 'panel webgl-error' },
        h('strong', {}, 'WebGL is not available. '),
        'Footy needs WebGL to draw the pitch. Enable hardware acceleration in your browser settings, or try another browser.',
      ),
    );
    return null;
  }
}

/** M0 inspect view: temporary ground with an orbit camera. Replaced per mode later. */
function setupInspectView(stage: Stage): void {
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
}

const stage = tryCreateStage();
if (stage) {
  setupInspectView(stage);
  if (flags.debug) createFpsCounter(stage, uiEl);
}

function showRoute(route: Route): void {
  clear(screenEl);
  screenEl.append(placeholderScreen(route, { dev: import.meta.env.DEV || flags.debug }));
  document.title = route.name === 'menu' ? 'Footy' : `Footy · ${route.name}`;
}

startRouter(showRoute);
