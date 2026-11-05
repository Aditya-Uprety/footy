import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { kick } from '../game/rules';
import { draftedMatch } from '../game/testUtil';
import type { GameState } from '../game/types';
import {
  isGameState,
  isIntent,
  isWireKickResult,
  msg,
  parseGuestMessage,
  parseHostMessage,
  peekHelloProto,
  PROTOCOL_VERSION,
  type WireKickResult,
} from './protocol';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function sample(): { state: GameState; next: GameState; wire: WireKickResult } {
  const state = draftedMatch(7);
  const { result, next } = kick(state, 0, { yaw: 0.3, power: 0.6, curve: 0.2, loft: 0.1 });
  const frames = Buffer.from(result.frames.buffer, result.frames.byteOffset, result.frames.byteLength).toString('base64');
  return { state: clone(state), next: clone(next), wire: clone({ ...result, frames }) };
}

describe('message builder', () => {
  it('stamps the version and type', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(msg('ping', { ts: 3 })).toEqual({ v: 1, t: 'ping', ts: 3 });
    expect(msg('hello', { name: 'Ann', proto: 1 })).toEqual({ v: 1, t: 'hello', name: 'Ann', proto: 1 });
  });
});

describe('guest message guards', () => {
  const valid = [
    msg('hello', { name: 'Bob', proto: 1 }),
    msg('hello', { name: 'Bob', proto: 1, resume: 'abc123' }),
    msg('intent', { intent: { type: 'tossChoice', role: 'B' } }),
    msg('intent', { intent: { type: 'place', pick: 3, spots: [{ x: -10, z: 4, gk: false }, { x: -40, z: 0, gk: true }] } }),
    msg('intent', { intent: { type: 'kick', turnId: 9, input: { yaw: 1, power: 0.5, curve: -1, loft: 0 }, auto: true } }),
    msg('intent', { intent: { type: 'rematch' } }),
    msg('aim', { turnId: 4, yaw: -2.5 }),
    msg('ping', { ts: 123.5 }),
    msg('pong', { ts: 0 }),
    msg('bye', { reason: 'left' }),
  ];

  it('accepts every valid guest message (also after a JSON round trip)', () => {
    for (const m of valid) {
      expect(parseGuestMessage(m)).toEqual(m);
      expect(parseGuestMessage(clone(m))).toEqual(m);
    }
  });

  it('rejects malformed guest messages', () => {
    const bad: unknown[] = [
      null,
      42,
      'ping',
      [],
      {},
      { t: 'ping', ts: 1 }, // no version
      { v: 2, t: 'ping', ts: 1 }, // other version
      { v: 1, t: 'nope' },
      { v: 1, t: 'ping' },
      { v: 1, t: 'ping', ts: 'soon' },
      { v: 1, t: 'ping', ts: Infinity },
      { v: 1, t: 'hello', proto: 1 },
      { v: 1, t: 'hello', name: 'x'.repeat(65), proto: 1 },
      { v: 1, t: 'hello', name: 'Bob', proto: 1.5 },
      { v: 1, t: 'hello', name: 'Bob', proto: 1, resume: 7 },
      { v: 1, t: 'intent' },
      { v: 1, t: 'intent', intent: { type: 'tossChoice', role: 'C' } },
      { v: 1, t: 'intent', intent: { type: 'place', pick: 1, spots: [{ x: 1, z: 2 }] } },
      { v: 1, t: 'intent', intent: { type: 'place', pick: 1, spots: [{ x: 1, z: NaN, gk: false }] } },
      { v: 1, t: 'intent', intent: { type: 'place', pick: 1, spots: [1, 2, 3] } },
      { v: 1, t: 'intent', intent: { type: 'kick', turnId: 1, input: { yaw: 0, power: 1, curve: 0 }, auto: false } },
      { v: 1, t: 'intent', intent: { type: 'kick', turnId: 1, input: { yaw: 0, power: 1, curve: 0, loft: 0 } } },
      { v: 1, t: 'intent', intent: { type: 'shoot' } },
      { v: 1, t: 'aim', turnId: 1.2, yaw: 0 },
      { v: 1, t: 'aim', turnId: 1, yaw: null },
      { v: 1, t: 'bye' },
      { v: 1, t: 'welcome', seat: 1, resume: 'x', proto: 1 }, // a host message
    ];
    for (const b of bad) expect(parseGuestMessage(b), JSON.stringify(b)).toBeNull();
  });

  it('peekHelloProto reads the version of any hello', () => {
    expect(peekHelloProto(msg('hello', { name: 'a', proto: 1 }))).toBe(1);
    expect(peekHelloProto({ v: 2, t: 'hello', name: 'a', proto: 2 })).toBe(2);
    expect(peekHelloProto({ v: 3, t: 'hello' })).toBe(3);
    expect(peekHelloProto({ v: 1, t: 'ping', ts: 1 })).toBeNull();
    expect(peekHelloProto('hello')).toBeNull();
  });
});

