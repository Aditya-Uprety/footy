// Practice mode (#/practice, PLAN M5.5): solo kicking sandbox.
// M5.3: aim rig + kick panel + kick flow; every kick restarts from the center.
import { createOverheadMap, mapContent, type MapContent } from '../render/overheadMap';
import { createPlayersView } from '../render/players';
import type { Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';
import { PHYS } from '../sim/constants';
import { simulateKick } from '../sim/simulate';
import type { KickOrigin } from '../sim/types';
import { buildWorld } from '../sim/world';
import { h } from '../ui/dom';
import { createKickPanel } from '../ui/kickPanel';
import { createMinimap } from '../ui/minimap';
import { createAimController } from './aimController';
import { createInspectView, typingInField } from './inspect';
import { createKickFlow, type Turn } from './kickFlow';

export interface PracticeOptions {
  debug: boolean;
  seed: number | null;
  /** Parent for the mode's DOM overlays. */
  overlay: HTMLElement;
}

export interface PracticeView {
  dispose(): void;
}

export function createPracticeView(stage: Stage, pitch: Pitch, opts: PracticeOptions): PracticeView {
  // The inspect view supplies the pitch, goals, ball and ?debug aids; its orbit camera stays off.
  const world = createInspectView(stage, pitch, { debug: opts.debug, overlay: opts.overlay });
  world.suspend();

  const playersView = createPlayersView({ hitboxes: opts.debug });
  stage.scene.add(playersView.group);

  const aim = createAimController(stage, { ball: world.ball });
  const panel = createKickPanel();
  opts.overlay.append(panel.el);
  panel.setHeight(aim.state.height);
  panel.onHeight((hgt) => aim.setHeight(hgt));
  aim.onChange((s) => panel.setHeight(s.height));

  const kickoff: KickOrigin = { kind: 'ghost', x: 0, y: PHYS.BALL_R, z: 0 };
  let turnId = 0;
  const flow = createKickFlow({
    stage,
    pitch,
    ball: world.ball,
    players: playersView,
    aim,
    panel,
    requestKick(input, turn) {
      const res = simulateKick({
        input,
        origin: turn.origin,
        team: 0,
        world: buildWorld(pitch, [], null),
        caps: turn.caps,
        turnId: ++turnId,
      });
      flow.play(res);
    },
    onPlaybackEnd() {
      flow.startTurn(firstTurn());
    },
  });
  const firstTurn = (): Turn => ({ origin: kickoff, yaw: 0 });
  flow.startTurn(firstTurn(), { instant: true });

  // ---- maps (M5.4): positions only; no ball while aiming -------------------
  const players: { id: number; team: 0 | 1; gk: boolean; x: number; z: number; shirt: number }[] = [];
  const overhead = createOverheadMap(stage, pitch, 1);
  const minimap = createMinimap(pitch, 1);
  const mapHint = h('div', { class: 'map-hint', hidden: true }, 'MAP · release Tab');
  opts.overlay.append(minimap.el, mapHint);
  const ballOnMap = (): boolean => flow.phase === 'playback' || flow.phase === 'hold';
  function content(): MapContent {
    const pb = flow.playback;
    return mapContent(players, flow.turn?.origin ?? null, ballOnMap() && pb ? pb.pos : null);
  }
  function showMap(on: boolean): void {
    if (on === overhead.shown) return;
    if (on) overhead.show(content());
    else overhead.hide();
    mapHint.hidden = !on;
    // The full-screen map needs the room: the side bar and minimap step aside.
    panel.el.hidden = on;
    minimap.el.hidden = on;
    world.ball.setVisible(!on || ballOnMap());
  }
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab' || ev.ctrlKey || ev.metaKey || ev.altKey || typingInField(ev)) return;
    ev.preventDefault();
    showMap(true);
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key === 'Tab') showMap(false);
  };
  const onBlur = (): void => showMap(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  let lastPhase = flow.phase;
  const offFrame = stage.onFrame(() => {
    const c = content();
    minimap.draw(c);
    if (overhead.shown && (ballOnMap() || lastPhase !== flow.phase)) {
      overhead.update(c);
      world.ball.setVisible(ballOnMap());
    }
    lastPhase = flow.phase;
  });

  Object.assign(window, { __practice: { aim, panel, flow, overhead, showMap, content } });

  return {
    dispose() {
      offFrame();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      overhead.dispose();
      minimap.dispose();
      mapHint.remove();
      flow.dispose();
      panel.dispose();
      aim.dispose();
      playersView.dispose();
      world.dispose();
      delete (window as { __practice?: unknown }).__practice;
    },
  };
}
