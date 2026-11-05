// PURE. Wire protocol between the online host and guest (PLAN §8.2).
//
// Every message is `{ v: PROTOCOL_VERSION, t: <type>, ... }`. Both sides run
// every incoming message through `parseGuestMessage` / `parseHostMessage` and
// drop anything malformed (§8.6). The guards check shapes and finite numbers;
// game legality (seat, phase, turn) is HostCore's job.
//
// ping / pong go both ways (each side measures its own RTT and keeps the
// heartbeat alive), see §14 Changelog M9.

import type { KickInput, KickResult, Outcome, SimEvent } from '../sim/types';
import type { GameState, Intent, IntentType, Possession, Settings, Violation } from '../game/types';

export const PROTOCOL_VERSION = 1;

/** A kick result on the wire: frames are base64 of the Float32Array bytes (§5.9). */
export type WireKickResult = Omit<KickResult, 'frames'> & { frames: string };

export type RejectReason = 'full' | 'version' | 'ended';

/** Guest → host. */
export type GuestMessage =
  | { v: 1; t: 'hello'; name: string; proto: number; resume?: string }
  | { v: 1; t: 'intent'; intent: Intent }
  | { v: 1; t: 'aim'; turnId: number; yaw: number }
  | { v: 1; t: 'ping'; ts: number }
  | { v: 1; t: 'pong'; ts: number };

/** Host → guest. */
export type HostMessage =
  | { v: 1; t: 'welcome'; seat: 1; resume: string; proto: number }
  | { v: 1; t: 'reject'; reason: RejectReason }
  | { v: 1; t: 'state'; state: GameState }
  | { v: 1; t: 'kick'; result: WireKickResult; next: GameState }
  | { v: 1; t: 'aim'; turnId: number; yaw: number }
  | { v: 1; t: 'denied'; intentType: IntentType; reason: string; violations?: Violation[] }
  | { v: 1; t: 'ping'; ts: number }
  | { v: 1; t: 'pong'; ts: number }
  | { v: 1; t: 'bye'; reason: string };

export type Message = GuestMessage | HostMessage;
export type GuestMessageType = GuestMessage['t'];
export type HostMessageType = HostMessage['t'];

/** Longest name / reason / token strings accepted from the wire. */
export const MAX_NAME_LEN = 64;
export const MAX_TEXT_LEN = 200;
export const MAX_TOKEN_LEN = 64;

// ---------------------------------------------------------------- builders

type Body<M, T> = M extends { t: T } ? Omit<M, 'v' | 't'> : never;

/** Builds a message with the current version: `msg('ping', { ts })`. */
export function msg<T extends Message['t']>(t: T, body: Body<Message, T>): Extract<Message, { t: T }> {
  return { v: PROTOCOL_VERSION, t, ...body } as unknown as Extract<Message, { t: T }>;
}

// ---------------------------------------------------------------- primitive guards

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function isInt(x: unknown): x is number {
  return isNum(x) && Number.isInteger(x);
}
function isStr(x: unknown, max = MAX_TEXT_LEN): x is string {
  return typeof x === 'string' && x.length <= max;
}
function isBool(x: unknown): x is boolean {
  return typeof x === 'boolean';
}
function isTeam(x: unknown): x is 0 | 1 {
  return x === 0 || x === 1;
}
function isPair<T>(x: unknown, item: (y: unknown) => y is T): x is [T, T] {
  return Array.isArray(x) && x.length === 2 && item(x[0]) && item(x[1]);
}

// ---------------------------------------------------------------- game-type guards

export function isKickInput(x: unknown): x is KickInput {
  return isRec(x) && isNum(x.yaw) && isNum(x.power) && isNum(x.curve) && isNum(x.loft);
}

function isSpotInput(x: unknown): boolean {
  return isRec(x) && isNum(x.x) && isNum(x.z) && isBool(x.gk);
}

export function isIntent(x: unknown): x is Intent {
  if (!isRec(x)) return false;
  switch (x.type) {
    case 'tossChoice':
      return x.role === 'A' || x.role === 'B';
    case 'place':
      return isInt(x.pick) && Array.isArray(x.spots) && x.spots.length <= 2 && x.spots.every(isSpotInput);
    case 'kick':
      return isInt(x.turnId) && isKickInput(x.input) && isBool(x.auto);
    case 'rematch':
      return true;
    default:
      return false;
  }
}

