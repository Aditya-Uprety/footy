import { describe, expect, it } from 'vitest';
import { PICK_COUNT } from '../game/draft';
import { activeSeat } from '../game/rules';
import { defaultSettings } from '../game/settings';
import type { GameState } from '../game/types';
import { LocalSession, type Denial } from './session';

function session(seed = 7, now?: () => number) {
  return new LocalSession({ settings: defaultSettings(), names: ['Ann', ' Bob '], seed, tickMs: 0, ...(now ? { now } : {}) });
}

describe('LocalSession (M7.5)', () => {
  it('both seats are local; names are sanitized; starts at the toss', () => {
    const s = session();
    expect(s.kind).toBe('local');
    expect(s.localSeats).toEqual([0, 1]);
    expect(s.state.phase).toBe('toss');
    expect(s.state.seatNames).toEqual(['Ann', 'Bob']);
  });

  it('toss → 12 picks → play, with a state callback per change', () => {
    const s = session();
    const states: GameState[] = [];
    s.onState((st) => states.push(st));
    const winner = s.state.toss.winner;
    s.send(winner, { type: 'tossChoice', role: 'B' });
    expect(s.state.phase).toBe('placement');
    expect(s.state.toss.teamOfSeat![winner]).toBe(1);
    for (let p = 0; p < PICK_COUNT; p++) {
      const seat = activeSeat(s.state)!;
      expect(s.randomPick(seat === 0 ? 1 : 0)).toBeNull(); // not the other seat's pick
      s.send(seat, s.randomPick(seat)!);
      expect(s.state.pick).toBe(p + 1);
    }
    expect(s.state.phase).toBe('play');
    expect(s.state.players).toHaveLength(22);
    expect(s.state.possession?.team).toBe(0);
    expect(states).toHaveLength(1 + PICK_COUNT);
    s.dispose();
  });

  it('refusals reach onDenied with the reason and violations', () => {
    const s = session();
    const denied: Denial[] = [];
    s.onDenied((d) => denied.push(d));
    const loser = s.state.toss.winner === 0 ? 1 : 0;
    s.send(loser, { type: 'tossChoice', role: 'A' });
    expect(denied[0]).toMatchObject({ seat: loser, intentType: 'tossChoice', reason: 'Only the toss winner chooses' });
    s.send(s.state.toss.winner, { type: 'tossChoice', role: 'A' });
    const seatA = activeSeat(s.state)!;
    s.send(seatA, { type: 'place', pick: 0, spots: [{ x: 1, z: 1, gk: false }] });
    expect(denied[1]!.intentType).toBe('place');
    expect(denied[1]!.violations?.map((v) => v.code)).toEqual(['centerCircle']);
    expect(s.state.pick).toBe(0);
  });

  it('runs the placement guard on its injected clock', () => {
    let t = 0;
    const s = new LocalSession({
      settings: { ...defaultSettings(), placementTimerSec: 20 },
      names: ['A', 'B'],
      seed: 3,
      now: () => t,
      tickMs: 0,
    });
    s.send(s.state.toss.winner, { type: 'tossChoice', role: 'A' });
    t = 34_000;
    s.core.tick(t);
    expect(s.state.pick).toBe(0);
    t = 35_000;
    s.core.tick(t);
    expect(s.state.pick).toBe(1);
  });
});
