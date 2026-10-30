// src/engine/encounters.js — SPEC v6 §5: proximity + interaction state machine.
// Pure module. The world's interactive objects (world.js `objects`) plus the
// player position drive a per-object state machine; resolving a choice applies
// through the existing game-state contracts (game.choose-style effects, flags,
// chronicle) and persists consequences: funded objects keep rendering for the
// rest of the run (`state.resolvedEncounters`).
//
// Radii / timings from research/platformer-feel.md §6:
//   hint 160 → glow only · prompt 80 → text fades in · trigger 48 → ↓ valid
//   interact buffer 100 ms · menu dwell 8 s · cooldown 0.4 s.

import {
  TRIGGER_R, TRIGGER_Y, PROMPT_R, PROMPT_FADE_S, HINT_R,
  INTERACT_BUFFER_S, MENU_DWELL_S, TRIGGER_COOLDOWN_S,
} from './feel.js';

export const OBJ_STATE = {
  DORMANT: 'dormant',   // outside hint radius
  HINTED: 'hinted',     // faint glow, no text
  PROMPT: 'prompt',     // "↓" prompt visible, not yet in trigger range
  READY: 'ready',       // inside trigger: ↓ will open the menu
  MENU: 'menu',         // in-world choice menu open (world sim paused by host)
  RESOLVED: 'resolved', // consequence stands; object may still render
};

/**
 * @param {object[]} objects world.objects (needs id, x, prompt, choices)
 * @param {object} game      createGame() instance — apply goes through its state.
 * @param {object} [world]   world.js instance; when present, object feetY is
 *                           derived from the terrain surface for y-overlap.
 */
