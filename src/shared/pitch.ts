// PURE. Law-1 pitch constants and the derived geometry that every other layer
// (rendering, physics, rules) reads from. PLAN §2.2, §5.1, §5.2.
//
// Axes: origin at the center spot, +y up, x along the length (Team A's goal
// line at x = -L/2, Team B's at +L/2), z across (touchlines at z = ±W/2).
// For rules every line is its outer edge, so the boundaries below are the
// outer edges; markings are drawn inward from them (LINE_WIDTH wide).

/** Fixed Law-1 dimensions (metres). Only L and W come from Settings. */
export const LAW1 = {
  CENTER_CIRCLE_R: 9.15,
  GOAL_AREA_DEPTH: 5.5,
  GOAL_AREA_WIDTH: 18.32,
  PENALTY_AREA_DEPTH: 16.5,
  PENALTY_AREA_WIDTH: 40.32,
  PENALTY_MARK_DIST: 11,
  PENALTY_ARC_R: 9.15,
  CORNER_ARC_R: 1,
  LINE_WIDTH: 0.12,
  /** Between the inner edges of the posts. */
  GOAL_WIDTH: 7.32,
  /** Ground to the underside of the crossbar. */
  GOAL_HEIGHT: 2.44,
  POST_DIAMETER: 0.12,
  NET_DEPTH: 2.0,
  /** Placement keeps player centers this far inside the lines (§2.3.4a). */
  FIELD_MARGIN: 1,
} as const;

/** The subset of game Settings that pitch geometry depends on. */
export interface PitchSettings {
  pitchLength: number;
  pitchWidth: number;
}

