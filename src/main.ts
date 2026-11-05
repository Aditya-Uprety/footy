// Boot: DOM layers → 3D stage (if WebGL is available) → router.
import './ui/styles.css';
import { createInspectView } from './app/inspect';
import { createLabView } from './app/lab';
import { createPracticeView } from './app/practice';
import { getFlags, startRouter, type Route } from './app/router';
import { DEFAULT_SETTINGS } from './game/settings';
import { createFpsCounter } from './render/debug';
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

const stage = tryCreateStage();
if (stage && flags.debug) createFpsCounter(stage, uiEl);
const pitch = derivePitch(DEFAULT_SETTINGS);

/** The 3D view for the current route: Lab and Practice have their own, everything else shares the inspect view (until M7). */
type ViewKind = 'inspect' | 'lab' | 'practice';
let view: { kind: ViewKind; dispose(): void } | null = null;

function ensureView(kind: ViewKind): void {
  if (!stage || view?.kind === kind) return;
  view?.dispose();
  view = null;
  const v =
    kind === 'lab'
      ? createLabView(stage, pitch, { debug: flags.debug, overlay: screenEl })
      : kind === 'practice'
        ? createPracticeView(stage, pitch, { debug: flags.debug, seed: flags.seed, overlay: screenEl })
        : createInspectView(stage, pitch, { debug: flags.debug, overlay: uiEl });
  view = { kind, dispose: () => v.dispose() };
}

function showRoute(route: Route): void {
  const kind: ViewKind = route.name === 'lab' || route.name === 'practice' ? route.name : 'inspect';
  clear(screenEl);
  ensureView(kind);
  if (kind === 'inspect' || !stage) screenEl.append(placeholderScreen(route, { dev: import.meta.env.DEV || flags.debug }));
  document.title = route.name === 'menu' ? 'Footy' : `Footy · ${route.name}`;
}

startRouter(showRoute);
