// src/engine/player.js — SPEC v6 §1/§5: the stick-figure physics body.
// Pure module (no DOM, no timers): a fixed-timestep state machine fed an input
// snapshot { left, right, jumpHeld, down } and a tile collider from world.js.
// All constants come from feel.js (research/platformer-feel.md).
//
// Simulation contract (feel doc §2 implementation notes, "pick one and write
// the test to it"): coyote is decremented BEFORE the jumpability test, so the
// press on the very tick ground is lost still counts (coyote window inclusive
// at 0.1 s); the buffer fires the jump on the first grounded tick after an air
// press and is consumed then.

import {
  GRAVITY, JUMP_SPEED, MAX_FALL, FAST_FALL_MAX, FAST_FALL_ACCEL,
  HALF_GRAV_VY, JUMP_CUT, SNAP_DOWN_DIST, CORNER_CORRECTION,
  COYOTE_S, JUMP_BUFFER_S, MAX_RUN, RUN_ACCEL, RUN_REDUCE, AIR_MULT,
  JUMP_H_BOOST, STOP_EPS, PLAYER_W, PLAYER_H,
} from './feel.js';

export const NO_INPUT = Object.freeze({ left: false, right: false, jumpHeld: false, down: false });

/**
 * @param {object} opts
 *   x, y        spawn position of the collision box's TOP-LEFT corner.
 *   collider    world-side interface:
 *               solidAt(px, py) → bool          (point in solid tile)
 *               snapDown(x, y, maxDist) → floorY|null  (nearest floor within maxDist under feet)
 *               nudgeX(x, y, dir, maxPx) → newX|null   (free spot ≤ maxPx against a corner)
 *   reducedMotion affects nothing here (physics is deterministic either way).
 */
