// Placeholder screens for routes whose real UI arrives in later milestones (M0.4).
import type { Route } from '../app/router';
import { h } from './dom';

interface PlaceholderInfo {
  title: string;
  text: string;
}

const INFO: Record<Exclude<Route['name'], 'menu'>, PlaceholderInfo> = {
  hotseat: { title: 'Hot-seat match', text: 'Two players on one device. Coming in M7–M8.' },
  host: { title: 'Host online', text: 'Create a room and share the code. Coming in M9–M10.' },
  join: { title: 'Join online', text: 'Join a friend’s room with a code. Coming in M9–M10.' },
  practice: { title: 'Practice', text: 'Solo kicking sandbox. Coming in M5.' },
  lab: { title: 'Physics Lab', text: 'Dev tool: dummies, kick inputs, event log, live constants. It needs WebGL.' },
};

/** Builds the placeholder panel for a route that has no real screen yet. */
export function placeholderScreen(route: Exclude<Route, { name: 'menu' }>, _opts: { dev: boolean }): HTMLElement {
  const info = INFO[route.name];
  const extra =
    route.name === 'join'
      ? h('p', {}, route.code ? 'Room code: ' : 'No room code yet.', route.code ? h('code', {}, route.code) : null)
      : null;
  return h(
    'div',
    { class: 'panel placeholder', 'data-screen': route.name },
    h('h1', {}, info.title),
    h('p', {}, info.text),
    extra,
    h('nav', {}, h('a', { href: '#/' }, '← Menu')),
  );
}
