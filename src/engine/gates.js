// src/engine/gates.js — SPEC v7 §3: era-boundary progression gating.
// Pure module. Each boundary seam gets TWO doors: the open path (always free)
// and the advantage path (shortcut/cache/arc scene) gated by an era-appropriate
// requirement from research/gates-v7.json. Requirements are visible at the door
// (sign text) so failure is informed, never random. Taking a gate is recorded in
// state.v7.gatesUsed and persists in the save.
//
// Requirement kinds (gates-v7.json):
//   item     — holding that exact item in hand (state.v7.held === key)
//   resource — a pool OR countable ≥ amount. Flavor keys map to the underlying
//              pool: grain/food→sustenance, faith/revolution/selfhood→legitimacy,
//              resolve→morale (a top-level state field, not a pool);
//              coin/credit/carbon credits/scrip read the v7 pocket.
//   action   — a completed action flag present in state.flags (e.g. rung_bell)

export const RESOURCE_KEY_MAP = {
  // signature-resource flavor names → the underlying pool they re-key
  grain: 'sustenance', food: 'sustenance', faith: 'legitimacy',
  revolution: 'legitimacy', selfhood: 'legitimacy',
};
export const TOPLEVEL_KEYS = new Set(['resolve']); // morale lives on state, not resources
export const COUNTABLE_KEYS = new Set(['coin', 'credit', 'carbon credits', 'company scrip']);

/** The gate record for an era (2..17 entering seam; era 1 opens the run). */
export function gateForEra(gatesDoc, era) {
  return (gatesDoc?.gates || []).find((g) => g.era === era) || null;
}

/**
 * Evaluate a gate requirement against live state.
 * @returns {{met:boolean, reason:string, sign:string}}
 */
export function checkGate(gate, state, actions) {
  const v7 = state.v7 || {};
  const r = gate.requirement || {};
  let met = false;
  let reason = '';
  if (r.kind === 'item') {
    met = v7.held === r.key;
    reason = met ? '' : `Requires: ${r.key} in hand`;
  } else if (r.kind === 'resource') {
    const need = Number(r.amount) || 0;
    if (COUNTABLE_KEYS.has(r.key)) {
      const have = (v7.inventory || {})[r.key] || 0;
      met = have >= need;
      reason = met ? '' : `Requires: ${need} ${r.key} (have ${have})`;
    } else if (TOPLEVEL_KEYS.has(r.key)) {
      const have = Number(state.morale ?? 0); // "resolve" is the morale meter
      met = have >= need;
      reason = met ? '' : `Requires: ${need} ${r.key} (have ${Math.round(have)})`;
    } else {
      const pool = RESOURCE_KEY_MAP[r.key] || r.key;
      const have = Number(state.resources?.[pool] ?? 0);
      met = have >= need;
      reason = met ? '' : `Requires: ${need} ${r.key} (have ${Math.round(have)})`;
    }
  } else if (r.kind === 'action') {
    met = (state.flags || []).includes(r.key);
    reason = met ? '' : `Requires: ${r.key.replace(/_/g, ' ')} done`;
  } else {
    met = true; // unknown kind fails OPEN: the open path always exists (SPEC §3)
    reason = '';
  }
  return { met, reason, sign: gate.sign };
}

/**
 * Take the advantage path through an era's gate. Only succeeds when the
 * requirement is met; records the use (persists in save via state.v7).
 * @returns {{ok:boolean, advantage?:string, reason?:string}}
 */
export function takeGate(gatesDoc, state, actions, era) {
  const gate = gateForEra(gatesDoc, era);
  if (!gate) return { ok: false, reason: 'no gate for this era' };
  const chk = checkGate(gate, state, actions);
  if (!chk.met) return { ok: false, reason: chk.reason };
  if (!Array.isArray(state.v7.gatesUsed)) state.v7.gatesUsed = [];
  if (!state.v7.gatesUsed.includes(era)) state.v7.gatesUsed.push(era);
  return { ok: true, advantage: gate.advantage };
}

/** True when the era's advantage path was already taken. */
export function gateTaken(state, era) {
  return (state.v7?.gatesUsed || []).includes(era);
}
