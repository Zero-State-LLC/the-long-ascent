// src/core/migration.js — SPEC §10.6(3): save migration v2 -> v3.
//
// The 17-era spine inserts 6 new eras (SPEC §10.1), so a v2 save's era number
// points at the wrong slot. This module re-keys everything era-numbered and
// attaches the v3 arc state, preserving Chronicle + lineageMods verbatim.

export const SAVE_VERSION_V3 = 3;

// Old era num -> new era num (insertion table, SPEC §10.1).
export const OLD_TO_NEW_ERA = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 9, 8: 11, 9: 13, 10: 15, 11: 17 };

// Keys inside lineageMods that carry an era number suffix (e.g. fork_era7).
const ERA_KEY_RE = /^(.*?)(\d+)$/;

function remapEraKey(key) {
  const m = ERA_KEY_RE.exec(key);
  if (!m) return key;
  const n = Number(m[2]);
  const mapped = OLD_TO_NEW_ERA[n];
  return mapped == null ? key : `${m[1]}${mapped}`;
}

/** True when a raw save blob is a v2 (or older/absent version) save. */
export function isLegacySave(save) {
  return !!save && typeof save === 'object' && (save.version == null || save.version < SAVE_VERSION_V3);
}

/**
 * Migrate a v2 save object to v3. Pure: returns a NEW object, never mutates.
 * - era: remapped through OLD_TO_NEW_ERA (out-of-range numbers clamp to 16).
 * - eraGoalsDone: every completed old era maps forward (the goal was earned in
 *   that slot; the inserted eras are skipped history, not unclaimed goals).
 * - chronicle / lineageMods / badges / flags / resources: preserved verbatim,
 *   with era-numbered keys inside lineageMods re-keyed to the new numbering.
 * - arcs: fresh v3 arc state attached (game.js migrates it further via arcs.migrateInto).
 */
export function migrateV2toV3(save) {
  if (!isLegacySave(save)) return save;
  const out = structuredClone(save);
  out.version = SAVE_VERSION_V3;
  out.migratedFrom = save.version == null ? 2 : save.version;

  if (Number.isFinite(out.era)) {
    out.era = OLD_TO_NEW_ERA[out.era] != null ? OLD_TO_NEW_ERA[out.era] : Math.min(Math.max(out.era, 1), 17);
  }
  if (Array.isArray(out.eraGoalsDone)) {
    out.eraGoalsDone = [...new Set(out.eraGoalsDone.map((n) => (OLD_TO_NEW_ERA[n] != null ? OLD_TO_NEW_ERA[n] : n)))].sort((a, b) => a - b);
  }
  if (out.lineageMods && typeof out.lineageMods === 'object') {
    const remapped = {};
    for (const [k, v] of Object.entries(out.lineageMods)) remapped[remapEraKey(k)] = v;
    out.lineageMods = remapped;
  }
  out.arcs = out.arcs || { custodian: null, benthic: { deals: [] }, rival: { mirrorChoices: [] } };
  return out;
}
