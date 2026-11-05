// Play phase (PLAN §2.4–2.7, §3.4, M8.1–M8.4): the turn loop of a match.
//
//   possession ─> eased camera move ─> aim (shot timer) ─> KICK / auto-kick
//     ─> intent{kick} ─> session onKick{result, next} ─> playback (toasts)
//     ─> apply `next` (score, restart toast) ─> half-time card? ─> next turn
//
// The match view owns the backdrop (pitch, ball) and the players; this view
// brings the aim rig, kick side bar, HUD and maps, and tells the match view
// when a kick's `next` state is applied (`onApplied`), so full-time shows only
// after the last playback. Ghost takers (kickoff, throw-in, corner) put the
// camera behind the ball spot; goal kicks and catches go to the keeper.
import * as THREE from 'three';
import { angleDiff } from '../shared/math';
import { defaultYaw } from '../game/host';
import { activeSeat, kickCaps, kickOrigin } from '../game/rules';
import { otherTeam, type GameState } from '../game/types';
import { mapContent } from '../render/overheadMap';
import type { MapOrientation } from '../render/overheadMap';
import type { PlayersView } from '../render/players';
import type { Stage } from '../render/scene';
import { createHud } from '../ui/hud';
import { createKickPanel, type KickSliders } from '../ui/kickPanel';
import { createHalfTimeOverlay } from '../ui/screens';
import { createAimController } from './aimController';
import { audio } from './audio';
import { INSPECT_FOV, type InspectView } from './inspect';
import { createKickFlow, type FlowPhase, type Turn } from './kickFlow';
import { createMapControls } from './mapControls';
import { createReplayControls } from './replayControls';
import { wantsGoalReplay } from './replayModel';
import {
  afterKickToast,
  eventToast,
  halfLabel,
  kickCounter,
  possessionText,
  seatNameOf,
  TEAM_KIT,
  timerText,
} from './matchText';
import type { Denial, Session, SessionAim, SessionKick } from './session';
import { createShotTimer } from './shotTimer';

export interface PlayViewOptions {
  stage: Stage;
  world: InspectView;
  players: PlayersView;
  session: Session;
  overlay: HTMLElement;
  /** The state shown when play starts (the match view's, not necessarily session.state). */
  state: GameState;
  /** A kick's next state is now shown (after its playback). */
  onApplied(next: GameState): void;
  /** Map orientation (§6.1): hot-seat 1; online, your own team attacks left → right. */
  orientation?: MapOrientation;
}

export interface PlayView {
  /** True from the kick until its next state is applied. */
  readonly busy: boolean;
  sync(s: GameState): void;
  kick(k: SessionKick): void;
  denied(d: Denial): void;
  dispose(): void;
}

