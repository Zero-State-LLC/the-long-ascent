// src/engine/save-v6.js — SPEC v6 §2: the side-scroller save wrapper.
// Pure module. The core game state stays the single source of truth (all six
// pools, flags, chronicle, arcs, badges, crossingUnlocked); v6 adds walk-position
// fields that let Continue restart at the last era boundary (SPEC §2). Old saves
// migrate through the existing migration.js OLD_TO_NEW_ERA path first (game.js
// deserialize), then gain their v6 fields here.

import { OLD_TO_NEW_ERA, SAVE_VERSION_V3 } from '../core/migration.js';
import { SEG_W } from './world.js';

export const SAVE_V6_FIELDS = ['walkX', 'lastBoundaryEra', 'resolvedEncounters'];

/** Restart x for Continue: the flat pad just inside the saved era's segment. */
export function entryXForEra(era) {
  return (Math.min(17, Math.max(1, era)) - 1) * SEG_W + 120;
}

/** Fraction walked toward the next seam (0..1) for the HUD hairline. */
export function boundaryProgress(walkX) {
  const inSeg = ((walkX % SEG_W) + SEG_W) % SEG_W;
  return Math.min(1, Math.max(0, inSeg / SEG_W));
}

/**
 * Upgrade a deserialized v3 game state with v6 walk fields (idempotent).
 * Mutates and returns `state`.
 */
export function attachV6Fields(state) {
  if (!Array.isArray(state.resolvedEncounters)) state.resolvedEncounters = [];
  if (!Number.isFinite(state.walkX)) {
    state.walkX = entryXForEra(Number.isFinite(state.era) ? state.era : 1);
  }
  if (!Number.isFinite(state.lastBoundaryEra)) state.lastBoundaryEra = Number.isFinite(state.era) ? state.era : 1;
  return state;
}

/**
 * Full-load pipeline used by the boot layer: raw JSON (v2/v3/v6) → game state
 * with v6 fields. `game` must be a fresh createGame() instance; this applies
 * its deserialize (which runs the v2→v3 OLD_TO_NEW_ERA migration itself) and
 * then attaches the walk fields.
 */
export function loadStateV6(game, json) {
  const state = game.deserialize(json);
  // deserialize may have remapped era (legacy save): re-seat walkX if absent.
  if (!Number.isFinite(state.walkX) || state.walkX < 0) state.walkX = entryXForEra(state.era);
  return attachV6Fields(state);
}

/** Serialize through the game's own serializer, ensuring v6 fields are present. */
export function saveStringV6(game) {
  attachV6Fields(game.state);
  return game.serialize();
}

/** True when a raw parsed save predates v6 (needs entry-point placement). */
export function isPreV6Save(save) {
  return !!save && typeof save === 'object' && !Number.isFinite(save.walkX);
}

// Re-export so boot/tests can assert the migration table without double imports.
export { OLD_TO_NEW_ERA, SAVE_VERSION_V3 };