export function createPlayer({ x = 0, y = 0, collider } = {}) {
  if (!collider) throw new Error('player requires a collider');
  const p = {
    x, y,
    w: PLAYER_W, h: PLAYER_H,
    vx: 0, vy: 0,
    facing: 1,                 // 1 right, -1 left
    grounded: false,
    coyote: 0,                 // s of coyote remaining
    buffer: 0,                 // s of buffered jump press remaining
    jumpWasHeld: false,        // edge detection for release-cut
    downWasHeld: false,        // edge detection for ↓ interact (encounters read this)
    fastFalling: false,
    landed: false,             // true for the single tick after touchdown (SFX/UI hook)
    jumped: false,             // true for the single tick a jump fired
    anim: 'idle',              // idle | walk | jump | fall (render reads this)
  };

  const feetY = () => p.y + p.h;

  // Horizontal AABB sweep: move by dx, stop flush against solids.
  function moveX(dx) {
    if (dx === 0) return;
    const dir = Math.sign(dx);
    const steps = Math.ceil(Math.abs(dx));
    const step = dx / steps;
    for (let i = 0; i < steps; i++) {
      const nx = p.x + step;
      if (!boxSolid(nx, p.y)) p.x = nx;
      else break;
    }
  }

  // Vertical AABB sweep: move by dy, land/bonk flush. Returns 'land' | 'bonk' | null.
  function moveY(dy) {
    if (dy === 0) return null;
    const dir = Math.sign(dy);
    const steps = Math.ceil(Math.abs(dy));
    const step = dy / steps;
    let hit = null;
    for (let i = 0; i < steps; i++) {
      const ny = p.y + step;
      if (!boxSolid(p.x, ny)) p.y = ny;
      else { hit = dir > 0 ? 'land' : 'bonk'; break; }
    }
    return hit;
  }

  function boxSolid(bx, by) {
    // Sample edges just inside the box (half-px epsilon keeps tiles exact).
    const eps = 0.5;
    const l = bx + eps, r = bx + p.w - eps, t = by + eps, b = by + p.h - eps;
    for (const yy of [t, (t + b) / 2, b]) {
      if (collider.solidAt(l, yy) || collider.solidAt(r, yy)) return true;
    }
    return false;
  }

  /** Approach `target` from `v` by at most `amount` (Celeste Calc.Approach). */
  function approach(v, target, amount) {
    if (v < target) return Math.min(v + amount, target);
    if (v > target) return Math.max(v - amount, target);
    return v;
  }

  /**
   * Advance one sim step.
   * @param {{left,right,jumpHeld,down}} input snapshot for this tick.
   * @param {number} dt seconds (feed 1/60 for the documented numbers).
   */
  function update(input = NO_INPUT, dt = 1 / 60) {
    p.landed = false;
    p.jumped = false;

    // ---- input edges (sampled BEFORE anything can consume them) --------------
    const pressed = !!input.jumpHeld && !p.jumpWasHeld;
    const released = !input.jumpHeld && p.jumpWasHeld;
    p.jumpWasHeld = !!input.jumpHeld;
    if (pressed) p.buffer = JUMP_BUFFER_S;

    const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (move !== 0) p.facing = move;

    // ---- timers -------------------------------------------------------------
    // Coyote refills to full every grounded tick; decrements otherwise.
    if (p.grounded) p.coyote = COYOTE_S;
    else p.coyote = Math.max(0, p.coyote - dt);
    // Buffer ticks down between frames; a fresh press re-arms it BEFORE the
    // fire test below so a grounded press fires this tick. An air press stays
    // buffered and fires on the first grounded tick after landing (feel §2).
    p.buffer = Math.max(0, p.buffer - dt);
    if (pressed) p.buffer = JUMP_BUFFER_S;

    // ---- jump-cut --------------------------------------------------------------
    // (press/release edges were sampled at the top of update)
    if (released && p.vy < 0) p.vy *= JUMP_CUT;

    // Fire the jump when grounded OR within coyote, if a press is pending.
    // Coyote is decremented BEFORE this test (feel §2 contract): the tick after
    // ground is lost still counts until the window runs out.
    const canJump = p.grounded || p.coyote > 0;
    if (p.buffer > 0 && canJump) {
      p.vy = JUMP_SPEED;
      p.vx += JUMP_H_BOOST * p.facing; // running jumps read longer (feel §4)
      p.grounded = false;
      p.coyote = 0;                    // consume — no free double jump
      p.buffer = 0;
      p.jumped = true;
    }

    // ---- horizontal: accel/friction on ground, air control ×0.7 ---------------
    const mult = p.grounded ? 1 : AIR_MULT;
    if (move !== 0) {
      const target = move * MAX_RUN;
      if (!p.grounded && Math.sign(p.vx) === -move) {
        // Full air steering on reversal: set, not approach (feel §4).
        p.vx = target;
      } else {
        p.vx = approach(p.vx, target, RUN_ACCEL * mult * dt);
      }
    } else if (p.grounded) {
      p.vx = approach(p.vx, 0, RUN_REDUCE * dt);
      if (Math.abs(p.vx) < STOP_EPS) p.vx = 0;
    }

    // ---- gravity ---------------------------------------------------------------
    const gScale = (input.jumpHeld && Math.abs(p.vy) < HALF_GRAV_VY) ? 0.5 : 1;
    p.vy += GRAVITY * gScale * dt;
    if (input.down && !p.grounded) {
      // ↓ has a second job airborne: fast fall toward 900 (feel §1).
      p.fastFalling = true;
      p.vy = Math.min(p.vy + FAST_FALL_ACCEL * dt, FAST_FALL_MAX);
    } else {
      p.fastFalling = false;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;
    }

    // ---- integrate with collisions ----------------------------------------------
    moveX(p.vx * dt);
    const wasGrounded = p.grounded;
    const hit = moveY(p.vy * dt);
    if (hit === 'land') {
      // Flush the box to the exact tile boundary so the next tick's ground
      // probe reads solid (sub-pixel sweep residue would otherwise re-fall 1px
      // per tick and never settle).
      if (collider.floorJustBelow) {
        const fl = collider.floorJustBelow(p.x, feetY());
        if (fl != null) p.y = fl - p.h;
      }
      if (p.vy > 0) p.vy = 0; // landing retention: vx untouched (feel §4)
      p.grounded = true;
    } else if (hit === 'bonk') {
      if (collider.ceilJustAbove) {
        const cl = collider.ceilJustAbove(p.x, p.y);
        if (cl != null) p.y = cl;
      }
      if (p.vy < 0) p.vy = 0;
      p.grounded = false;
    } else {
      // Free vertical move: grounded only survives while standing on something
      // (a ledge walking away ends grounding on the next tick).
      p.grounded = p.vy >= 0 && boxSolid(p.x, p.y + 1);
    }

    // Landing snap: falling near a ledge top, snap down ≤6 px (anti-hover, feel §1).
    if (!p.grounded && p.vy >= 0 && collider.snapDown) {
      const floor = collider.snapDown(p.x, feetY(), SNAP_DOWN_DIST);
      if (floor != null) {
        p.y = floor - p.h;
        p.vy = 0;
        p.grounded = true;
      }
    }

    // Upward corner correction: rising into a ceiling corner, nudge ≤10 px sideways.
    if (hit === 'bonk' && p.vy === 0 && collider.nudgeX) {
      const fixed = collider.nudgeX(p.x, p.y, p.facing, CORNER_CORRECTION);
      if (fixed != null) p.x = fixed;
      else {
        const back = collider.nudgeX(p.x, p.y, -p.facing, CORNER_CORRECTION);
        if (back != null) p.x = back;
      }
    }

    if (p.grounded && !wasGrounded) p.landed = true;

    // ---- anim state (4-state contract) -------------------------------------------
    if (!p.grounded) p.anim = p.vy < 0 ? 'jump' : 'fall';
    else p.anim = Math.abs(p.vx) > STOP_EPS ? 'walk' : 'idle';
  }

  return Object.assign(p, { update });
}

// Center-x helper for proximity math (encounters use object centers; the player
// exposes its own center the same way).
export function centerX(p) { return p.x + p.w / 2; }
export function centerY(p) { return p.y + p.h / 2; }
