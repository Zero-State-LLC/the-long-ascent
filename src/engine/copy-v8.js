// src/engine/copy-v8.js — SPEC-v8 §3: Scribe's copy wired into the world.
// Pure module (no DOM): looks up ambient whispers (research/ambient-v8.json),
// consequence echoes (research/echoes-v8.json) and collapse reasons
// (research/collapse-v8.json, keyed by damage source). Text only — scheduling
// lives in juice.createWhisper; placement/rendering lives in the boot layer.

/** Ambient lines for an era, in file order. */
export function ambientLinesForEra(ambientDoc, era) {
  return (ambientDoc?.lines || []).filter((l) => l.era === era).map((l) => l.text);
}

/** Index echo docs by encounter id for O(1) lookup. */
export function indexEchoes(echoesDoc) {
  const byId = new Map();
  for (const e of echoesDoc?.echoes || []) byId.set(e.id, e);
  return byId;
}

/**
 * The consequence sign near the NEXT boundary after `encounterId` resolved
 * (SPEC §3: "a one-line consequence echo near the next boundary"). Shown at
 * most once per run (ids tracked in state.v8.echoSeen).
 * @returns {{id:string, text:string}|null}
 */
export function echoForEncounter(echoIndex, encounterId, stateV8 = null) {
  if (!encounterId) return null;
  const e = echoIndex.get(encounterId);
  if (!e) return null;
  if (stateV8 && Array.isArray(stateV8.echoSeen) && stateV8.echoSeen.includes(e.id)) return null;
  return { id: e.id, text: e.text };
}

/** Mark an echo as shown (persisted via state.v8.echoSeen). */
export function markEchoSeen(stateV8, id) {
  if (!stateV8) return;
  if (!Array.isArray(stateV8.echoSeen)) stateV8.echoSeen = [];
  if (!stateV8.echoSeen.includes(id)) stateV8.echoSeen.push(id);
}

// Damage-source keys used by research/collapse-v8.json vs. entity hazard types.
const SOURCE_ALIASES = {
  boar: 'boar', wolf: 'wolf', stray_dog: 'stray_dog', bandit: 'bandit',
  soldier_patrol: 'soldier', smog: 'smog', radiation_zone: 'radiation',
  datastorm: 'datastorm',
};

/** Collapse reason line for a damage source ('' → generic). Never undefined. */
export function collapseLine(collapseDoc, hazardType) {
  const reasons = collapseDoc?.reasons || [];
  const key = SOURCE_ALIASES[hazardType] || 'generic';
  const hit = reasons.find((r) => r.source === key) || reasons.find((r) => r.source === 'generic');
  return hit ? hit.text : 'You stopped. The road did not.';
}
