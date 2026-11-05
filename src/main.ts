// Boot: DOM layers → 3D stage (if WebGL is available) → router.
import './ui/styles.css';
import { audio, unlockAudioOnGesture } from './app/audio';
import { bindAudioPrefs } from './app/audioPrefs';
import { createHotseatMode } from './app/hotseat';
import { createInspectView, type InspectView } from './app/inspect';
import { createLabView } from './app/lab';
import { createOnlineMode } from './app/online';
import { createPracticeView } from './app/practice';
import { flagSettings, getFlags, routeToHash, startRouter, type Route } from './app/router';
import { DEFAULT_SETTINGS } from './game/settings';
import { createFpsCounter } from './render/debug';
import { detectQuality, readDevice } from './render/quality';
import { createStage, type Stage } from './render/scene';
import { derivePitch } from './shared/pitch';
import { clear, h } from './ui/dom';
import { howToPlayScreen } from './ui/help';
import { menuScreen } from './ui/menu';
import { createRotatePrompt } from './ui/rotatePrompt';
import { createSoundControl } from './ui/soundControl';
import { isTouchUi } from './ui/touchBar';
import { placeholderScreen } from './ui/placeholders';

const flags = getFlags();
// Browsers only allow sound after a user gesture: create the audio context on the first one.
unlockAudioOnGesture();
// Volume and mute are remembered between visits (M14.2).
bindAudioPrefs(audio);
const dev = import.meta.env.DEV || flags.debug;
if (dev) (window as unknown as { __audio?: unknown }).__audio = audio;

const app = document.getElementById('app')!;
const stageEl = h('div', { id: 'stage' });
const uiEl = h('div', { id: 'ui' });
const screenEl = h('div', { id: 'screen' });
uiEl.append(screenEl);
app.append(stageEl, uiEl);
// One speaker control for every screen; it lives outside #screen, which the router clears.
createSoundControl(audio, uiEl);
// Touch UI: a class for layout rules, and a rotate prompt for phones held upright (M16.2).
document.documentElement.classList.toggle('touch-ui', isTouchUi(flags.touch));
createRotatePrompt(uiEl, { touchFlag: flags.touch });

function tryCreateStage(): Stage | null {
  try {
    // Performance mode (M16.3): phones, tablets and weak devices start in "low"; ?perf=low|high forces it.
    return createStage(stageEl, { quality: detectQuality(readDevice(), flags.perf), autoDowngrade: flags.perf === null });
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

const stage = tryCreateStage();
if (stage && flags.debug) createFpsCounter(stage, uiEl);
const pitch = derivePitch(DEFAULT_SETTINGS);

/**
 * The mode for the current route. Lab, Practice and Hot-seat bring their own
 * views; the menu and the remaining placeholders share the inspect view.
 */
type ModeKind = 'inspect' | 'lab' | 'practice' | 'hotseat' | 'online';
let mode: { kind: ModeKind; key: string; inspect: InspectView | null; dispose(): void } | null = null;

function ensureMode(kind: ModeKind, route: Route): void {
  // Online modes restart when the route changes (host ↔ join, another code).
  const key = kind === 'online' ? routeToHash(route) : kind;
  if (mode?.key === key) return;
  mode?.dispose();
  mode = null;
  if (kind === 'hotseat') {
    // Works without WebGL up to the draft (setup and toss are DOM only).
    const m = createHotseatMode(stage, {
      debug: flags.debug,
      seed: flags.seed,
      autoplace: flags.autoplace,
      settings: flagSettings(flags),
      overlay: screenEl,
    });
    mode = { kind, key, inspect: null, dispose: () => m.dispose() };
    return;
  }
  if (kind === 'online' && (route.name === 'host' || route.name === 'join')) {
    // DOM only (the turning pitch behind it needs WebGL, the lobby doesn't).
    const m = createOnlineMode(stage, {
      role: route.name,
      code: route.name === 'join' ? route.code : null,
      debug: flags.debug,
      seed: flags.seed,
      autoplace: flags.autoplace,
      settings: flagSettings(flags),
      overlay: screenEl,
    });
    mode = { kind, key, inspect: null, dispose: () => m.dispose() };
    return;
  }
  if (!stage) return;
  if (kind === 'lab') {
    const v = createLabView(stage, pitch, { debug: flags.debug, overlay: screenEl });
    mode = { kind, key, inspect: null, dispose: () => v.dispose() };
  } else if (kind === 'practice') {
    const v = createPracticeView(stage, pitch, { debug: flags.debug, seed: flags.seed, overlay: screenEl });
    mode = { kind, key, inspect: null, dispose: () => v.dispose() };
  } else {
    const v = createInspectView(stage, pitch, { debug: flags.debug, overlay: uiEl });
    mode = { kind, key, inspect: v, dispose: () => v.dispose() };
  }
}

function showRoute(route: Route): void {
  const kind: ModeKind =
    route.name === 'lab' || route.name === 'practice' || route.name === 'hotseat'
      ? route.name
      : route.name === 'host' || route.name === 'join'
        ? 'online'
        : 'inspect';
  const key = kind === 'online' ? routeToHash(route) : kind;
  // The online lobby redraws only when its route really changes (it rewrites #/join → #/join/CODE itself).
  if (mode?.key !== key || kind !== 'online') clear(screenEl);
  ensureMode(kind, route);
  if (route.name === 'menu') screenEl.append(menuScreen({ dev }));
  else if (route.name === 'howto') screenEl.append(howToPlayScreen());
  else if (kind === 'inspect' || (!stage && route.name !== 'hotseat' && kind !== 'online')) screenEl.append(placeholderScreen(route, { dev }));
  if (mode?.inspect) {
    // The menu backdrop slowly turns around the pitch.
    mode.inspect.controls.autoRotate = route.name === 'menu' || route.name === 'howto';
    mode.inspect.controls.autoRotateSpeed = 0.35;
  }
  document.title = route.name === 'menu' ? 'Footy' : route.name === 'howto' ? 'Footy · How to play' : `Footy · ${route.name}`;
}

startRouter(showRoute);
