// src/engine/stations.js — SPEC v9 §1/§2: stations as spine.
// Encounters become in-world stations: approaching within STATION_APPROACH_PX
// freezes the sim (tick paused, world keeps painting), the chrome layer shows
// the lower-third panel, and committing lands the numbers with a ≤3 s
// consequence beat. Esc leaves a station unresolved — it stays READY.
//
// The 236 encounters are reused verbatim (encounters.js owns ready/prompt/active
// FSM and resolve math); this module is the station coupling layer:
//   action feeds choice — current pools/hand gate + dim choices with reasons;
//   choice feeds action — resolution mutates the traversed world (deltas +
//   consequence beat for prop spawn/scorch via juice.pickupFx).
// Soft-lock impossible: a station whose every choice is dimmed offers a
// guaranteed walk-away row (entropy +1).

import { STATION_APPROACH_PX, CONSEQUENCE_BEAT_S, TRIGGER_COOLDOWN_S } from './feel.js';
import { decorateChoices } from './actionChoices.js';
import { dimReasonKeyFor } from './v9copy.js';

const WALK_AWAY_EFFECTS = { entropy: 1 }; // v9-copy station_ui: the ledger takes the fee

/**
 * @param {object} deps {
 *   encounters  createEncounterSystem() instance (FSM + resolve math)
 *   game        createGame() instance (state pools)
 *   actions     createActionSystem() instance (hand/countables for gating) — optional
 *   copy        loadV9Copy() instance
 *   rng         seeded prng for line rotation
 * }
 */
