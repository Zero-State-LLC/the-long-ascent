// src/engine/actions.js — SPEC v7 §1: the input verbs + one-hand system.
// Pure module (no DOM, no timers): a per-tick action state machine fed the v6
// input snapshot extended with { sprint, crouch, aimHeld, throwPressed, dropPressed }
// and read by tick.js / entities.js / the boot layer. The v6 player physics is
// NOT modified: sprint scales the run target via opts.maxRunOverride, crouch
// publishes a half-height contract (player.h) that crawl_gap checks, and the
// throw spawns a projectile entity through entities.js.
//
// Constants (SPEC §1 verbatim):
//   sprint  = 1.6 × MAX_RUN, stamina 100, drain 25/s, regen 18/s, 0 = no sprint
//   crouch  = half height (PLAYER_H/2), required for crawl_gap + sneaking
//   throw   = hold X to aim, release to launch; gravity ×0.8; 0.6 s fuse on
//             combustibles (torch); consumes the held item
//   one hand = game.state.v7.held ∈ HELD_ITEMS ∪ {null}

import { MAX_RUN, PLAYER_H, TILE } from './feel.js';

export const SPRINT_MULT = 1.6;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 25;   // per second while sprinting
export const STAMINA_REGEN = 18;   // per second while not sprinting
export const CROUCH_H = PLAYER_H / 2;

export const THROW_GRAV_MULT = 0.8; // projectile gravity scale (SPEC §1)
export const FUSE_S = 0.6;          // combustible fuse after launch
export const AIM_MIN_S = 0.08;      // a tap still throws (weakly)
export const AIM_MAX_S = 1.0;       // hold longer than this = full power
export const THROW_SPEED_MIN = 240; // px/s at a tap
export const THROW_SPEED_MAX = 560; // px/s at full hold
export const THROW_ANGLE = 0.55;    // radians above horizontal (~31°)

export const HELD_ITEMS = Object.freeze(['stone', 'torch', 'spear', 'fruit', 'tool']);

