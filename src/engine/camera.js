// src/engine/camera.js — SPEC v6 §5: the follow camera (Scroll Back vocabulary).
// Pure module: feed it the player box + dt, read { x, y } of the viewport's
// top-left in world space. Numbers from research/platformer-feel.md §3.
//
// Behaviors implemented:
//  - deadzone box (±80 × ±56) around a moving anchor: small motions don't pan;
//  - exponential critically-damped follow (τ = 0.18 s, frame-rate independent);
//  - lookahead lead ±140 px toward movement, gliding over 0.45 s between leads,
//    flipping only after ≥40 px of true reverse movement (hysteresis), easing
//    to center when speed < 20 px/s;
//  - vertical anchor at feet + 120 px below the viewport center, so the player
//    sits low in the frame and upcoming ground reads (feel §3);
//  - one-way timeline: x is monotonic non-decreasing (SPEC §2 no backtracking);
//  - trauma shake (intensity = trauma², decay 1.0/s, ≤8 px) — OFF under
//    prefers-reduced-motion, and pans eased ×0.5 there;
//  - era-boundary hold: freeze follow for 2.0 s during the set piece.

import {
  CAM_DEADZONE_X, CAM_DEADZONE_Y, CAM_TAU, CAM_LEAD, CAM_LEAD_FLIP_S,
  CAM_LEAD_MIN_MOVE, CAM_IDLE_SPEED, CAM_IDLE_EASE, CAM_FOOT_BIAS,
  SHAKE_MAX_PX, SHAKE_DECAY, ERA_HOLD_S, VIEW_W, VIEW_H,
} from './feel.js';

export function createCamera({ x = 0, y = 0, reducedMotion = false } = {}) {
  const cam = {
    x, y,                 // viewport top-left, world space (smoothed)
    minX: x,              // one-way floor for x
    anchorX: x + VIEW_W / 2,
    anchorY: y + VIEW_H / 2 + CAM_FOOT_BIAS,
    leadSign: 1,          // current lookahead side
    leadMag: 0,           // signed lead actually applied (glides on flip/idle)
    revAccum: 0,          // hysteresis accumulator (px of reverse movement)
    holdT: 0,             // era-boundary freeze remaining (s)
    trauma: 0,
    shakeX: 0, shakeY: 0,
    reducedMotion,
  };

  /** Freeze follow for `s` seconds (era set piece). */
  cam.hold = (s = ERA_HOLD_S) => { cam.holdT = Math.max(cam.holdT, s); };

  /** Kick the shake (landings, boundary arrival). trauma decays 1.0/s. */
  cam.shake = (amount = 0.4) => { cam.trauma = Math.min(1, cam.trauma + amount); };

  /**
   * Advance the camera. `player` = { x, y, w, h, vx }. Mutates cam in place.
   */
  cam.follow = (player, dt = 1 / 60) => {
    // ---- era-boundary hold: position-lock (Scroll Back); shake still ticks ----
    if (cam.holdT > 0) {
      cam.holdT = Math.max(0, cam.holdT - dt);
      updateShake(dt);
      return;
    }

    const cx = player.x + player.w / 2;
    const feet = player.y + player.h;

    // ---- lookahead lead ---------------------------------------------------------
    const speed = Math.abs(player.vx);
    if (speed >= CAM_IDLE_SPEED) {
      const dir = Math.sign(player.vx);
      if (dir !== cam.leadSign) {
        // Hysteresis: only flip the lead after real reverse movement, not a jiggle.
        cam.revAccum += speed * dt;
        if (cam.revAccum >= CAM_LEAD_MIN_MOVE) { cam.leadSign = dir; cam.revAccum = 0; }
      } else {
        cam.revAccum = 0;
      }
      // Glide toward full lead on the active side over CAM_LEAD_FLIP_S.
      const want = CAM_LEAD * cam.leadSign;
      cam.leadMag = approach(cam.leadMag, want, (CAM_LEAD / CAM_LEAD_FLIP_S) * dt);
    } else {
      // Released: focus eases back to center (~0.5 s).
      cam.leadMag = approach(cam.leadMag, 0, (CAM_LEAD / CAM_IDLE_EASE) * dt);
      cam.revAccum = 0;
    }

    // ---- target anchor (deadzone moves the anchor, smoothing chases it) ---------
    const targetX = cx + cam.leadMag;
    const targetY = feet + CAM_FOOT_BIAS;
    if (Math.abs(targetX - cam.anchorX) > CAM_DEADZONE_X) {
      // Move the anchor so the target lands exactly at the deadzone edge.
      cam.anchorX = targetX - Math.sign(targetX - cam.anchorX) * CAM_DEADZONE_X;
    }
    if (Math.abs(targetY - cam.anchorY) > CAM_DEADZONE_Y) {
      cam.anchorY = targetY - Math.sign(targetY - cam.anchorY) * CAM_DEADZONE_Y;
    }

    // ---- exponential smoothing (frame-rate independent) --------------------------
    const panScale = cam.reducedMotion ? 0.5 : 1; // SPEC §3: slower pans under reduced motion
    const k = (1 - Math.exp(-dt / CAM_TAU)) * panScale;
    cam.x += (cam.anchorX - VIEW_W / 2 - cam.x) * k;
    cam.y += (cam.anchorY - VIEW_H / 2 - cam.y) * k;

    // ---- one-way timeline: never scroll left --------------------------------------
    if (cam.x < cam.minX) cam.x = cam.minX;
    else cam.minX = cam.x;

    updateShake(dt);
  };

  function updateShake(dt) {
    if (cam.reducedMotion || cam.trauma <= 0) {
      cam.trauma = 0; cam.shakeX = 0; cam.shakeY = 0;
      return;
    }
    cam.trauma = Math.max(0, cam.trauma - SHAKE_DECAY * dt);
    const intensity = cam.trauma * cam.trauma; // trauma² model
    cam.shakeX = (Math.random() * 2 - 1) * SHAKE_MAX_PX * intensity;
    cam.shakeY = (Math.random() * 2 - 1) * SHAKE_MAX_PX * intensity;
  }

  /** Offset to apply at draw time (shake included). */
  cam.renderOffset = () => ({ x: cam.x + cam.shakeX, y: cam.y + cam.shakeY });

  return cam;
}

function approach(v, target, amount) {
  if (v < target) return Math.min(v + amount, target);
  if (v > target) return Math.max(v - amount, target);
  return v;
}