export function createStations({ encounters, game, actions = null, copy, rng = Math.random, nearClimbable = false }) {
  let active = null;        // the encounter object whose panel is open
  let menuIndex = 0;        // ↑↓ selection
  let beatLeft = 0;         // consequence beat remaining (≤3 s)
  let lastDeltas = null;    // deltas landing during the beat
  let leaveCooldown = 0;    // s before the same station can reopen after Esc
  let lastLeftId = null;

  /** Decorate the active station's choices: dimmed-with-reason + walk-away row. */
  function viewChoices(obj) {
    const ctx = { state: game.state, actions, nearClimbable };
    let decorated = decorateChoices(obj?.choices || [], ctx);
    // Rewrite unmet reasons with Scribe's dim-reason copy (≤48 chars).
    decorated = decorated.map((c) => {
      if (!c.disabled) return c;
      const key = dimReasonKeyFor(c);
      return { ...c, requirement: key ? copy.dimReason(key, c.requirement || '') : (c.requirement || copy.dimReason('pool_too_low_sustenance')) };
    });
    // Soft-lock guard: every choice dimmed → guaranteed walk-away row.
    if (decorated.length && decorated.every((c) => c.disabled)) {
      decorated = [...decorated, {
        label: copy.walkAwayLine(rng),
        disabled: false,
        walkAway: true,
        effects: WALK_AWAY_EFFECTS,
      }];
    }
    return decorated;
  }

  /**
   * Per-tick update. Opens a station when the player comes within 40 px of a
   * READY encounter object (the encounters FSM already marks READY at TRIGGER_R
   * 48; the station panel tightens approach to the spec's 40 px).
   * @returns {{opened, left, committed}} events for the boot layer.
   */
  function update(player, dt) {
    const ev = { opened: null, left: null, committed: null };
    if (beatLeft > 0) beatLeft = Math.max(0, beatLeft - dt);
    if (leaveCooldown > 0) leaveCooldown = Math.max(0, leaveCooldown - dt);

    if (active) return ev; // panel already up; input routes through key()

    // Nearest READY encounter within approach radius (skip a just-left one
    // until the cooldown expires — Esc means "not now", not an instant loop).
    let best = null, bestD = Infinity;
    for (const o of encounters.objects) {
      if (!(o.choices && o.choices.length)) continue;
      if (encounters.stateOf(o.id) !== 'ready') continue;
      if (leaveCooldown > 0 && o.id === lastLeftId) continue;
      const d = Math.abs(o.x - (player.x + player.w / 2));
      if (d <= STATION_APPROACH_PX && d < bestD) { bestD = d; best = o; }
    }
    if (best) {
      active = best;
      menuIndex = 0;
      // The resolve path lives in encounters.js (its `active` owns choose()).
      // Open its menu alongside the panel so commit routes through unchanged
      // resolve math (SPEC §1: encounters.js ready/prompt/active is the contract).
      encounters.open(best.id);
      ev.opened = best;
    }
    return ev;
  }

  /** Is the sim frozen right now? (tick.js reads this to pause stepping) */
  function isFrozen() { return active !== null; }

  /** Consequence beat still playing (numbers land visibly; world re-animated). */
  function inBeat() { return beatLeft > 0; }

  /** Panel view-model for the chrome layer. */
  function panel() {
    if (!active) return null;
    return {
      title: active.title || '',
      prompt: active.prompt || '',
      choices: viewChoices(active),
      selectedIndex: menuIndex,
      hints: copy.stationUi(),
      inBeat: beatLeft > 0,
    };
  }

  /** Commit the highlighted (or named) choice. Returns the resolve result. */
  function commit(label = null) {
    if (!active) return { ok: false, error: 'no station open' };
    const choices = viewChoices(active);
    const pick = label
      ? choices.find((c) => c.label === label)
      : choices[menuIndex];
    if (!pick) return { ok: false, error: 'unknown choice' };
    if (pick.disabled) return { ok: false, error: 'choice is dimmed' };
    let res;
    if (pick.walkAway) {
      // The walk-away row is a station-layer native: entropy +1, no effects
      // routing through encounters (the station was never resolved).
      const state = game.state;
      state.resources.entropy = Math.max(0, (state.resources.entropy || 0) + 1);
      state.chronicle.push({
        era: state.era, carrier: state.carrier, seq: state.chronicle.length, kind: 'decision',
        text: `Era ${state.era}: Carrier ${state.carrier} walked away from “${active.title || active.id}”. The ledger took its fee.`,
      });
      if (encounters.active?.id === active.id) encounters.closeMenu('walkaway');
      lastDeltas = { entropy: 1 };
      beatLeft = CONSEQUENCE_BEAT_S;
      const leftId = active.id;
      active = null;
      return { ok: true, id: leftId, label: pick.label, deltas: lastDeltas, walkAway: true, beatS: CONSEQUENCE_BEAT_S };
    }
    res = encounters.choose(pick.label);
    if (res.ok) {
      lastDeltas = res.deltas || {};
      beatLeft = CONSEQUENCE_BEAT_S;
      const wasWalkAway = !!pick.walkAway;
      active = null;
      ev_commitHook(res);
      return { ...res, walkAway: wasWalkAway, beatS: CONSEQUENCE_BEAT_S };
    }
    return res;
  }
  function ev_commitHook() { /* hook for boot-layer sfx/juice via returned result */ }

  /** Navigate the panel (↑↓). Returns the new index. */
  function move(dir) {
    if (!active) return menuIndex;
    const n = viewChoices(active).length;
    menuIndex = ((menuIndex + (dir === 'up' ? -1 : 1)) % n + n) % n;
    return menuIndex;
  }

  /** Esc: leave unresolved. The station stays READY (SPEC §3) — with a short
   *  reopen cooldown so standing in range doesn't insta-loop the panel. */
  function leave() {
    if (!active) return null;
    const id = active.id;
    active = null;
    lastLeftId = id;
    leaveCooldown = TRIGGER_COOLDOWN_S;
    // Close the underlying encounters menu without resolving (stays READY).
    if (encounters.active?.id === id) encounters.closeMenu('user');
    return { id, leftUnresolved: true };
  }

  /** Boot layer wires real dim-reason lookup here (avoids an import cycle). */
  function attachDimReasonLookup(fn) { globalThis.__v9dimReasonKeyFor = fn; }

  return {
    update, commit, leave, move, panel, isFrozen, inBeat, attachDimReasonLookup,
    viewChoices,
    get active() { return active; },
    get lastDeltas() { return lastDeltas; },
    get beatLeft() { return beatLeft; },
  };
}

export const WALK_AWAY = WALK_AWAY_EFFECTS;
