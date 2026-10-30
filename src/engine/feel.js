// src/engine/feel.js — SPEC v6: the feel constants, verbatim from
// research/platformer-feel.md (Scout v6). One source of truth so player.js,
// camera.js and encounters.js never drift from the researched numbers.
// All units: px and seconds at a fixed 60 Hz sim step (dt = 1/60).

// --- jump curve (feel doc §1) -------------------------------------------------
export const GRAVITY = 820;            // px/s²
// JUMP_SPEED is the vy applied on the tick AFTER launch gravity (vy += g·dt),
// i.e. effective v0 = |JUMP_SPEED| - GRAVITY·dt ≈ 410 - 13.7 = 396 — the feel
// doc's own derivation ("v0 = 2h/t = 408" for a 102-px held apex with
// t_apex ≈ 0.5 s). Setting vy = -410 outright overshoots to ~113 px.
export const JUMP_SPEED = -410;        // initial vy (negative = up)
export const MAX_FALL = 600;           // terminal velocity, normal
export const FAST_FALL_MAX = 900;      // terminal while holding ↓ airborne
export const FAST_FALL_ACCEL = 900;    // approach rate toward FAST_FALL_MAX
export const HALF_GRAV_VY = 155;       // |vy| below this while jump held → g × 0.5
// Apex hang is produced by the half-grav window ONLY (feel §1: "apex hang comes
// from half-grav, not low g"). Applying a hold-boost at launch doubles the
// effective v0 and overshoots the ~102 px held-apex target, so the boost that
// used to live here is removed — JUMP_SPEED alone sets the arc.
export const JUMP_CUT = 0.62;          // on release while rising: vy *= 0.62 (tap ~45% of held apex)
export const SNAP_DOWN_DIST = 6;       // landing snap onto floor within 6 px
export const CORNER_CORRECTION = 10;   // sideways nudge when rising into a corner

// --- coyote + buffer (feel doc §2) ---------------------------------------------
export const COYOTE_S = 0.1;           // 100 ms
export const JUMP_BUFFER_S = 0.1;      // 100 ms

// --- run / accel / friction (feel doc §4) ---------------------------------------
export const MAX_RUN = 180;            // px/s
export const RUN_ACCEL = 1800;         // px/s² toward target speed on ground
export const RUN_REDUCE = 1400;        // px/s² toward 0 on input release
export const AIR_MULT = 0.7;           // air control multiplier
export const JUMP_H_BOOST = 70;        // +px/s in held direction on jump
export const STOP_EPS = 5;             // zero velocity below this (snap-to-stop)

// --- world / hitbox contract (feel doc §5) --------------------------------------
export const TILE = 32;
export const VIEW_W = 960;
export const VIEW_H = 540;
export const PLAYER_W = 24;            // collision box (narrower than the art)
export const PLAYER_H = 56;
export const SPRITE_CELL_W = 64;       // player_eraNN.png cells
export const SPRITE_CELL_H = 128;
export const DRAW_H = 96;              // drawn sprite height (feet-anchored)
export const DRAW_W = 48;              // 64 * (96/128) — keep cell aspect

// --- camera (feel doc §3) --------------------------------------------------------
export const CAM_DEADZONE_X = 80;
export const CAM_DEADZONE_Y = 56;
export const CAM_TAU = 0.18;           // exp smoothing time constant
export const CAM_LEAD = 140;           // lookahead offset while moving
export const CAM_LEAD_FLIP_S = 0.45;   // glide between leads (0.4–0.5 s)
export const CAM_LEAD_MIN_MOVE = 40;   // hysteresis: px of true reverse before flip
export const CAM_IDLE_SPEED = 20;      // below this, lead eases to center
export const CAM_IDLE_EASE = 0.5;      // s to recenter
export const CAM_FOOT_BIAS = 120;      // anchor at feet + 120 (player low-third)
export const SHAKE_MAX_PX = 8;
export const SHAKE_DECAY = 1.0;        // trauma per second
export const ERA_HOLD_S = 2.0;         // camera freeze during era set piece

// --- encounter proximity (feel doc §6) -------------------------------------------
export const TRIGGER_R = 48;           // interaction valid: |dx| ≤ 48 from center-x
export const TRIGGER_Y = 64;           // any vertical overlap ±64
export const PROMPT_R = 80;            // prompt fades in at 80
export const PROMPT_FADE_S = 0.15;     // fade out grace after leaving trigger
export const HINT_R = 160;             // far hint glow, no text
export const INTERACT_BUFFER_S = 0.1;  // pre-press fires on entry (100 ms)
export const MENU_DWELL_S = 8;         // auto-dismiss idle menu
export const TRIGGER_COOLDOWN_S = 0.4; // after resolve / dismissal

// --- parallax depths (SPEC §1/§3: scroll 4 layers) --------------------------------
export const PARALLAX = { sky: 0.1, far: 0.3, near: 0.6, ground: 1.0 };
