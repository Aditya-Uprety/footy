// Practice mode (#/practice, PLAN M5.5): solo kicking sandbox, no rules
// engine. A seeded random 22-player layout (?seed=N reproduces it); after the
// ball stops the closest player gets it, a keeper keeps a catch, and goals or
// outs reset to a center kickoff.
//
// Pieces: aim rig (M5.1) · kick side bar (M5.2) · kick flow (M5.3) · hold-Tab
// overhead map + minimap (M5.4). No aim aids anywhere (CLAUDE.md).
import { createHelpOverlay } from '../ui/helpOverlay';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../game/settings';
import { mapContent, type MapContent } from '../render/overheadMap';
import { createPlayersView, type PlayersView } from '../render/players';
import type { Stage } from '../render/scene';
import type { Pitch } from '../shared/pitch';
import { createRng } from '../shared/rng';
import { simulateKick } from '../sim/simulate';
import type { KickResult, Outcome, SimEvent, Team } from '../sim/types';
import { buildWorld } from '../sim/world';
import { h } from '../ui/dom';
import { createKickPanel } from '../ui/kickPanel';
import { createAimController } from './aimController';
import { createInspectView } from './inspect';
import { createMapControls } from './mapControls';
import { audio } from './audio';
import { createKickFlow, type FlowPhase } from './kickFlow';
import { kickoffTurn, nextPracticeTurn, practiceLayout, type PracticePlayer, type PracticeTurn } from './practiceRules';

export interface PracticeOptions {
  debug: boolean;
  seed: number | null;
  /** Parent for the mode's DOM overlays. */
  overlay: HTMLElement;
}

export interface PracticeView {
  dispose(): void;
}

const TEAM_NAME: Record<Team, string> = { 0: 'Red', 1: 'Blue' };
const TOAST_TIME = 1800;

function randomSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

