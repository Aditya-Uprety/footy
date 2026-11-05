import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { LAW1, derivePitch, rectContains } from './pitch';

const P = derivePitch(DEFAULT_SETTINGS);
const width = (r: { zMin: number; zMax: number }) => r.zMax - r.zMin;
const depth = (r: { xMin: number; xMax: number }) => r.xMax - r.xMin;

describe('derivePitch (defaults)', () => {
  it('uses the settings length and width', () => {
    expect(P.length).toBe(DEFAULT_SETTINGS.pitchLength);
    expect(P.width).toBe(DEFAULT_SETTINGS.pitchWidth);
    expect(P.field).toEqual({
      xMin: -DEFAULT_SETTINGS.pitchLength / 2,
      xMax: DEFAULT_SETTINGS.pitchLength / 2,
      zMin: -DEFAULT_SETTINGS.pitchWidth / 2,
      zMax: DEFAULT_SETTINGS.pitchWidth / 2,
    });
  });

  it('has FIFA box sizes at both ends', () => {
    for (const end of P.ends) {
      expect(width(end.penaltyArea)).toBeCloseTo(40.32, 9);
      expect(depth(end.penaltyArea)).toBeCloseTo(16.5, 9);
      expect(width(end.goalArea)).toBeCloseTo(18.32, 9);
      expect(depth(end.goalArea)).toBeCloseTo(5.5, 9);
    }
  });

  it('puts Team A at -x and Team B at +x, boxes touching their goal lines', () => {
    const [a, b] = P.ends;
    expect(a.team).toBe(0);
    expect(a.goalLineX).toBe(-P.halfLength);
    expect(a.penaltyArea.xMin).toBe(-P.halfLength);
    expect(b.team).toBe(1);
    expect(b.goalLineX).toBe(P.halfLength);
    expect(b.penaltyArea.xMax).toBe(P.halfLength);
  });

  it('places penalty marks 11 m from the goal line', () => {
    for (const end of P.ends) {
      expect(Math.abs(end.penaltyMark.x - end.goalLineX)).toBeCloseTo(11, 9);
      expect(end.penaltyMark.z).toBe(0);
    }
  });

  it('draws the penalty arc only outside the box, meeting the box edge', () => {
    for (const end of P.ends) {
      const arc = end.penaltyArc;
      const boxEdgeX = end.side < 0 ? end.penaltyArea.xMax : end.penaltyArea.xMin;
      for (const ang of [arc.arcStart, arc.arcEnd]) {
        const x = arc.center.x + arc.radius * Math.cos(ang);
        expect(x).toBeCloseTo(boxEdgeX, 9);
      }
      const mid = (arc.arcStart + arc.arcEnd) / 2;
      const xm = arc.center.x + arc.radius * Math.cos(mid);
      const zm = arc.center.z + arc.radius * Math.sin(mid);
      expect(rectContains(end.penaltyArea, xm, zm)).toBe(false);
      expect(Math.abs(xm)).toBeLessThan(Math.abs(boxEdgeX));
    }
  });

  it('has 7.32 m between inner post edges and the bar underside at 2.44 m', () => {
    for (const end of P.ends) {
      const g = end.goal;
      const inner = 2 * (g.postZ - g.postRadius);
      expect(inner).toBeCloseTo(7.32, 9);
      expect(g.crossbar.a.y - g.postRadius).toBeCloseTo(2.44, 9);
      // Front face of the post flush with the goal line (§5.2).
      expect(Math.abs(g.postX) - g.postRadius).toBeCloseTo(P.halfLength, 9);
      // Back net at ±(L/2 + 2.06).
      expect(Math.abs(g.netBackX)).toBeCloseTo(P.halfLength + 2.06, 9);
    }
  });

  it('has the center circle, corner arcs and a 1 m placement margin', () => {
    expect(P.centerCircleR).toBe(9.15);
    expect(P.cornerArcR).toBe(1);
    expect(P.lineWidth).toBe(0.12);
    expect(P.placementBounds.xMax).toBe(P.halfLength - LAW1.FIELD_MARGIN);
    expect(P.placementBounds.zMin).toBe(-P.halfWidth + LAW1.FIELD_MARGIN);
    expect(P.corners).toHaveLength(4);
  });
});

describe('derivePitch (other sizes)', () => {
  it('scales lines with L and W but keeps Law-1 boxes fixed', () => {
    const q = derivePitch({ pitchLength: 120, pitchWidth: 90 });
    expect(q.halfLength).toBe(60);
    expect(q.halfWidth).toBe(45);
    expect(width(q.ends[1].penaltyArea)).toBeCloseTo(40.32, 9);
    expect(q.ends[1].penaltyMark.x).toBeCloseTo(49, 9);
  });
});
