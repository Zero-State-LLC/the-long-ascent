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
export const ERA_HOLD_S = 1.2;          // camera freeze during era set piece (v8: 1.2 s ±0.1)

// --- encounter proximity (feel doc §6) -------------------------------------------
export const TRIGGER_R = 48;           // interaction valid: |dx| ≤ 48 from center-x
export const TRIGGER_Y = 64;           // any vertical overlap ±64
export const PROMPT_R = 80;            // prompt fades in at 80
export const PROMPT_FADE_S = 0.15;     // fade out grace after leaving trigger
export const HINT_R = 160;             // far hint glow, no text
export const INTERACT_BUFFER_S = 0.1;  // pre-press fires on entry (100 ms)
export const MENU_DWELL_S = 8;         // auto-dismiss idle menu
export const TRIGGER_COOLDOWN_S = 0.4; // after resolve / dismissal

// --- v8 juice (SPEC-v8 §1; research/juice-numbers-v8.md) ------------------------
// Squash & stretch (juice §1 recommended values — SPEC amplitudes, Celeste shape):
export const SQUASH_JUMP = { sx: 0.85, sy: 1.12, recoverMs: 120 };            // instant set, easeOutQuad back to 1
export const SQUASH_LAND = { sxGain: 0.25, syLoss: 0.15, recoverMs: 150, backK: 1.7 }; // t = clamp(fallVy/MAX_FALL); (1+0.25t, 1-0.15t), easeOutBack(1.7)
// Screen shake presets (trauma points; px = trauma × SHAKE_MAX_PX, juice §2):
export const SHAKE_HAZARD_MS = 120, SHAKE_HAZARD_PX = 2;   // → trauma 0.25 @8px cap
export const SHAKE_COLLAPSE_MS = 200, SHAKE_COLLAPSE_PX = 4; // → trauma 0.5
export const SHAKE_HEAVY_MS = 80, SHAKE_HEAVY_PX = 1;       // → trauma 0.125
// Hit feedback (juice §5/§8):
export const FLASH_MS = 80;                                  // white damage flash
export const KNOCKBACK_TILES = 0.3;                          // = 96 px impulse travel target
export const KNOCKBACK_IMPULSE = 250;                        // px/s away from source (+80 up)
export const INPUT_LOCK_MS = 200;                            // HK base recoil constant
// Particles (juice §3 recommended counts):
export const DUST_JUMP = 4, DUST_LAND = 8, DUST_SPRINT_PUFF = 3, SPARK_HIT = 10, SPARKLE_PICKUP = 6;
export const LAND_DUST_MIN_FALL = 0.5;                       // only when fallVy > 50% MAX_FALL
// Floating text (juice §6): pickups rise 24 px over 0.8 s.
export const TEXT_RISE_PX = 24, TEXT_LIFE_S = 0.8;
export const PICKUP_FLY_MS = 200;                            // item flies to the HUD slot
// Encounter menu (SPEC §1): 120 ms scale-in.
export const MENU_SCALE_IN_MS = 120;
// Era transition sequence (SPEC §1 + juice §7 beat table, 1.2 s envelope):
export const ERA_SEQ_S = 1.2;
export const ERA_SEQ_SKIP_AFTER_S = 0.4;                     // any key jumps to card-out
// Combo gathering (SPEC §2): chain window 3 s; ×1.2/×1.4/×1.6, cap ×2.0.
export const COMBO_WINDOW_S = 3.0;
export const COMBO_MULTS = [1.2, 1.4, 1.6];
export const COMBO_CAP = 2.0;
// Hazard mastery (SPEC §2): 5 kills of a family arms throw-stuns (1 s).
export const MASTERY_KILLS = 5;
export const MASTERY_STUN_S = 1.0;
// Ambient whisper cadence (SPEC §3): every ~45 s of walking.
export const WHISPER_INTERVAL_S = 45;

// --- parallax depths (SPEC §1/§3: scroll 4 layers) --------------------------------
export const PARALLAX = { sky: 0.1, far: 0.3, near: 0.6, ground: 1.0 };

// --- v9 THE CLEARING (SPEC-v9 §1/§2/§4) -------------------------------------------
// Station approach: the world freezes within 40 px of a READY station (§1).
export const STATION_APPROACH_PX = 40;
// Consequence beat: deltas land visibly for ≤3 s on resume (§1).
export const CONSEQUENCE_BEAT_S = 3.0;
// Station glow: 2-frame ember pulse at 30% alpha behind terrain (§1; Studio v9).
export const GLOW_FRAMES = 2;
export const GLOW_ALPHA = 0.3;
// Desaturation wash strength when a station panel is up (chrome-tokens-v9.md).
export const DESAT_WASH = 0.35;
// Render-fault rule (§4 D2): 3 consecutive faults → auto-pause.
export const RENDER_FAULT_LIMIT = 3;
// Text margins for measured & clamped text (§4 D4), logical px.
export const TEXT_MARGIN = 24;
// Micro-fork (§1.2): the era-tail fraction that splits into two routes.
export const FORK_FRACTION = 1 / 3;
// Fork route density multipliers (spawn/encounter density knobs, §1.2).
export const FORK_DENSITY = { ridge: 0.7, valley: 1.4 };
