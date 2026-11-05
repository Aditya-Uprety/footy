// Always-on minimap (PLAN §6.1, M5.4): a 2D canvas, bottom-left, with the
// same content and rules as the overhead map (render/overheadMap mapContent):
// positions only, fixed orientation, the kicker ringed at its own center, no
// ball while aiming.
import { KIT_COLORS } from '../render/players';
import type { MapContent, MapOrientation } from '../render/overheadMap';
import type { Pitch } from '../shared/pitch';
import { h } from './dom';

/** Minimap width in CSS px (height follows the pitch's aspect). */
export const MINIMAP_WIDTH = 230;
/** Margin around the field on the minimap, m. */
export const MINIMAP_MARGIN = 3.5;

export interface MapTransform {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** px per m. */
  scale: number;
  /** World (x, z) → canvas (px, py). */
  toCanvas(x: number, z: number): { px: number; py: number };
}

/**
 * Projection for a minimap `width` px wide: orientation +1 puts Team A's goal
 * (x = −L/2) on the left with +z down; −1 rotates the map 180°.
 */
export function minimapTransform(pitch: Pitch, width = MINIMAP_WIDTH, orientation: MapOrientation = 1, margin = MINIMAP_MARGIN): MapTransform {
  const wl = pitch.length + 2 * margin;
  const ww = pitch.width + 2 * margin;
  const scale = width / wl;
  const height = Math.round(ww * scale);
  return {
    width,
    height,
    scale,
    toCanvas(x, z) {
      return { px: width / 2 + orientation * x * scale, py: height / 2 + orientation * z * scale };
    },
  };
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export interface Minimap {
  readonly el: HTMLElement;
  draw(content: MapContent): void;
  setOrientation(o: MapOrientation): void;
  dispose(): void;
}

export function createMinimap(pitch: Pitch, orientation: MapOrientation = 1): Minimap {
  let orient = orientation;
  let tf = minimapTransform(pitch, MINIMAP_WIDTH, orient);
  const canvas = h('canvas', { class: 'minimap-canvas', 'aria-label': 'Minimap' });
  const el = h('div', { class: 'minimap', 'data-panel': 'minimap' }, canvas);
  const ctx = canvas.getContext('2d');
  let last: MapContent | null = null;

  function size(): number {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(tf.width * dpr);
    canvas.height = Math.round(tf.height * dpr);
    canvas.style.width = `${tf.width}px`;
    canvas.style.height = `${tf.height}px`;
    return dpr;
  }
  let dpr = size();

  function lines(c: CanvasRenderingContext2D): void {
    const P = (x: number, z: number): [number, number] => {
      const p = tf.toCanvas(x, z);
      return [p.px, p.py];
    };
    const rect = (r: { xMin: number; xMax: number; zMin: number; zMax: number }): void => {
      const [ax, ay] = P(r.xMin, r.zMin);
      const [bx, by] = P(r.xMax, r.zMax);
      c.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    };
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 1;
    rect(pitch.field);
    c.beginPath();
    c.moveTo(...P(0, -pitch.halfWidth));
    c.lineTo(...P(0, pitch.halfWidth));
    c.stroke();
    c.beginPath();
    c.arc(...P(0, 0), pitch.centerCircleR * tf.scale, 0, Math.PI * 2);
    c.stroke();
    for (const end of pitch.ends) {
      rect(end.penaltyArea);
      rect(end.goalArea);
      // Goal mouth, drawn just behind the line.
      c.save();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2.5;
      c.beginPath();
      const gx = end.goalLineX + end.side * 0.9;
      c.moveTo(...P(gx, -end.goal.halfWidth));
      c.lineTo(...P(gx, end.goal.halfWidth));
      c.stroke();
      c.restore();
    }
  }

  function draw(content: MapContent): void {
    last = content;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, tf.width, tf.height);
    ctx.fillStyle = '#2f7a35';
    ctx.fillRect(0, 0, tf.width, tf.height);
    lines(ctx);
    const r = Math.max(2.6, 1.5 * tf.scale);
    for (const p of content.players) {
      const { px, py } = tf.toCanvas(p.x, p.z);
      ctx.beginPath();
      ctx.arc(px, py, p.gk ? r * 1.15 : r, 0, Math.PI * 2);
      ctx.fillStyle = hex(p.gk ? KIT_COLORS[p.team].gk : KIT_COLORS[p.team].outfield);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
    if (content.kicker) {
      const { px, py } = tf.toCanvas(content.kicker.x, content.kicker.z);
      ctx.beginPath();
      ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffe14d';
      ctx.stroke();
    }
    if (content.ball) {
      const { px, py } = tf.toCanvas(content.ball.x, content.ball.z);
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#111';
      ctx.stroke();
    }
  }

  return {
    el,
    draw,
    setOrientation(o) {
      orient = o;
      tf = minimapTransform(pitch, MINIMAP_WIDTH, orient);
      dpr = size();
      if (last) draw(last);
    },
    dispose() {
      el.remove();
    },
  };
}