describe('host message guards', () => {
  const { state, next, wire } = sample();

  it('accepts every valid host message (real state and kick result)', () => {
    const valid = [
      msg('welcome', { seat: 1, resume: 'tok', proto: 1 }),
      msg('welcome', { seat: 1, resume: 'tok', proto: 1, name: 'Ann' }),
      msg('reject', { reason: 'full' }),
      msg('reject', { reason: 'version' }),
      msg('reject', { reason: 'ended' }),
      msg('state', { state }),
      msg('kick', { result: wire, next }),
      msg('aim', { turnId: 2, yaw: 0.5 }),
      msg('denied', { intentType: 'place', reason: 'Illegal spot', violations: [{ spot: 0, code: 'teammate', message: 'Too close' }] }),
      msg('denied', { intentType: 'kick', reason: 'Not your turn' }),
      msg('ping', { ts: 1 }),
      msg('pong', { ts: 1 }),
      msg('bye', { reason: 'host left' }),
    ];
    for (const m of valid) expect(parseHostMessage(clone(m)), m.t).toEqual(m);
    expect(isGameState(state)).toBe(true);
    expect(isGameState(next)).toBe(true);
    expect(isWireKickResult(wire)).toBe(true);
  });

  it('lets a reject of any version through (so "refresh" can be shown)', () => {
    expect(parseHostMessage({ v: 2, t: 'reject', reason: 'version' })).toEqual({ v: 2, t: 'reject', reason: 'version' });
    expect(parseHostMessage({ v: 2, t: 'reject', reason: 'whatever' })).toBeNull();
  });

  it('accepts settings with or without a kit pair, rejects a non-integer one', () => {
    const settings = { ...state.settings };
    expect(parseHostMessage({ v: 1, t: 'settings', settings: { ...settings, kitPair: 2 } })).not.toBeNull();
    const { kitPair: _drop, ...older } = settings;
    expect(parseHostMessage({ v: 1, t: 'settings', settings: older })).not.toBeNull();
    expect(parseHostMessage({ v: 1, t: 'settings', settings: { ...settings, kitPair: 'red' } })).toBeNull();
  });

  it('rejects malformed host messages', () => {
    const broken = (f: (s: Record<string, unknown>) => void): GameState => {
      const s = clone(state) as unknown as Record<string, unknown>;
      f(s);
      return s as unknown as GameState;
    };
    const bad: unknown[] = [
      { v: 1, t: 'welcome', seat: 0, resume: 'x', proto: 1 },
      { v: 1, t: 'welcome', seat: 1, proto: 1 },
      { v: 1, t: 'welcome', seat: 1, resume: 'x', proto: 1, name: 5 },
      { v: 1, t: 'state' },
      { v: 1, t: 'state', state: broken((s) => (s.phase = 'extra-time')) },
      { v: 1, t: 'state', state: broken((s) => (s.score = [1])) },
      { v: 1, t: 'state', state: broken((s) => (s.players = [{ id: 1 }])) },
      { v: 1, t: 'state', state: broken((s) => (s.possession = { team: 0, kicker: { kind: 'robot' }, restart: 'kickoff' })) },
      { v: 1, t: 'state', state: broken((s) => delete s.settings) },
      { v: 1, t: 'state', state: broken((s) => (s.half = 3)) },
      { v: 1, t: 'kick', result: wire },
      { v: 1, t: 'kick', result: { ...wire, frames: 'not base64!' }, next },
      { v: 1, t: 'kick', result: { ...wire, frames: [1, 2, 3] }, next },
      { v: 1, t: 'kick', result: { ...wire, outcome: { kind: 'goal' } }, next },
      { v: 1, t: 'kick', result: { ...wire, events: [{ kind: 'kick' }] }, next },
      { v: 1, t: 'denied', intentType: 'fly', reason: 'x' },
      { v: 1, t: 'denied', intentType: 'place', reason: 'x', violations: [{ spot: 0, code: 'nope', message: 'x' }] },
      { v: 1, t: 'bye', reason: 3 },
      { v: 1, t: 'hello', name: 'Ann', proto: 1 }, // a guest message
    ];
    for (const b of bad) expect(parseHostMessage(b), JSON.stringify(b).slice(0, 120)).toBeNull();
  });

  it('isIntent matches what HostCore expects', () => {
    expect(isIntent({ type: 'place', pick: 0, spots: [] })).toBe(true);
    expect(isIntent({ type: 'place', pick: 0, spots: [{ x: 0, z: 0, gk: false }, { x: 0, z: 0, gk: false }, { x: 0, z: 0, gk: false }] })).toBe(false);
  });
});
