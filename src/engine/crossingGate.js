// src/engine/crossingGate.js — SPEC v6 §1: The Crossing stays the era-16 set
// piece. Thin gate around the untouched crossing.js logic: walking into the
// launch gantry in era 16 unlocks the Crossing (state.crossingUnlocked, same
// field the old title screen used); the unlock keeps its own confirmation
// screen (host UI), and launching builds a crossing.js run from live state.

import { createCrossingRun, settleCrossing } from '../core/crossing.js';

export const CROSSING_GATE_ERA = 16; // the Long Silence (SPEC §1/§2)

/** Walk-triggered unlock: idempotent, chronicle once. Returns true if newly unlocked. */
export function unlockCrossing(state, chronicleFn = null) {
  if (state.crossingUnlocked) return false;
  state.crossingUnlocked = true;
  if (chronicleFn) chronicleFn('Reached the launch gantry in the Long Silence. THE CROSSING is open.', 'crossing');
  else {
    state.chronicle.push({
      era: state.era, carrier: state.carrier, seq: state.chronicle.length, kind: 'crossing',
      text: 'Reached the launch gantry in the Long Silence. THE CROSSING is open.',
    });
  }
  return true;
}

/** Build a playable run seeded from the current run so replays differ. */
export function launchCrossing(state, { reducedMotion = false } = {}) {
  const seed = ((state.tickCount * 2654435761) ^ (state.era * 97) ^ 0xc0ffee) >>> 0;
  return createCrossingRun({ seed, entropy: state.resources.entropy, reducedMotion });
}

/** Settle a finished run against game state (rewards/losses per crossing.js contract). */
export function settle(state, run) {
  const CEILING = 1000;
  const clamp = (x) => Math.max(-CEILING, Math.min(CEILING, x));
  return settleCrossing(state, run, clamp);
}