/** Axis-aligned rectangle on the ground (x/z), inclusive bounds. */
export interface Rect2 {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface Point2 {
  x: number;
  z: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Segment between two 3D points (post / crossbar axes). */
export interface Segment3 {
  a: Point3;
  b: Point3;
}

/** Everything about one end of the pitch. `side` is -1 for Team A's goal (x < 0), +1 for Team B's. */
export interface PitchEnd {
  /** The team defending this end: 0 = A (x < 0), 1 = B (x > 0). */
  team: 0 | 1;
  side: -1 | 1;
  /** x of the goal line's outer edge (±L/2). */
  goalLineX: number;
  penaltyArea: Rect2;
  goalArea: Rect2;
  penaltyMark: Point2;
  /**
   * Penalty arc: circle of PENALTY_ARC_R around the mark, only the part
   * outside the penalty area. Angles are measured in the x/z plane from +x
   * (atan2(z, x) around the mark); the arc spans [arcStart, arcEnd].
   */
  penaltyArc: { center: Point2; radius: number; arcStart: number; arcEnd: number };
  goal: {
    /** Inner post edges at z = ±halfWidth. */
    halfWidth: number;
    /** Underside of the crossbar. */
    height: number;
    postRadius: number;
    /** Post axis x (front face flush with the goal line). */
    postX: number;
    /** Post axis z (±). */
    postZ: number;
    /** Post/bar axis top height (= bar axis y). */
    postTop: number;
    leftPost: Segment3;
    rightPost: Segment3;
    crossbar: Segment3;
    /** x of the back net plane. */
    netBackX: number;
    netDepth: number;
  };
}

export interface Pitch {
  length: number;
  width: number;
  halfLength: number;
  halfWidth: number;
  lineWidth: number;
  centerSpot: Point2;
  centerCircleR: number;
  cornerArcR: number;
  /** Outer edges of the touchlines and goal lines. */
  field: Rect2;
  /** Where player centers may be placed (field shrunk by FIELD_MARGIN). */
  placementBounds: Rect2;
  corners: Point2[];
  /** ends[0] = Team A's end (x = -L/2), ends[1] = Team B's end (x = +L/2). */
  ends: [PitchEnd, PitchEnd];
}

function deriveEnd(team: 0 | 1, halfLength: number): PitchEnd {
  const side: -1 | 1 = team === 0 ? -1 : 1;
  const goalLineX = side * halfLength;
  const inward = -side; // direction from the goal line toward the center

  const box = (depth: number, width: number): Rect2 => {
    const x1 = goalLineX;
    const x2 = goalLineX + inward * depth;
    return { xMin: Math.min(x1, x2), xMax: Math.max(x1, x2), zMin: -width / 2, zMax: width / 2 };
  };

  const markX = goalLineX + inward * LAW1.PENALTY_MARK_DIST;
  // Box edge is PENALTY_AREA_DEPTH from the goal line, i.e. (depth - markDist) beyond the mark.
  const beyond = LAW1.PENALTY_AREA_DEPTH - LAW1.PENALTY_MARK_DIST;
  const halfAngle = Math.acos(beyond / LAW1.PENALTY_ARC_R);
  // The arc bulges toward the center: direction angle 0 (+x) for Team A's end, PI for Team B's.
  const towardCenter = inward > 0 ? 0 : Math.PI;

  const postRadius = LAW1.POST_DIAMETER / 2;
  const halfGoal = LAW1.GOAL_WIDTH / 2;
  const postX = goalLineX + side * postRadius;
  const postZ = halfGoal + postRadius;
  const postTop = LAW1.GOAL_HEIGHT + postRadius;

  return {
    team,
    side,
    goalLineX,
    penaltyArea: box(LAW1.PENALTY_AREA_DEPTH, LAW1.PENALTY_AREA_WIDTH),
    goalArea: box(LAW1.GOAL_AREA_DEPTH, LAW1.GOAL_AREA_WIDTH),
    penaltyMark: { x: markX, z: 0 },
    penaltyArc: {
      center: { x: markX, z: 0 },
      radius: LAW1.PENALTY_ARC_R,
      arcStart: towardCenter - halfAngle,
      arcEnd: towardCenter + halfAngle,
    },
    goal: {
      halfWidth: halfGoal,
      height: LAW1.GOAL_HEIGHT,
      postRadius,
      postX,
      postZ,
      postTop,
      leftPost: { a: { x: postX, y: 0, z: -postZ }, b: { x: postX, y: postTop, z: -postZ } },
      rightPost: { a: { x: postX, y: 0, z: postZ }, b: { x: postX, y: postTop, z: postZ } },
      crossbar: { a: { x: postX, y: postTop, z: -postZ }, b: { x: postX, y: postTop, z: postZ } },
      // §5.2: back net at ±(L/2 + 2.06) = post axis + NET_DEPTH.
      netBackX: postX + side * LAW1.NET_DEPTH,
      netDepth: LAW1.NET_DEPTH,
    },
  };
}

/** Derives all pitch geometry from the length and width settings. */
export function derivePitch(settings: PitchSettings): Pitch {
  const length = settings.pitchLength;
  const width = settings.pitchWidth;
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const m = LAW1.FIELD_MARGIN;
  return {
    length,
    width,
    halfLength,
    halfWidth,
    lineWidth: LAW1.LINE_WIDTH,
    centerSpot: { x: 0, z: 0 },
    centerCircleR: LAW1.CENTER_CIRCLE_R,
    cornerArcR: LAW1.CORNER_ARC_R,
    field: { xMin: -halfLength, xMax: halfLength, zMin: -halfWidth, zMax: halfWidth },
    placementBounds: { xMin: -halfLength + m, xMax: halfLength - m, zMin: -halfWidth + m, zMax: halfWidth - m },
    corners: [
      { x: -halfLength, z: -halfWidth },
      { x: halfLength, z: -halfWidth },
      { x: halfLength, z: halfWidth },
      { x: -halfLength, z: halfWidth },
    ],
    ends: [deriveEnd(0, halfLength), deriveEnd(1, halfLength)],
  };
}

export function rectContains(r: Rect2, x: number, z: number): boolean {
  return x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax;
}
