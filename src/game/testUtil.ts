// PURE. Test helpers shared by the rules and HostCore tests (not used by the app).

import { createRng, type Rng } from '../shared/rng';
import { DRAFT_SCHEDULE, PICK_COUNT, randomPick } from './draft';
import { applyPick, chooseRole, newMatch } from './rules';
import { defaultSettings, type Settings } from './settings';
import type { GameState } from './types';

/** A match after the toss (winner takes Team A) and a random legal draft: phase 'play', A to kick off. */
export function draftedMatch(seed = 1, settings: Partial<Settings> = {}, rng: Rng = createRng(seed)): GameState {
  let s = newMatch({ ...defaultSettings(), ...settings }, ['Ann', 'Bob'], rng);
  s = chooseRole(s, s.toss.winner, 'A');
  for (let pick = 0; pick < PICK_COUNT; pick++) {
    const team = DRAFT_SCHEDULE[pick]!.team;
    s = applyPick(s, team, randomPick(s, team, rng));
  }
  return s;
}
