// Replay controls (M15.1): a "Replay last kick" button while aiming and, during
// a replay, a bar with the camera (chase / broadcast / behind goal), the speed
// (1× · ½× · ¼×), Again and Close. Pure view over a KickFlow; it polls the flow
// every frame and touches the DOM only when something changed.
import type { Stage } from '../render/scene';
import { h } from '../ui/dom';
import type { KickFlow } from './kickFlow';
import { REPLAY_CAM_LABEL, REPLAY_CAMS, REPLAY_SPEED_LABEL, REPLAY_SPEEDS } from './replayModel';

export interface ReplayControlsOptions {
  stage: Pick<Stage, 'onFrame'>;
  flow: Pick<
    KickFlow,
    'phase' | 'canReplay' | 'replay' | 'startReplay' | 'stopReplay' | 'restartReplay' | 'setReplayCamera' | 'setReplaySpeed' | 'spectating'
  >;
  overlay: HTMLElement;
  /** True while something covers the view (hold-Tab map, half-time card): the controls hide. */
  covered?(): boolean;
}

export interface ReplayControls {
  readonly el: HTMLElement;
  dispose(): void;
}

export function createReplayControls(opts: ReplayControlsOptions): ReplayControls {
  const { flow } = opts;
  const openBtn = h('button', { class: 'btn btn-sm replay-open', type: 'button', hidden: true, title: 'Replay the last kick (R)' }, '⟲ Replay last kick ', h('kbd', {}, 'R'));
  openBtn.addEventListener('click', () => {
    flow.startReplay();
    openBtn.blur();
  });

  const camBtns = REPLAY_CAMS.map((cam) => {
    const b = h('button', { class: 'btn btn-sm', type: 'button', 'data-cam': cam }, REPLAY_CAM_LABEL[cam]);
    b.addEventListener('click', () => {
      flow.setReplayCamera(cam);
      b.blur();
    });
    return b;
  });
  const speedBtns = REPLAY_SPEEDS.map((sp) => {
    const b = h('button', { class: 'btn btn-sm', type: 'button', 'data-speed': sp }, REPLAY_SPEED_LABEL(sp));
    b.addEventListener('click', () => {
      flow.setReplaySpeed(sp);
      b.blur();
    });
    return b;
  });
  const speedGroup = h('span', { class: 'replay-group', title: 'Speed (1 · 2 · 3)' }, ...speedBtns);
  const tag = h('span', { class: 'replay-tag' }, 'REPLAY');
  const again = h('button', { class: 'btn btn-sm', type: 'button' }, '↺ Again');
  again.addEventListener('click', () => {
    flow.restartReplay();
    again.blur();
  });
  const closeLabel = h('span', {}, 'Close');
  const close = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, closeLabel, ' ', h('kbd', {}, 'R'));
  close.addEventListener('click', () => flow.stopReplay());

  const bar = h(
    'div',
    { class: 'replay-bar', hidden: true, 'data-hud': 'replay-bar' },
    tag,
    h('span', { class: 'replay-group', title: 'Camera (C)' }, ...camBtns),
    speedGroup,
    again,
    close,
  );
  const el = h('div', { class: 'replay-ui' }, openBtn, bar);
  opts.overlay.append(el);

  let key = '';
  const offFrame = opts.stage.onFrame(() => {
    const r = flow.replay;
    const covered = opts.covered?.() ?? false;
    const showOpen = !covered && !r && flow.phase === 'aim' && flow.canReplay;
    const k = `${showOpen}|${covered}|${r ? `${r.cam}|${r.speed}|${r.done}|${r.auto}` : '-'}`;
    if (k === key) return;
    key = k;
    openBtn.hidden = !showOpen;
    bar.hidden = !r || covered;
    if (!r) return;
    camBtns.forEach((b, i) => b.classList.toggle('active', REPLAY_CAMS[i] === r.cam));
    speedBtns.forEach((b, i) => b.classList.toggle('active', REPLAY_SPEEDS[i] === r.speed));
    again.classList.toggle('btn-primary', r.done);
    // The automatic goal replay (M15.2) is 1× only and closes itself: camera choice and Skip.
    tag.textContent = r.auto ? 'GOAL REPLAY' : 'REPLAY';
    closeLabel.textContent = r.auto ? 'Skip' : 'Close';
    speedGroup.hidden = r.auto;
    again.hidden = r.auto;
  });

  return {
    el,
    dispose() {
      offFrame();
      el.remove();
    },
  };
}
