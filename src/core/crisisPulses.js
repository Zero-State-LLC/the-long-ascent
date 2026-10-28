// src/core/crisisPulses.js — SPEC §10.3: pool-threshold crisis pulses.
//
// When a pool crosses its crisis threshold, the resource chip pulses once and a
// one-line toast from v3-mini crisis_pulses (a {pool: line} map) explains. No
// modal, no pause. Rate limited: latch per pool until it recovers, max 1 pulse
// per 30s overall.

import { CRISIS_COOLDOWN_MS } from './opportunities.js';

/**
 * Danger thresholds per pool: `above` fires when value >= threshold,
 * `below` when value <= threshold. Entropy rises into danger; every other pool
 * falls into it. Values chosen to match the game's ceiling (±100).
 */
export const CRISIS_THRESHOLDS = {
  sustenance: { below: 25 },
  knowledge: { below: 10 },
  population: { below: 8 },
  infrastructure: { below: 10 },
  legitimacy: { below: -40 },
  entropy: { above: 70 },
};

/** Fresh tracker: which pools are latched in crisis + global cooldown clock. */
export function createCrisisTracker() {
  return { latched: {}, lastPulseAt: -Infinity };
}

/** Is `pool` currently in crisis for `value`? */
export function inDanger(pool, value) {
  const th = CRISIS_THRESHOLDS[pool];
  if (!th || typeof value !== 'number') return false;
  if (th.above != null) return value >= th.above;
  return value <= th.below;
}

/**
 * Detect NEW crisis crossings after a choice resolved. Mutates the tracker
 * (that is its job), returns [{ pool, line }] for each pulse that should fire,
 * honoring: latch per pool (no repeat until recovered) + 30s global cooldown.
 * `pulses` = v3-mini crisis_pulses ({ pool: "one-line copy" }).
 */
export function checkCrossings(tracker, prevResources, nextResources, pulses, now) {
  const fired = [];
  for (const pool of Object.keys(CRISIS_THRESHOLDS)) {
    const before = prevResources?.[pool];
    const after = nextResources?.[pool];
    if (before == null || after == null) continue;
    const was = inDanger(pool, before);
    const is = inDanger(pool, after);
    if (!is) { delete tracker.latched[pool]; continue; }   // recovery clears the latch
    if (tracker.latched[pool]) continue;                    // already pulsed this crisis
    if (now - tracker.lastPulseAt < CRISIS_COOLDOWN_MS) continue; // global 30s limit
    void was;
    tracker.latched[pool] = true;
    tracker.lastPulseAt = now;
    fired.push({ pool, line: (pulses && pulses[pool]) || null });
  }
  return fired;
}