export function createPracticeView(stage: Stage, pitch: Pitch, opts: PracticeOptions): PracticeView {
  // The inspect view supplies the pitch, goals, ball and ?debug aids; its orbit camera stays off.
  const world = createInspectView(stage, pitch, { debug: opts.debug, overlay: opts.overlay });
  world.suspend();

  const playersView: PlayersView = createPlayersView({ hitboxes: opts.debug, stage });
  stage.scene.add(playersView.group);

  const aim = createAimController(stage, { ball: world.ball });
  const panel = createKickPanel();
  panel.setHeight(aim.state.height);
  panel.onHeight((hgt) => aim.setHeight(hgt));
  aim.onChange((s) => panel.setHeight(s.height));

  // ---- state ---------------------------------------------------------------
  let seed = opts.seed ?? randomSeed();
  let players: PracticePlayer[] = [];
  let turn: PracticeTurn = kickoffTurn(pitch, 0);
  let turnId = 0;
  const score: [number, number] = [0, 0];
  let kicks = 0;
  let lastText = '';

  function layout(s: number): void {
    seed = s;
    players = practiceLayout(pitch, DEFAULT_SETTINGS, createRng(seed));
    playersView.setPlayers(players);
  }

  const flow = createKickFlow({
    stage,
    pitch,
    ball: world.ball,
    players: playersView,
    aim,
    panel,
    keeperAt: (id) => players.find((p) => p.id === id) ?? null,
    requestKick(input, t) {
      const res = simulateKick({
        input,
        origin: t.origin,
        team: turn.team,
        world: buildWorld(pitch, players, t.origin.kind === 'player' ? t.origin : null),
        caps: t.caps,
        turnId: ++turnId,
      });
      flow.play(res);
    },
    onEvent: (ev) => onSimEvent(ev),
    onPlaybackEnd: (res) => afterKick(res),
    onPhase: (p) => onPhase(p),
  });

  function begin(t: PracticeTurn, instant = false): void {
    turn = t;
    flow.startTurn({ origin: t.origin, yaw: t.yaw }, { instant });
    renderHud();
  }

  function afterKick(res: KickResult): void {
    kicks += 1;
    const o = res.outcome;
    if (o.kind === 'goal') score[o.goalOf === 0 ? 1 : 0] += 1;
    lastText = describeOutcome(o);
    begin(nextPracticeTurn(pitch, players, turn.team, o));
  }

  function describeOutcome(o: Outcome): string {
    switch (o.kind) {
      case 'goal':
        return `Goal for ${TEAM_NAME[o.goalOf === 0 ? 1 : 0]}${o.lastTouch.team === o.goalOf ? ' (own goal)' : ''}`;
      case 'catch': {
        const k = players.find((p) => p.id === o.keeperId);
        return `Saved by ${k ? `${TEAM_NAME[k.team]} #${k.shirt}` : 'the keeper'}`;
      }
      case 'out':
        return o.line === 'touch' ? 'Out over the touchline' : 'Out over the goal line';
      case 'stop':
        return o.touches > 0 ? `Stopped after ${o.touches} touch${o.touches > 1 ? 'es' : ''}` : 'Stopped';
    }
  }

  function onSimEvent(ev: SimEvent): void {
    audio.playEvent(ev);
    if (ev.kind === 'goal') toast('GOAL!', 'goal');
    else if (ev.kind === 'catch') toast('Saved!', 'save');
    else if (ev.kind === 'out') toast(ev.line === 'touch' ? 'Out — touchline' : 'Out — goal line', 'out');
    else if ((ev.kind === 'post' || ev.kind === 'bar') && !ev.tail) toast(ev.kind === 'post' ? 'Off the post!' : 'Off the bar!', 'post');
  }

  function onPhase(p: FlowPhase): void {
    hud.root.classList.toggle('busy', p !== 'aim');
    renderHud();
  }

  // ---- HUD -----------------------------------------------------------------
  const hud = {
    root: h('div', { class: 'panel practice-hud', 'data-screen': 'practice' }),
    possession: h('div', { class: 'ph-possession' }),
    last: h('div', { class: 'ph-last' }),
    score: h('div', { class: 'ph-score' }),
    seed: h('span', { class: 'ph-seed' }),
  };
  const newLayoutBtn = h('button', { type: 'button', class: 'btn btn-sm' }, 'New layout');
  newLayoutBtn.addEventListener('click', () => {
    newLayout();
    newLayoutBtn.blur();
  });
  hud.root.append(
    h('div', { class: 'ph-title' }, h('h1', {}, 'Practice'), h('a', { href: '#/' }, '← Menu')),
    hud.possession,
    hud.last,
    hud.score,
    h('div', { class: 'ph-row' }, newLayoutBtn, hud.seed),
    h(
      'p',
      { class: 'ph-keys' },
      'Drag or ← → turn (Shift fine) · ↑ ↓ look · wheel or + − zoom · hold Tab map · Space kick · hold F fast · C camera',
    ),
  );
  const toastEl = h('div', { class: 'toast', hidden: true });
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function toast(text: string, kind: string): void {
    toastEl.textContent = text;
    toastEl.className = `toast toast-${kind}`;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, TOAST_TIME);
  }

  function possessionText(): string {
    const team = TEAM_NAME[turn.team];
    if (turn.origin.kind === 'ghost') return `Kickoff — ${team}`;
    const id = turn.origin.playerId;
    const p = players.find((q) => q.id === id);
    return `${team} #${p?.shirt ?? id}${p?.gk ? ' (GK)' : ''} on the ball`;
  }

  function renderHud(): void {
    const p = flow.phase;
    hud.possession.textContent = p === 'aim' || p === 'transition' ? possessionText() : p === 'windup' ? 'Kick!' : 'Ball in play…';
    hud.possession.className = `ph-possession team-${turn.team}`;
    hud.last.textContent = lastText ? `Last kick: ${lastText}` : 'Aim with the mouse or arrow keys, then kick.';
    hud.score.textContent = `Goals  Red ${score[0]} · Blue ${score[1]}  ·  kicks ${kicks}`;
    hud.seed.textContent = `layout ?seed=${seed}`;
  }

  // ---- maps (M5.4): positions only; no ball while aiming -------------------
  opts.overlay.append(hud.root, panel.el, toastEl);
  const help = createHelpOverlay(opts.overlay, { button: false });
  const ballOnMap = (): boolean => flow.phase === 'playback' || flow.phase === 'hold';
  function content(): MapContent {
    const pb = flow.playback;
    return mapContent(players, flow.turn?.origin ?? null, ballOnMap() && pb ? pb.pos : null);
  }
  const maps = createMapControls({
    stage,
    pitch,
    overlay: opts.overlay,
    orientation: 1,
    ball: world.ball,
    content,
    ballOnMap,
    // The full-screen map needs the room: the side bar and HUD step aside.
    onShow: (on) => {
      panel.el.hidden = on;
      hud.root.hidden = on;
    },
  });
  const showMap = (on: boolean): void => maps.show(on);

  function newLayout(s = randomSeed()): void {
    layout(s);
    score[0] = score[1] = 0;
    kicks = 0;
    lastText = '';
    begin(kickoffTurn(pitch, 0), true);
  }

  layout(seed);
  begin(kickoffTurn(pitch, 0), true);

  // ---- scripting hook for checks -------------------------------------------
  Object.assign(window, {
    __practice: {
      aim,
      panel,
      flow,
      maps,
      showMap,
      content,
      newLayout,
      get players() {
        return players;
      },
      get turn() {
        return turn;
      },
      get score() {
        return [...score];
      },
      /** The ball in normalized device coordinates of the current camera (x 0 = screen center). */
      ballNdc() {
        const v = world.ball.group.getWorldPosition(new THREE.Vector3()).project(stage.camera);
        return { x: v.x, y: v.y };
      },
      /** Gives the ball to a player (or a kickoff when null) at once. */
      giveBall(id: number | null) {
        const p = players.find((q) => q.id === id);
        begin(p ? nextPracticeTurn(pitch, players, p.team === 0 ? 1 : 0, { kind: 'catch', keeperId: p.id }) : kickoffTurn(pitch, 0), true);
      },
    },
  });

  audio.setAmbience(true);

  return {
    dispose() {
      audio.setAmbience(false);
      if (toastTimer) clearTimeout(toastTimer);
      help.dispose();
      maps.dispose();
      flow.dispose();
      panel.dispose();
      aim.dispose();
      playersView.dispose();
      world.dispose();
      for (const el of [hud.root, toastEl]) el.remove();
      delete (window as { __practice?: unknown }).__practice;
    },
  };
}