const INTENT_TYPES: readonly string[] = ['tossChoice', 'place', 'kick', 'rematch'];
const VIOLATION_CODES: readonly string[] = [
  'count',
  'notFinite',
  'bounds',
  'centerCircle',
  'gkBox',
  'teammate',
  'opponent',
  'gkCount',
  'gkForced',
  'gkGuard',
];

function isViolation(x: unknown): x is Violation {
  return isRec(x) && isInt(x.spot) && typeof x.code === 'string' && VIOLATION_CODES.includes(x.code) && isStr(x.message);
}

function isTouch(x: unknown): boolean {
  return isRec(x) && isTeam(x.team) && (x.playerId === null || isInt(x.playerId));
}

export function isOutcome(x: unknown): x is Outcome {
  if (!isRec(x)) return false;
  const touchy = (): boolean => isTouch(x.lastTouch) && isInt(x.touches);
  switch (x.kind) {
    case 'goal':
      return isTeam(x.goalOf) && isNum(x.z) && touchy();
    case 'out':
      return (x.line === 'touch' || x.line === 'goal') && isNum(x.x) && isNum(x.z) && touchy();
    case 'catch':
      return isInt(x.keeperId);
    case 'stop':
      return isNum(x.x) && isNum(x.z) && touchy();
    default:
      return false;
  }
}

function isSettings(x: unknown): x is Settings {
  return (
    isRec(x) &&
    isNum(x.pitchLength) &&
    isNum(x.pitchWidth) &&
    isNum(x.minTeammateDist) &&
    isNum(x.minOpponentDist) &&
    isInt(x.kicksPerMatch) &&
    isNum(x.shotTimerSec) &&
    isNum(x.placementTimerSec)
  );
}

function isPlayerSpot(x: unknown): boolean {
  return isRec(x) && isInt(x.id) && isTeam(x.team) && isNum(x.x) && isNum(x.z) && isBool(x.gk) && isInt(x.shirt);
}

const RESTARTS: readonly string[] = ['kickoff', 'throwin', 'corner', 'goalkick', 'catch', 'open'];

function isPossession(x: unknown): x is Possession {
  if (!isRec(x) || !isTeam(x.team) || typeof x.restart !== 'string' || !RESTARTS.includes(x.restart)) return false;
  const k = x.kicker;
  if (!isRec(k)) return false;
  if (k.kind === 'player') return isInt(k.playerId);
  if (k.kind === 'ghost') return isNum(k.x) && isNum(k.y) && isNum(k.z);
  return false;
}

function isLastKick(x: unknown): boolean {
  return (
    isRec(x) &&
    isInt(x.turnId) &&
    isOutcome(x.outcome) &&
    typeof x.awarded === 'string' &&
    RESTARTS.includes(x.awarded) &&
    isTeam(x.team) &&
    (x.disallowed === undefined || isBool(x.disallowed))
  );
}

const PHASES: readonly string[] = ['toss', 'placement', 'play', 'fulltime'];

export function isGameState(x: unknown): x is GameState {
  if (!isRec(x)) return false;
  const toss = x.toss;
  return (
    isInt(x.rev) &&
    typeof x.phase === 'string' &&
    PHASES.includes(x.phase) &&
    isSettings(x.settings) &&
    isPair(x.seatNames, (n): n is string => isStr(n, MAX_NAME_LEN)) &&
    isRec(toss) &&
    isTeam(toss.winner) &&
    (toss.teamOfSeat === null || isPair(toss.teamOfSeat, isTeam)) &&
    isInt(x.pick) &&
    Array.isArray(x.players) &&
    x.players.length <= 22 &&
    x.players.every(isPlayerSpot) &&
    isPair(x.score, isInt) &&
    isInt(x.kicksTaken) &&
    (x.half === 1 || x.half === 2) &&
    (x.possession === null || isPossession(x.possession)) &&
    isInt(x.turnId) &&
    (x.last === null || isLastKick(x.last)) &&
    isPair(x.rematchVotes, isBool)
  );
}

const CONTACT_KINDS: readonly string[] = ['ground', 'player', 'post', 'bar', 'net'];

