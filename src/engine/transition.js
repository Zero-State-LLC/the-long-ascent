// src/engine/transition.js — SPEC v6 §2: era transition as a set piece.
// Pure state machine: walking through a boundary structure freezes the camera
// (camera.hold), crossfades palettes over 2 s, re-equips the figure (the host
// swaps player_era sheets on the `reequip` event), and advances the core game's
// era exactly once. No menus, no dialogs — the world itself is the transition.

import { ERA_HOLD_S } from './feel.js';

export const TR_PHASE = { NONE: 'none', HOLD: 'hold', CROSSFADE: 'crossfade', DONE: 'done' };
export const CROSSFADE_S = 2.0; // SPEC §2: palette crossfade + re-equip ≈ 2 s

/**
 * @param {object} game core createGame() instance (advanceEra lives behind it)
 * @param {object} camera engine camera (for position-lock)
 */
export function createTransition(game, camera) {
  const t = {
    phase: TR_PHASE.NONE,
    fromEra: 1,
    toEra: 2,
    elapsed: 0,
    reequipFired: false,
  };

  /** Kick off the set piece for entering `toEra`. Returns false if already running. */
  function begin(toEra) {
    if (t.phase !== TR_PHASE.NONE && t.phase !== TR_PHASE.DONE) return false;
    if (toEra > 17) return false;
    t.fromEra = game.state.era;
    t.toEra = toEra;
    // The core era must move with the walk immediately: encounter choice pools,
    // arc gating and save data all key off state.era (SPEC §2). The crossfade
    // is pure presentation on top of that.
    while (game.state.era < toEra) {
      if (typeof game._gotoEra === 'function') game._gotoEra(game.state.era + 1);
      else break;
    }
    game.chronicle(`Era ${game.state.era} begins: ${game.eraDef()?.name || 'a new era'}. The pace quickens. It always quickens.`, 'era');
    t.phase = TR_PHASE.HOLD;
    t.elapsed = 0;
    t.reequipFired = false;
    camera.hold(ERA_HOLD_S);
    return true;
  }

  /**
   * Advance the set piece. Returns event flags { reequip, finished } for the
   * host (sheet swap at the crossfade midpoint, audio sting).
   */
  function update(dt) {
    const out = { reequip: false, finished: false };
    if (t.phase === TR_PHASE.NONE || t.phase === TR_PHASE.DONE) return out;
    t.elapsed += dt;
    if (t.phase === TR_PHASE.HOLD && t.elapsed >= ERA_HOLD_S * 0.5) {
      t.phase = TR_PHASE.CROSSFADE;
    }
    if (!t.reequipFired && t.elapsed >= CROSSFADE_S * 0.5) {
      t.reequipFired = true;
      out.reequip = true;
    }
    if (t.elapsed >= CROSSFADE_S) {
      t.phase = TR_PHASE.DONE;
      out.finished = true;
    }
    return out;
  }

  /** Crossfade alpha for the renderer: 0 = old era full, 1 = new era full. */
  function alpha() {
    if (t.phase === TR_PHASE.NONE) return 1;
    if (t.phase === TR_PHASE.HOLD) return 0;
    return Math.min(1, (t.elapsed - ERA_HOLD_S * 0.5) / (CROSSFADE_S - ERA_HOLD_S * 0.5));
  }

  /** Reset back to idle (host calls after consuming `finished`). */
  function reset() { t.phase = TR_PHASE.NONE; t.elapsed = 0; t.reequipFired = false; }

  return { state: t, begin, update, alpha, reset, get active() { return t.phase !== TR_PHASE.NONE && t.phase !== TR_PHASE.DONE; } };
}