export function createPlayView(opts: PlayViewOptions): PlayView {
  const { stage, world, session } = opts;
  const pitch = world.pitch;
  let shown = opts.state;
  world.suspend();
  world.controls.autoRotate = false;

  const aim = createAimController(stage, { ball: world.ball });
  const panel = createKickPanel();
  panel.setHeight(aim.state.height);
  panel.onHeight((hgt) => aim.setHeight(hgt));
  aim.onChange((s) => panel.setHeight(s.height));
  const hud = createHud();
  const timer = createShotTimer(shown.settings.shotTimerSec);

  /** The kick being played back, and kicks that arrived meanwhile (e.g. a guard kick while the tab slept). */
  let playing: SessionKick | null = null;
  const queue: SessionKick[] = [];
  /** The next kick request comes from the shot timer. */
  let autoNext = false;
  /** Online: the device plays one seat; the other seat's turns are watched (§6.1 spectator). */
  const online = session.localSeats.length < 2;
  const isLocalTurn = (s: GameState): boolean => {
    const seat = activeSeat(s);
    return seat !== null && session.localSeats.includes(seat);
  };
  let halftime: ReturnType<typeof createHalfTimeOverlay> | null = null;
  let lastPhase: FlowPhase = 'idle';
  /** The automatic goal replay (M15.2) is running or about to start. */
  let autoReplay = false;

  const flow = createKickFlow({
    stage,
    pitch,
    ball: world.ball,
    players: opts.players,
    aim,
    panel,
    keeperAt: (id) => shown.players.find((p) => p.id === id) ?? null,
    requestKick(input) {
      timer.stop();
      const auto = autoNext;
      autoNext = false;
      const seat = activeSeat(shown);
      if (seat === null || !session.localSeats.includes(seat)) return;
      // LocalSession answers synchronously through onKick → kick() below.
      session.send(seat, { type: 'kick', turnId: shown.turnId, input, auto });
    },
    onEvent(ev) {
      audio.playEvent(ev);
      const t = eventToast(ev, shown.players);
      if (t) hud.toast(t);
    },
    onReplayEvent: (ev) => audio.playEvent(ev),
    onPlaybackEnd: () => finishKick(),
    onPhase(p) {
      // The shot timer runs on the kicker's device only (§8.4). A replay watched
      // while aiming does not pause or restart it.
      const from = lastPhase;
      lastPhase = p;
      if (p === 'replay') {
        // A manual replay keeps the timer running; the automatic goal replay holds it until the kickoff view is back.
        if (flow.replay?.auto) timer.stop();
      } else if (p === 'aim' && from === 'replay') {
        if (autoReplay) {
          autoReplay = false;
          if (!flow.spectating) timer.start();
          audio.whistle('kickoff'); // the restart whistle that beginTurn skips for an instant turn
        }
      } else if (p === 'aim' && !flow.spectating) timer.start();
      else timer.stop();
      if (p !== 'replay' && p !== 'aim') autoReplay = false;
      render();
    },
  });

  function turnOf(s: GameState): Turn | null {
    const p = s.possession;
    if (s.phase !== 'play' || !p) return null;
    return { origin: kickOrigin(s, p), yaw: defaultYaw(s), caps: kickCaps(p) };
  }

  function beginTurn(instant = false): void {
    const t = turnOf(shown);
    if (!t) return;
    flow.startTurn(t, { instant, spectate: !isLocalTurn(shown) });
    // The referee starts the match, the second half and every restart after a goal (not on a resume).
    if (!instant && shown.possession?.restart === 'kickoff') audio.whistle('kickoff');
    // The kicker may have started turning while we were still watching the last kick.
    if (remoteAim?.turnId === shown.turnId) flow.followYaw(remoteAim.yaw);
    render();
  }

  // ---- aim stream (§8.2 aim, ≤ 10 Hz; M10.3) ---------------------------------
  /** Seconds between streamed yaws. */
  const AIM_STREAM_DT = 0.1;
  let aimClock = 0;
  let lastSent: { turnId: number; yaw: number } | null = null;
  /** The other seat's latest streamed yaw (its turn may not be on screen yet). */
  let remoteAim: SessionAim | null = null;
  function streamAim(dt: number): void {
    aimClock += dt;
    if (aimClock < AIM_STREAM_DT || flow.phase !== 'aim' || flow.spectating) return;
    aimClock = 0;
    const seat = activeSeat(shown);
    if (seat === null) return;
    const yaw = aim.state.yaw;
    if (lastSent && lastSent.turnId === shown.turnId && Math.abs(angleDiff(lastSent.yaw, yaw)) < 1e-3) return;
    lastSent = { turnId: shown.turnId, yaw };
    // Hot-seat too: the host guard kicks with the last streamed yaw (§8.4).
    session.aim(seat, shown.turnId, yaw);
  }
  const offAim = session.onAim((a) => {
    remoteAim = a;
    if (a.turnId === shown.turnId && flow.spectating) flow.followYaw(a.yaw);
  });

  function play(k: SessionKick): void {
    playing = k;
    flow.play(k.result);
    render();
  }

  function finishKick(): void {
    const k = playing;
    if (!k) return;
    playing = null;
    const prev = shown;
    shown = k.next;
    opts.onApplied(shown);
    render();
    if (shown.phase !== 'play') return; // full-time: the match view takes over
    const t = afterKickToast(prev, shown);
    if (t) hud.toast(t);
    const queued = queue.shift();
    if (queued) {
      // Already kicked while we watched: jump to that turn and play it.
      const turn = turnOf(shown);
      if (turn) flow.startTurn(turn, { instant: true, spectate: !isLocalTurn(shown) });
      play(queued);
      return;
    }
    if (shown.half !== prev.half) showHalfTime();
    else if (wantsGoalReplay(prev, shown) && flow.canReplay) {
      // M15.2: a goal is replayed over the kickoff view (skippable); the kickoff whistle and shot timer follow it.
      beginTurn(true);
      autoReplay = flow.startReplay({ auto: true });
    } else beginTurn();
  }

  function showHalfTime(): void {
    audio.whistle('half');
    const kickoff = shown.possession?.team ?? otherTeam(0);
    halftime = createHalfTimeOverlay({
      names: [seatNameOf(shown, 0), seatNameOf(shown, 1)],
      kits: [TEAM_KIT[0], TEAM_KIT[1]],
      score: shown.score,
      note: `${TEAM_KIT[kickoff]} kicks off the ${halfLabel(2)}.`,
      onContinue: () => {
        closeHalfTime();
        beginTurn();
      },
    });
    opts.overlay.append(halftime.el);
    syncPanel();
    maps.setMinimapHidden(true);
    render();
  }

  function closeHalfTime(): void {
    if (!halftime) return;
    const ht = halftime;
    halftime = null;
    // Disposed after the current event (it may be the overlay's own click/key handler).
    queueMicrotask(() => ht.dispose());
    syncPanel();
    maps.setMinimapHidden(false);
  }

  /** The kick bar hides under the map, the half-time card, and while watching the other seat (online). */
  function syncPanel(mapOpen = maps.shown): void {
    panel.el.hidden = mapOpen || halftime !== null || flow.spectating;
  }

  // ---- HUD -----------------------------------------------------------------
  function render(): void {
    syncPanel();
    hud.setScore({
      names: [seatNameOf(shown, 0), seatNameOf(shown, 1)],
      kits: [TEAM_KIT[0], TEAM_KIT[1]],
      score: shown.score,
      counter: kickCounter(shown),
    });
    const p = shown.possession;
    if (!p || shown.phase !== 'play' || halftime) {
      hud.setPossession(null);
    } else {
      const ph = flow.phase;
      const inPlay = ph === 'windup' || ph === 'playback' || ph === 'hold' || playing !== null;
      const name = seatNameOf(shown, p.team) || TEAM_KIT[p.team];
      const sub = inPlay ? 'Ball in play…' : !online ? `${name} to kick` : isLocalTurn(shown) ? 'Your kick' : `Watching ${name}…`;
      hud.setPossession({ team: p.team, text: possessionText(shown, p), sub });
    }
    renderTimer();
  }

  function renderTimer(): void {
    if (timer.seconds <= 0 || (flow.phase !== 'aim' && flow.phase !== 'replay')) hud.setTimer(null);
    else hud.setTimer({ fraction: timer.fraction, text: timerText(timer.remaining), warn: timer.warn });
  }

  // ---- maps ----------------------------------------------------------------
  const ballOnMap = (): boolean => flow.phase === 'playback' || flow.phase === 'hold';
  opts.overlay.append(hud.el, panel.el);
  const maps = createMapControls({
    stage,
    pitch,
    overlay: opts.overlay,
    // Hot-seat: Team A attacks left → right (§6.1). Online: flipped for Team B.
    orientation: opts.orientation ?? 1,
    ball: world.ball,
    content: () => {
      const pb = flow.playback;
      return mapContent(shown.players, flow.turn?.origin ?? null, ballOnMap() && pb ? pb.pos : null);
    },
    ballOnMap,
    onShow: (on) => {
      syncPanel(on);
      hud.setHidden(on);
    },
  });

  const replayControls = createReplayControls({ stage, flow, overlay: opts.overlay, covered: () => maps.shown || halftime !== null });
  const offFrame = stage.onFrame((dt) => {
    if (timer.update(dt)) {
      // §2.4.4: at 0 the ball is kicked with the current direction and sliders
      // (a replay being watched is closed first).
      flow.stopReplay();
      autoNext = true;
      if (!flow.kick()) autoNext = false;
    }
    if (timer.running) renderTimer();
    halftime?.update(dt);
    streamAim(dt);
  });

  beginTurn();

  const view: PlayView = {
    get busy() {
      return playing !== null || queue.length > 0;
    },
    sync(s) {
      // A plain state during play (e.g. an online resume): adopt it; a new turn restarts the aim.
      if (s.rev <= shown.rev || playing) return;
      const newTurn = s.turnId !== shown.turnId;
      shown = s;
      if (newTurn && s.phase === 'play') beginTurn(true);
      else render();
    },
    kick(k) {
      if (playing) {
        queue.push(k);
        return;
      }
      closeHalfTime();
      play(k);
    },
    denied(d) {
      if (d.intentType !== 'kick') return;
      hud.toast({ text: 'Kick refused', kind: 'info', sub: d.reason });
      if (!playing && (flow.phase === 'windup' || flow.phase === 'idle')) beginTurn(true);
    },
    dispose() {
      offFrame();
      offAim();
      timer.stop();
      halftime?.dispose();
      halftime = null;
      replayControls.dispose();
      maps.dispose();
      flow.dispose();
      panel.dispose();
      aim.dispose();
      hud.dispose();
      world.ball.setVisible(true);
      world.resume(new THREE.Vector3(0, 0, 0), INSPECT_FOV);
      delete (window as { __match?: unknown }).__match;
    },
  };

  // ---- scripting hook for checks (webgl-shot) --------------------------------
  Object.assign(window, {
    __match: {
      flow,
      aim,
      panel,
      timer,
      maps,
      get shown() {
        return shown;
      },
      /** Sets sliders (and yaw) then kicks as the active seat. */
      kickNow(v: Partial<KickSliders> & { yaw?: number } = {}) {
        if (v.yaw !== undefined) aim.setYaw(v.yaw);
        panel.setValues(v);
        return flow.kick();
      },
      setFastForward: (on: boolean) => flow.setFastForward(on),
    },
  });

  return view;
}