function isSimEvent(x: unknown): x is SimEvent {
  if (!isRec(x) || !isNum(x.t) || typeof x.kind !== 'string') return false;
  if (CONTACT_KINDS.includes(x.kind)) {
    const base = isNum(x.x) && isNum(x.y) && isNum(x.z) && isNum(x.speed) && (x.tail === undefined || isBool(x.tail));
    return x.kind === 'player' ? base && isInt(x.playerId) && isTeam(x.team) : base;
  }
  switch (x.kind) {
    case 'kick':
      return isNum(x.speed);
    case 'goal':
      return isTeam(x.goalOf);
    case 'out':
      return (x.line === 'touch' || x.line === 'goal') && isNum(x.x) && isNum(x.z);
    case 'catch':
      return isInt(x.keeperId) && isNum(x.x) && isNum(x.y) && isNum(x.z);
    case 'stop':
      return isNum(x.x) && isNum(x.z);
    default:
      return false;
  }
}

function isVec3(x: unknown): boolean {
  return isRec(x) && isNum(x.x) && isNum(x.y) && isNum(x.z);
}

/** Base64 alphabet only, length a multiple of 4 (Float32Array bytes ⇒ a multiple of 16 bytes). */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function isWireKickResult(x: unknown): x is WireKickResult {
  return (
    isRec(x) &&
    isInt(x.turnId) &&
    isKickInput(x.input) &&
    isVec3(x.start) &&
    isVec3(x.spin0) &&
    typeof x.frames === 'string' &&
    x.frames.length % 4 === 0 &&
    BASE64_RE.test(x.frames) &&
    Array.isArray(x.events) &&
    x.events.every(isSimEvent) &&
    isOutcome(x.outcome) &&
    isNum(x.duration)
  );
}

// ---------------------------------------------------------------- message guards

function hasVersion(x: Rec): boolean {
  return x.v === PROTOCOL_VERSION;
}

function isTs(x: Rec): boolean {
  return isNum(x.ts);
}

function isAim(x: Rec): boolean {
  return isInt(x.turnId) && isNum(x.yaw);
}

/**
 * The guest's hello, recognised whatever its `v` is, so a host can answer an
 * old or newer client with `reject{version}` (§8.6). Returns its `proto`.
 */
export function peekHelloProto(x: unknown): number | null {
  if (!isRec(x) || x.t !== 'hello') return null;
  return isNum(x.proto) ? x.proto : isNum(x.v) ? x.v : null;
}

/** A message from the guest, or null if malformed / another version. */
export function parseGuestMessage(x: unknown): GuestMessage | null {
  if (!isRec(x) || !hasVersion(x)) return null;
  switch (x.t) {
    case 'hello':
      return isStr(x.name, MAX_NAME_LEN) && isInt(x.proto) && (x.resume === undefined || isStr(x.resume, MAX_TOKEN_LEN))
        ? (x as GuestMessage)
        : null;
    case 'intent':
      return isIntent(x.intent) ? (x as GuestMessage) : null;
    case 'aim':
      return isAim(x) ? (x as GuestMessage) : null;
    case 'ping':
    case 'pong':
      return isTs(x) ? (x as GuestMessage) : null;
    default:
      return null;
  }
}

/** A message from the host, or null if malformed / another version. */
export function parseHostMessage(x: unknown): HostMessage | null {
  if (!isRec(x)) return null;
  // A reject must get through whatever the version, so "refresh" can be shown.
  if (x.t === 'reject') return x.reason === 'full' || x.reason === 'version' || x.reason === 'ended' ? (x as HostMessage) : null;
  if (!hasVersion(x)) return null;
  switch (x.t) {
    case 'welcome':
      return x.seat === 1 && isStr(x.resume, MAX_TOKEN_LEN) && isInt(x.proto) ? (x as HostMessage) : null;
    case 'state':
      return isGameState(x.state) ? (x as HostMessage) : null;
    case 'kick':
      return isWireKickResult(x.result) && isGameState(x.next) ? (x as HostMessage) : null;
    case 'aim':
      return isAim(x) ? (x as HostMessage) : null;
    case 'denied':
      return typeof x.intentType === 'string' &&
        INTENT_TYPES.includes(x.intentType) &&
        isStr(x.reason) &&
        (x.violations === undefined || (Array.isArray(x.violations) && x.violations.every(isViolation)))
        ? (x as HostMessage)
        : null;
    case 'ping':
    case 'pong':
      return isTs(x) ? (x as HostMessage) : null;
    case 'bye':
      return isStr(x.reason) ? (x as HostMessage) : null;
    default:
      return null;
  }
}