/** Attach the v7 sub-state to a game state (idempotent). */
export function ensureV7State(state) {
  if (!state.v7 || typeof state.v7 !== 'object') state.v7 = {};
  const v = state.v7;
  if (!HELD_ITEMS.includes(v.held) && v.held !== null && v.held !== undefined) v.held = null;
  if (v.held === undefined) v.held = null;
  if (!Number.isFinite(v.stamina)) v.stamina = STAMINA_MAX;
  if (!Array.isArray(v.depletedBushes)) v.depletedBushes = [];   // terrain ids gathered bare this run
  if (!Array.isArray(v.placedRopes)) v.placedRopes = [];         // anchor ids with a rope (persists)
  if (!Array.isArray(v.gatesUsed)) v.gatesUsed = [];             // era numbers whose advantage path was taken
  if (!v.inventory || typeof v.inventory !== 'object') v.inventory = {}; // currency-ish countables: coin/credit/...
  return v;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * @param {object} deps { game, player, onThrow(projectileSpec) → void }
 *   game   createGame() instance (state.v7 lives here).
 *   player createPlayer() instance (crouch mutates player.h; sprint reads/writes nothing there).
 *   onThrow called with { item, x, y, vx, vy, fuse|null, era } when a throw releases.
 */
export function createActionSystem({ game, player, onThrow }) {
  ensureV7State(game.state);
  const v7 = game.state.v7;

  const a = {
    sprinting: false,
    crouching: false,
    aiming: false,
    aimT: 0,            // seconds the aim has been held this press
    lastThrowReason: null,
    collapse: null,     // set by the collapse hook (tick.js), cleared on respawn
  };

  // ---- one-hand system ------------------------------------------------------
  /** Take an item into the hand. Returns false when the hand is busy. */
  function pickup(item) {
    if (!HELD_ITEMS.includes(item)) return false;
    if (v7.held !== null) return false;
    v7.held = item;
    return true;
  }
  /** Free the hand; returns the released item or null. */
  function drop() {
    const was = v7.held;
    v7.held = null;
    return was;
  }
  /** Swap in one call (pickup piles use this: old item is replaced, lost). */
  function swapHand(item) {
    const prev = v7.held;
    v7.held = HELD_ITEMS.includes(item) ? item : null;
    return prev;
  }

  // ---- countable inventory (coin/credit/etc. for pay-gates) ------------------
  function addCountable(key, n = 1) {
    v7.inventory[key] = Math.max(0, (v7.inventory[key] || 0) + n);
  }
  function spendCountable(key, n = 1) {
    if ((v7.inventory[key] || 0) < n) return false;
    v7.inventory[key] -= n;
    return true;
  }
  function countable(key) { return v7.inventory[key] || 0; }

  // ---- throw -----------------------------------------------------------------
  /** Release the aim: spawn the projectile spec (or record why not). */
  function releaseThrow(era) {
    const item = v7.held;
    if (!item) {
      a.lastThrowReason = 'empty hand';
      return null;
    }
    const t = clamp(a.aimT, AIM_MIN_S, AIM_MAX_S);
    const frac = (t - AIM_MIN_S) / (AIM_MAX_S - AIM_MIN_S);
    const speed = THROW_SPEED_MIN + (THROW_SPEED_MAX - THROW_SPEED_MIN) * frac;
    const dir = player.facing || 1;
    const spec = {
      item,
      x: player.x + player.w / 2 + dir * (player.w / 2),
      y: player.y + (a.crouching ? 8 : 4),
      vx: Math.cos(THROW_ANGLE) * speed * dir,
      vy: -Math.sin(THROW_ANGLE) * speed,
      fuse: item === 'torch' ? FUSE_S : null,
      era,
    };
    v7.held = null; // consuming happens at launch (SPEC §1)
    a.lastThrowReason = null;
    if (onThrow) onThrow(spec);
    return spec;
  }

  // ---- per-tick update ---------------------------------------------------------
  /**
   * @param {{sprint,crouch,aimHeld,dropPressed}} input v7 verb snapshot (all optional)
   * @param {number} dt
   * @returns {{thrown}|null} event when a throw released this tick
   */
  function update(input = {}, dt) {
    let ev = null;

    // Sprint: only while actually moving and stamina remains (SPEC §1).
    const moving = !!(input.left || input.right);
    const wantSprint = !!input.sprint && moving && v7.stamina > 0;
    a.sprinting = wantSprint;
    if (wantSprint) v7.stamina = Math.max(0, v7.stamina - STAMINA_DRAIN * dt);
    else v7.stamina = Math.min(STAMINA_MAX, v7.stamina + STAMINA_REGEN * dt);

    // Crouch: half height. Feet stay planted: adjust y when the box shrinks/grows.
    const wantCrouch = !!input.crouch;
    if (wantCrouch !== a.crouching) {
      if (wantCrouch) {
        const feet = player.y + player.h;
        player.h = CROUCH_H;
        player.y = feet - CROUCH_H;
      } else {
        // Only stand when there's headroom (crawl_gap keeps you folded).
        if (!a.blockedStand) {
          const feet = player.y + player.h;
          player.h = PLAYER_H;
          player.y = feet - PLAYER_H;
        }
      }
      a.crouching = wantCrouch && player.h === CROUCH_H;
    }

    // Aim/throw edges.
    if (input.aimHeld) {
      if (!a.aiming) { a.aiming = true; a.aimT = 0; }
      a.aimT += dt;
    } else if (a.aiming) {
      a.aiming = false;
      ev = { thrown: releaseThrow(input.era) };
      a.aimT = 0;
    }

    // Drop (edge passed in by the host as a one-frame pulse).
    if (input.dropPressed) {
      const dropped = drop();
      if (dropped) ev = { ...(ev || {}), dropped };
    }

    return ev;
  }

  /** Effective run-speed cap for this tick (player host applies this). */
  function speedCap() {
    return a.sprinting ? MAX_RUN * SPRINT_MULT : MAX_RUN;
  }

  /** Sprint stamina fraction 0..1 for the HUD pip. */
  function staminaFrac() { return v7.stamina / STAMINA_MAX; }

  return Object.assign(a, {
    update, pickup, drop, swapHand, releaseThrow, speedCap, staminaFrac,
    addCountable, spendCountable, countable,
    get held() { return v7.held; },
  });
}