export function createEncounterSystem(objects, game, world = null) {
  const byId = new Map();
  const st = {}; // id -> per-object runtime { state, fade, cooldown }
  for (const o of objects) {
    // Boundary structures/stones are walk-through set pieces or read-only signs;
    // only objects with choices are interactable via the menu. Stones show their
    // inscription as a prompt but resolve instantly on read (no choices).
    st[o.id] = { state: OBJ_STATE.DORMANT, fadeOutT: 0, cooldown: 0 };
    byId.set(o.id, o);
  }
  let active = null;      // object whose MENU is open
  let interactBuffer = 0; // pre-press timer (fires on entry, feel §6)
  let lastResolved = null;

  // Spatial bucket index (30-tile chunks, feel §6 perf note).
  const BUCKET = 30 * 32;
  const buckets = new Map();
  for (const o of objects) {
    const b = Math.floor(o.x / BUCKET);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(o);
  }
  function nearby(px) {
    const out = [];
    const b = Math.floor(px / BUCKET);
    for (const i of [b - 1, b, b + 1]) for (const o of buckets.get(i) || []) out.push(o);
    return out;
  }

  // Surface height (feet y) of the terrain at world x, via the collider.
  function surfaceFeetY(x) {
    if (!world?.collider) return null;
    for (let y = 0; y < (world.worldH || 640); y += 8) {
      if (world.collider.solidAt(x, y)) return y;
    }
    return null;
  }

  /** Horizontal center distance player↔object (both measured center-x). */
  function dx(obj, player) {
    return Math.abs((obj.x) - (player.x + player.w / 2));
  }
  function yOverlap(obj, player) {
    // Objects stand on the same walkable band as the player at their x; a
    // ±64 window (TRIGGER_Y) around the feet line covers standing and small
    // hops without firing for objects across pits or on ledges overhead.
    const feet = surfaceFeetY(obj.x);
    if (feet == null) return true; // no world given: horizontal-only proximity
    const pFeet = player.y + player.h;
    return Math.abs(pFeet - feet) <= TRIGGER_Y;
  }

  /**
   * Per-tick update. `input.down` edge counts as an interact press (host maps
   * ↓/E/Enter/Space-standing to it). Returns events for the UI layer:
   * { opened, closed, autoClosed }.
   */
  function update({ player, input, dt }) {
    const ev = { opened: null, closed: null, autoClosed: null };
    interactBuffer = Math.max(0, interactBuffer - dt);
    // Interact edge lives on the player box (downWasHeld), not the per-frame
    // input snapshot: sim and encounters consume the same snapshot once.
    const downPressed = !!input?.down && !player.downWasHeld;
    if (downPressed) interactBuffer = INTERACT_BUFFER_S;

    // Menu open pauses the world sim (feel §6): this system holds state.
    if (active) {
      st[active.id].dwell = (st[active.id].dwell || 0) + dt;
      if (st[active.id].dwell >= MENU_DWELL_S) {
        ev.autoClosed = closeMenu('dwell');
      }
      return ev;
    }
    // Consume the edge only when nothing else can use it this tick.
    if (downPressed) player.downWasHeld = true;

    for (const o of nearby(player.x + player.w / 2)) {
      const s = st[o.id];
      s.cooldown = Math.max(0, s.cooldown - dt);
      const d = dx(o, player);
      const interactive = o.choices && o.choices.length > 0;

      let want = OBJ_STATE.DORMANT;
      if (!interactive && !o.inscription) want = OBJ_STATE.DORMANT;
      else if (d <= TRIGGER_R && yOverlap(o, player)) want = OBJ_STATE.READY;
      else if (d <= PROMPT_R) want = OBJ_STATE.PROMPT;
      else if (d <= HINT_R) want = OBJ_STATE.HINTED;
      if (isResolved(o.id) && o.kind !== 'stone') want = OBJ_STATE.RESOLVED;

      // Fade-out grace prevents flicker at the boundary (feel §6).
      if (want === OBJ_STATE.DORMANT && s.state !== OBJ_STATE.DORMANT && s.state !== OBJ_STATE.RESOLVED) {
        s.fadeOutT = PROMPT_FADE_S;
      }
      if (s.fadeOutT > 0) {
        s.fadeOutT -= dt;
        if (want === OBJ_STATE.DORMANT) want = s.state; // hold previous during grace
      }
      s.state = want;

      // Interact fires only from READY (or stone read), never mid-air over pits.
      if (interactBuffer > 0 && s.cooldown === 0 && want === OBJ_STATE.READY) {
        if (interactive) {
          active = o;
          s.state = OBJ_STATE.MENU;
          s.dwell = 0;
          interactBuffer = 0;
          ev.opened = o;
        }
      }
    }
    return ev;
  }

  /** Open a specific object's menu directly (tests, keyboard shortcuts). */
  function open(id) {
    const o = byId.get(id);
    if (!o || !(o.choices && o.choices.length)) return false;
    if (active) closeMenu('replaced');
    active = o;
    st[id].state = OBJ_STATE.MENU;
    st[id].dwell = 0;
    return true;
  }

  function closeMenu(reason) {
    if (!active) return null;
    const id = active.id;
    st[id].state = isResolved(id) ? OBJ_STATE.RESOLVED : OBJ_STATE.READY;
    st[id].cooldown = TRIGGER_COOLDOWN_S;
    const closed = active;
    active = null;
    return { id: closed.id, reason };
  }

  /**
   * Resolve the open menu with a choice label. Applies through the existing
   * game-state contracts: POOLS/clock/morale clamping identical to game.choose,
   * then records persistence so funded objects keep rendering.
   * Returns { ok, deltas, label } or { ok:false, error }.
   */
  function choose(label) {
    if (!active) return { ok: false, error: 'no menu open' };
    const o = active;
    const choice = o.choices.find((c) => c.label === label);
    if (!choice) return { ok: false, error: `unknown choice "${label}" for ${o.id}` };

    const state = game.state;
    const before = { ...state.resources };
    applyEffects(state, choice.effects || {});
    const deltas = {};
    for (const k of Object.keys(before)) {
      const d = Math.round((state.resources[k] - before[k]) * 100) / 100;
      if (d !== 0) deltas[k] = d;
    }
    state.lastDeltas = deltas;
    markResolved(o.id, label);
    state.chronicle.push({
      era: state.era, carrier: state.carrier, seq: state.chronicle.length, kind: 'decision',
      text: `Era ${state.era}: Carrier ${state.carrier} met “${o.title || o.id}” — ${label}.`,
    });
    lastResolved = { id: o.id, label, deltas };
    closeMenu('resolved');
    return { ok: true, id: o.id, label, deltas };
  }

  // ------------------------------------------------------------- persistence
  // Consequences persist for the rest of the run (SPEC §1): resolved ids live
  // on the game state so saves carry them; the renderer keeps drawing funded
  // objects (a granary you paid for stands there forever).
  function markResolved(id, label) {
    const state = game.state;
    if (!Array.isArray(state.resolvedEncounters)) state.resolvedEncounters = [];
    if (!state.resolvedEncounters.some((r) => r.id === id)) {
      state.resolvedEncounters.push({ id, label, era: state.era });
    }
    if (!state.seenEvents.includes(id)) state.seenEvents.push(id);
  }
  function isResolved(id) {
    const list = game.state.resolvedEncounters || [];
    return list.some((r) => (typeof r === 'string' ? r : r.id) === id);
  }
  /** Objects the renderer should draw even when RESOLVED (funded consequences). */
  function persistentObjects() {
    const ids = new Set((game.state.resolvedEncounters || []).map((r) => (typeof r === 'string' ? r : r.id)));
    return objects.filter((o) => ids.has(o.id));
  }

  return {
    update, open, closeMenu, choose, isResolved, persistentObjects,
    get active() { return active; },
    stateOf: (id) => st[id]?.state || OBJ_STATE.DORMANT,
    fadeOf: (id) => st[id]?.fadeOutT || 0,
    get lastResolved() { return lastResolved; },
    objects,
  };
}

// Effects application identical in contract to game.js applyEffects (POOLS
// clamp ±1000, entropy ≥0, clock inverted, morale 0..100) — kept local so the
// engine does not import the idle loop, but the math must match the migration
// tests. If game.js changes its clamps, change these together.
const POOLS = ['sustenance', 'knowledge', 'population', 'infrastructure', 'legitimacy', 'entropy'];
const CEILING = 1000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function applyEffects(state, effects) {
  for (const [k, v] of Object.entries(effects || {})) {
    if (k === 'heir_tax') continue;
    if (POOLS.includes(k)) {
      state.resources[k] = clamp(state.resources[k] + v, k === 'entropy' ? 0 : -CEILING, CEILING);
    } else if (k === 'clock') {
      state.clock = clamp(state.clock - v, 0, 100);
    } else if (k === 'morale') {
      state.morale = clamp(state.morale + v, 0, 100);
    }
  }
}
