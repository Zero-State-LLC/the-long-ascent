// src/engine/collapse.js — SPEC v7 §5: death & stakes, without death.
// Pure module. Sustenance ≤ 0 → collapse: fade flag, respawn at the last
// boundary, −1 point of one non-entropy resource, toast the reason. No death,
// no reset — a timeline walk shouldn't erase 40 minutes. Entropy is untouched;
// it stays the long-leash meter it already is.

import { POOLS } from '../core/game.js';

/** Collapse trigger: sustenance hits zero (or below). */
export function shouldCollapse(state) {
  return Number(state.resources?.sustenance ?? 0) <= 0;
}

const REASON_BY_HAZARD = {
  boar: 'The boar got you',
  wolf: 'The wolf got you',
  stray_dog: 'The dog worried you to nothing',
  bandit: 'The bandit finished what he started',
  soldier_patrol: 'The patrol made it official',
  smog: 'The smog filled your lungs',
  radiation_zone: 'The fallout caught up',
  datastorm: 'The storm took your bearings',
};

/** Human collapse reason from the last hazard that touched you (SPEC §5:
 *  "The collapse reason is shown"). Falls back to plain hunger. */
export function collapseReason(state) {
  const h = state.__lastHazardHit || state.v7?.lastHazardHit;
  if (h && REASON_BY_HAZARD[h]) return REASON_BY_HAZARD[h];
  return 'Hunger took you at the edge of the era';
}

/**
 * Apply the collapse cost + placement (pure over state; the host moves the
 * player body using the returned respawnEra).
 *  - one non-entropy resource loses 1 point (first positive pool, stable order)
 *  - sustenance floors at 1 so the run can actually continue (no death spiral)
 *  - v7.collapseCount++ for chronicle/tests
 * @returns {{reason:string, lost:{pool:string, from:number, to:number}, respawnEra:number}}
 */
export function applyCollapse(state, entryXForEraFn) {
  const res = state.resources;
  let lost = null;
  for (const p of POOLS) {
    if (p === 'entropy') continue;
    if (p === 'sustenance') continue; // it's already at/below 0; floored below
    if (res[p] > 0) { const from = res[p]; res[p] = from - 1; lost = { pool: p, from, to: res[p] }; break; }
  }
  if (!lost) {
    // every non-entropy pool ≤ 0: entropy pays nothing (SPEC: no new fail state);
    // take the point off the least-negative pool anyway to honor the contract.
    const cand = POOLS.find((p) => p !== 'entropy');
    const from = res[cand]; res[cand] = from - 1; lost = { pool: cand, from, to: res[cand] };
  }
  res.sustenance = Math.max(res.sustenance, 1); // wake with a bite left
  const respawnEra = Math.min(17, Math.max(1, Number(state.lastBoundaryEra) || Number(state.era) || 1));
  state.walkX = typeof entryXForEraFn === 'function' ? entryXForEraFn(respawnEra) : state.walkX;
  if (!state.v7 || typeof state.v7 !== 'object') state.v7 = {};
  state.v7.collapseCount = (state.v7.collapseCount || 0) + 1;
  const reason = collapseReason(state);
  state.chronicle.push({
    era: state.era, carrier: state.carrier, seq: state.chronicle.length, kind: 'collapse',
    text: `Era ${state.era}: Carrier ${state.carrier} collapsed — ${reason}. Woke at the boundary stone. −1 ${lost.pool}.`,
  });
  return { reason, lost, respawnEra };
}
