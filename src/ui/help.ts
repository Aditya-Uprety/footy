// How to play (PLAN §2 rules, §6.2 controls; M13.2). One content model feeds
// the full "How to play" screen (#/howto) and the in-match key-help overlay
// (H, M13.4), so the two never disagree.
import { DEFAULT_SETTINGS } from '../game/settings';
import { PHYS } from '../sim/constants';
import { h } from './dom';

export interface HelpSection {
  id: string;
  title: string;
  /** Short paragraphs (plain text). */
  paragraphs?: string[];
  /** Bullet list. */
  bullets?: string[];
}

export interface KeyRow {
  action: string;
  mouse: string;
  keys: string;
}

const S = DEFAULT_SETTINGS;
const throwCapPct = Math.round(PHYS.THROW_POWER_CAP * 100);
const loftMaxDeg = Math.round((PHYS.LOFT_MAX * 180) / Math.PI);

/** Rules summary (PLAN §2), numbers from the default settings. */
export const RULE_SECTIONS: readonly HelpSection[] = [
  {
    id: 'idea',
    title: 'The idea',
    paragraphs: [
      'Football with no running. Each team places eleven players on the pitch, then the two of you take turns kicking the ball by feel.',
      'There is no aim arrow, no trajectory preview and no landing marker. You look around, set Power, Curve and Loft, and kick.',
    ],
  },
  {
    id: 'draft',
    title: 'Placing your team',
    paragraphs: ['A coin toss decides who picks a side: Team A places first and takes the opening kickoff, Team B places the last player and sees everything.'],
    bullets: [
      'You place in turns of one or two players (a snake draft, 12 turns in all). Drag to move a spot, right-click or Undo to remove it, then Confirm. Your opponent sees your players only after you confirm.',
      `Stay ${S.minTeammateDist} m from your own players and ${S.minOpponentDist} m from the opponent’s, out of the center circle, and 1 m inside the lines.`,
      'Each team needs exactly one goalkeeper, who must stand in their own penalty area. If you have not placed yours by your last slot, that slot becomes the keeper.',
    ],
  },
  {
    id: 'kicking',
    title: 'Taking a kick',
    bullets: [
      'Whoever has the ball turns 360° to pick a direction. Power is how hard, Curve bends the ball left or right, Loft lifts it (up to ' + loftMaxDeg + '°).',
      'Allowed help: zoom, camera height, a hold-to-view overhead map and a small minimap. Both maps show positions only, not where anyone is facing.',
      `You have ${S.shotTimerSec} s per kick. When the timer hits zero the ball is kicked with whatever you had set.`,
      'The whole flight plays out at once, then the ball goes to the closest player when it stops. If it is a tie, the team that did not kick gets it.',
    ],
  },
  {
    id: 'ball',
    title: 'The ball and the players',
    bullets: [
      'Players never move, but the ball bounces off them. Lob it over their heads or curve it around them.',
      'Goalkeepers have a wide reach: if the ball touches one, it is caught and that team kicks next from where the keeper stands.',
      'Posts, crossbar and nets are solid. A goal needs the whole ball over the line, between the posts and under the bar.',
    ],
  },
  {
    id: 'restarts',
    title: 'Goals and restarts',
    bullets: [
      'After a goal, the team that conceded kicks off from the center spot.',
      `Over a touchline: throw-in for the team that did not touch it last. Power is capped at ${throwCapPct} % and curve is locked. A goal straight from a throw-in does not count.`,
      'Over a goal line: if an attacker touched it last, the defending keeper gets a goal kick; if a defender touched it last, the attackers get a corner.',
      'Offside, fouls and cards do not exist.',
    ],
  },
  {
    id: 'match',
    title: 'The match',
    paragraphs: [
      `A match is ${S.kicksPerMatch} kicks, shared between both teams. Half-time comes after half of them, with the other team kicking off. More goals wins; level is a draw. Every kick counts, including kickoffs and restarts.`,
    ],
  },
];

/** Desktop controls (PLAN §6.2). */
export const KEY_ROWS: readonly KeyRow[] = [
  { action: 'Turn (yaw)', mouse: 'Drag left / right', keys: '← →  (Shift = fine)' },
  { action: 'Look up / down', mouse: 'Drag up / down', keys: '↑ ↓' },
  { action: 'Zoom', mouse: 'Mouse wheel', keys: '+  −' },
  { action: 'Camera height', mouse: 'Height slider', keys: 'PageUp / PageDown' },
  { action: 'Power', mouse: 'Power slider', keys: 'W / S' },
  { action: 'Curve', mouse: 'Curve slider', keys: 'A / D' },
  { action: 'Loft', mouse: 'Loft slider', keys: 'Q / E' },
  { action: 'Kick', mouse: 'KICK button', keys: 'Space' },
  { action: 'Overhead map', mouse: 'Hold the map button', keys: 'Hold Tab' },
  { action: 'Fast-forward playback', mouse: '—', keys: 'Hold F' },
  { action: 'Playback camera', mouse: '—', keys: 'C' },
  { action: 'Mute / unmute sound', mouse: 'Speaker button', keys: 'M' },
  { action: 'This help', mouse: '—', keys: 'H' },
];

/** Placement-phase controls. */
export const PLACEMENT_ROWS: readonly KeyRow[] = [
  { action: 'Place a player', mouse: 'Click the pitch', keys: '' },
  { action: 'Move / remove', mouse: 'Drag / right-click', keys: '' },
  { action: 'Pan the view', mouse: 'Left-drag', keys: 'W A S D' },
  { action: 'Rotate / zoom', mouse: 'Right-drag / wheel', keys: '' },
  { action: 'Top-down view', mouse: '—', keys: 'T' },
];

function table(rows: readonly KeyRow[]): HTMLElement {
  return h(
    'table',
    { class: 'help-keys' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Mouse'), h('th', {}, 'Keyboard'))),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h('tr', {}, h('td', {}, r.action), h('td', {}, r.mouse), h('td', {}, r.keys ? h('kbd', {}, r.keys) : '')),
      ),
    ),
  );
}

function sectionEl(s: HelpSection): HTMLElement {
  return h(
    'section',
    { class: 'help-section', id: `help-${s.id}` },
    h('h2', {}, s.title),
    ...(s.paragraphs ?? []).map((p) => h('p', {}, p)),
    s.bullets ? h('ul', {}, ...s.bullets.map((b) => h('li', {}, b))) : null,
  );
}

/** The key table on its own (used by the in-match overlay). */
export function controlsTable(): HTMLElement {
  return h('div', {}, table(KEY_ROWS), h('h3', {}, 'While placing players'), table(PLACEMENT_ROWS));
}

/** Full "How to play" screen: rules, then controls. */
export function howToPlayScreen(): HTMLElement {
  return h(
    'div',
    { class: 'panel card help', 'data-screen': 'howto' },
    h('div', { class: 'help-head' }, h('h1', {}, 'How to play'), h('a', { class: 'btn', href: '#/' }, '← Menu')),
    h('div', { class: 'help-body' }, ...RULE_SECTIONS.map(sectionEl), h('section', { class: 'help-section', id: 'help-controls' }, h('h2', {}, 'Controls'), controlsTable())),
  );
}
