// src/engine/juice.js — SPEC-v8 §1: the game-feel layer. Pure module (no DOM,
// no timers, no Math.random without an injected rng): every effect is a small
// deterministic state machine advanced by update(dt) on the fixed timestep,
// read by the boot/renderer at paint time. ON TOP of the v7 engine — nothing
// in player/camera/tick changes behavior here; the host subscribes to events.
//
// Contents:
//   easings          easeOutQuad / easeOutBack(1.7) / easeOutCubic / quartics
//   squash           jump stretch + velocity-scaled landing squash, feet-origin
//   shake            additive trauma shake (separate from camera.trauma)
//   particles        fixed-pool dust/spark/sparkle bursts (juice-numbers-v8.md)
//   hitFeedback      white flash 80 ms + knockback impulse + 200 ms input lock
//   projectiles      spin angle + 8-point ribbon trail history
//   pickupFx         fly-to-HUD 200 ms ease-in + floating '+N' text rise
//   menuFx           120 ms scale-in + denied-shake for greyed requirements
//   eraSequence      the 1.2 s boundary set piece (skippable after 400 ms)
//   whisper          ambient line scheduler (~45 s of walking)
//   combo            chain-gathering multipliers (SPEC §2)
//   mastery          per-family kill counter → throw-stun (SPEC §2)
//   eraScore         per-era report card + stars (SPEC §2)
// ALL motion gated off by prefers-reduced-motion (opts.reducedMotion() or
// opts.reducedMotion === true): static scales, zero shake, instant transitions.

import {
  MAX_FALL, TILE, SHAKE_MAX_PX,
  SQUASH_JUMP, SQUASH_LAND,
  SHAKE_HAZARD_MS, SHAKE_HAZARD_PX, SHAKE_COLLAPSE_MS, SHAKE_COLLAPSE_PX,
  SHAKE_HEAVY_MS, SHAKE_HEAVY_PX,
  FLASH_MS, KNOCKBACK_IMPULSE, INPUT_LOCK_MS,
  DUST_JUMP, DUST_LAND, DUST_SPRINT_PUFF, SPARK_HIT, SPARKLE_PICKUP, LAND_DUST_MIN_FALL,
  TEXT_RISE_PX, TEXT_LIFE_S, PICKUP_FLY_MS, MENU_SCALE_IN_MS,
  ERA_SEQ_S, ERA_SEQ_SKIP_AFTER_S,
  COMBO_WINDOW_S, COMBO_MULTS, COMBO_CAP,
  MASTERY_KILLS, MASTERY_STUN_S, WHISPER_INTERVAL_S,
} from './feel.js';

// --------------------------------------------------------------------- easings
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInQuad = (t) => t * t;
export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const easeInQuart = (t) => t * t * t * t;
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** Overshooting back-ease; k = 1.7 is the shipped constant (juice §1). */
export function easeOutBack(t, k = 1.7) {
  const c3 = k + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------- shake presets
// Trauma points so that peak offset px = trauma × SHAKE_MAX_PX lands exactly on
// the SPEC magnitudes (2 / 4 / 1 px) with the existing quadratic falloff model.
export const SHAKE_PRESETS = Object.freeze({
  hazard: { trauma: SHAKE_HAZARD_PX / SHAKE_MAX_PX, ms: SHAKE_HAZARD_MS },     // 0.25 / 120
  collapse: { trauma: SHAKE_COLLAPSE_PX / SHAKE_MAX_PX, ms: SHAKE_COLLAPSE_MS }, // 0.5 / 200
  heavy: { trauma: SHAKE_HEAVY_PX / SHAKE_MAX_PX, ms: SHAKE_HEAVY_MS },        // 0.125 / 80
});

/**
 * Additive trauma shake (juice §2, Burks model): offset = noise × trauma²,
 * linear bleed-off sized so each preset's kick settles within its own duration.
 * Lives SEPARATE from camera.trauma and adds to it at render time — "camera
 * shake is additive to the existing camera" (SPEC §1).
 */
export function createShake({ reducedMotion = false, rng = Math.random } = {}) {
  let trauma = 0;
  let decayRate = 0; // trauma units per second for the current kick
  let leftS = 0;     // hard duration cap: the kick is over when this hits 0
  let seedX = 1, seedY = 7;
  let sx = 0, sy = 0;

  function kick(name) {
    if (reducedMotion) return;
    const p = SHAKE_PRESETS[name];
    if (!p) return;
    // Cap stacking at the collapse magnitude; quad falloff keeps stacks soft.
    trauma = Math.min(SHAKE_PRESETS.collapse.trauma, trauma + p.trauma);
    decayRate = Math.max(decayRate, trauma / (p.ms / 1000));
    leftS = Math.max(leftS, p.ms / 1000); // exact SPEC duration for this preset
  }
  function update(dt) {
    if (reducedMotion || trauma <= 0) { trauma = 0; decayRate = 0; leftS = 0; sx = 0; sy = 0; return; }
    leftS -= dt;
    if (leftS <= 0) { trauma = 0; decayRate = 0; sx = 0; sy = 0; return; } // duration is exact
    trauma = Math.max(0, trauma - decayRate * dt);
    decayRate = trauma > 0 ? decayRate : 0;
    // Smooth two-octave-ish noise: scroll two seeds, blend sines (white noise
    // reads as a dropped frame — juice §2).
    seedX += dt * 37; seedY += dt * 53;
    const intensity = trauma * trauma;
    const n = (s) => 0.6 * Math.sin(s * 2.1 + Math.sin(s * 0.9)) + 0.4 * Math.sin(s * 4.7);
    sx = n(seedX + rng() * 0.05) * SHAKE_MAX_PX * intensity;
    sy = n(seedY + rng() * 0.05) * SHAKE_MAX_PX * intensity;
  }
  return {
    kick, update,
    get trauma() { return trauma; },
    offset() { return { x: sx, y: sy }; },
    reset() { trauma = 0; decayRate = 0; leftS = 0; sx = 0; sy = 0; },
  };
}

// -------------------------------------------------------------------- squash
/**
 * Squash & stretch with transform-origin at the FEET (juice §1 recommendation).
 * The renderer applies scale(sx, sy) around (feetX, feetY).
 */
export function createSquash({ reducedMotion = false } = {}) {
  const s = { sx: 1, sy: 1 };
  let fromX = 1, fromY = 1, toX = 1, toY = 1;
  let t = 0, durMs = 0, ease = easeOutQuad;

  function start(fx, fy, tx, ty, ms, fn) {
    fromX = fx; fromY = fy; toX = tx; toY = ty; t = 0; durMs = ms; ease = fn;
  }
  /** Jump launch: instant (0.85, 1.12), recover 120 ms easeOutQuad. */
  function jump() {
    if (reducedMotion) return;
    s.sx = SQUASH_JUMP.sx; s.sy = SQUASH_JUMP.sy;
    start(SQUASH_JUMP.sx, SQUASH_JUMP.sy, 1, 1, SQUASH_JUMP.recoverMs, easeOutQuad);
  }
  /**
   * Landing: t = clamp(fallVy / maxFall, 0, 1); scale (1 + 0.25t, 1 − 0.15t),
   * recover 150 ms easeOutBack(1.7). Volume-ish preserving.
   * @returns {{sx:number, sy:number, t:number}} the applied squash (tests).
   */
  function land(fallVy, maxFall = MAX_FALL) {
    const tt = clamp(Math.abs(fallVy) / maxFall, 0, 1);
    if (reducedMotion) return { sx: 1, sy: 1, t: tt };
    s.sx = 1 + SQUASH_LAND.sxGain * tt;
    s.sy = 1 - SQUASH_LAND.syLoss * tt;
    start(s.sx, s.sy, 1, 1, SQUASH_LAND.recoverMs, (p) => easeOutBack(p, SQUASH_LAND.backK));
    return { sx: s.sx, sy: s.sy, t: tt };
  }
  function update(dt) {
    if (durMs <= 0) return;
    t += (dt * 1000) / durMs;
    if (t >= 1) { t = 1; durMs = 0; }
    const e = ease(clamp(t, 0, 1));
    s.sx = lerp(fromX, toX, e);
    s.sy = lerp(fromY, toY, e);
  }
  return Object.assign(s, { jump, land, update, current: () => ({ sx: s.sx, sy: s.sy }) });
}

// ----------------------------------------------------------------- particles
// Fixed pool, recycle dead slots, never allocate in-loop (juice §3 pool policy).
export const PARTICLE_KINDS = ['dust', 'spark', 'sparkle'];

export function createParticles({ capacity = 256, reducedMotion = false, rng = Math.random } = {}) {
  const pool = Array.from({ length: capacity }, () => ({
    alive: false, kind: 'dust', x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 16,
  }));
  let cursor = 0;

  function spawn(kind, x, y, vx, vy, life, size = 16) {
    if (reducedMotion) return null;
    // Pool full: drop the spawn (policy: never grow, never evict live ones mid-fight).
    const slot = pool[cursor % capacity];
    cursor++;
    if (slot.alive) return null;
    slot.alive = true; slot.kind = kind; slot.x = x; slot.y = y;
    slot.vx = vx; slot.vy = vy; slot.life = life; slot.maxLife = life; slot.size = size;
    return slot;
  }

  /** Upward cone burst (Celeste Dust.Burst AngleUp style). */
  function burst(kind, x, y, count, { speed = 60, up = true, spread = 0.9, life = 0.4 } = {}) {
    if (reducedMotion || count <= 0) return 0;
    let made = 0;
    for (let i = 0; i < count; i++) {
      const ang = (up ? -Math.PI / 2 : Math.PI / 2) + (rng() - 0.5) * spread * 2;
      const sp = speed * (0.5 + rng() * 0.5);
      if (spawn(kind, x + (rng() - 0.5) * 8, y, Math.cos(ang) * sp, Math.sin(ang) * sp, life * (0.75 + rng() * 0.5))) made++;
    }
    return made;
  }

  // Named effects (counts from juice-numbers-v8.md "Recommended for us"):
  const jumpDust = (x, y) => burst('dust', x, y, DUST_JUMP, { speed: 55, life: 0.35 });
  const landDust = (x, y, fallVy) =>
    Math.abs(fallVy) > MAX_FALL * LAND_DUST_MIN_FALL ? burst('dust', x, y, DUST_LAND, { speed: 70, life: 0.45 }) : 0;
  /** Backward-drifting puff while sprinting (juice §3). */
  function sprintPuff(x, y, dir) {
    if (reducedMotion) return 0;
    let made = 0;
    for (let i = 0; i < DUST_SPRINT_PUFF; i++) {
      if (spawn('dust', x, y, -dir * (30 + rng() * 30), -10 - rng() * 20, 0.3)) made++;
    }
    return made;
  }
  const hitSparks = (x, y) => burst('spark', x, y, SPARK_HIT, { speed: 140, spread: 1.2, life: 0.3 });
  const pickupSparkle = (x, y) => burst('sparkle', x, y, SPARKLE_PICKUP, { speed: 40, life: 0.5 });

  function update(dt) {
    for (const p of pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'dust') { p.vx *= 0.92; p.vy *= 0.96; }        // drag
      else if (p.kind === 'spark') p.vy += 300 * dt;                 // gravity
      else p.vy -= 20 * dt;                                          // sparkle floats up
    }
  }

  /** Render read-model: live particles with a life-fraction alpha (boot paint). */
  function list() {
    const out = [];
    for (const p of pool) {
      if (!p.alive) continue;
      out.push({ kind: p.kind, x: p.x, y: p.y, size: p.size, alpha: Math.min(1, p.life / p.maxLife) });
    }
    return out;
  }

  return {
    pool, burst, jumpDust, landDust, sprintPuff, hitSparks, pickupSparkle, update, list,
    liveCount() { let n = 0; for (const p of pool) if (p.alive) n++; return n; },
  };
}

// -------------------------------------------------------------- hit feedback
/**
 * Hazard-contact feedback (SPEC §1): 80 ms white flash + knockback impulse
 * (250 px/s away, +80 up, friction 0.85/frame ≈ 0.3 tiles travel) + 200 ms
 * input lock. The host applies `lock` by ignoring movement input while true,
 * and pulls player.vx/vy from `impulse()` once.
 */
export function createHitFeedback({ reducedMotion = false } = {}) {
  const h = { flashLeftMs: 0, lockLeftMs: 0, blinkT: 0 };
  function hit(sourceDirX) {
    h.flashLeftMs = reducedMotion ? FLASH_MS : FLASH_MS; // color-only flash stays under reduced motion (juice cross-rule 6)
    h.lockLeftMs = INPUT_LOCK_MS;                        // control contract is gameplay, not motion
    h.blinkT = 0;
    const dir = sourceDirX === 0 ? -1 : -Math.sign(sourceDirX); // push AWAY from source
    return { vx: dir * KNOCKBACK_IMPULSE, vy: -80 };
  }
  function update(dt) {
    h.flashLeftMs = Math.max(0, h.flashLeftMs - dt * 1000);
    h.lockLeftMs = Math.max(0, h.lockLeftMs - dt * 1000);
    h.blinkT += dt;
  }
  const api = {
    hit, update,
    /** i-frame blink visibility (~8 Hz flicker, juice §5). */
    blinkVisible(rate = 8) { return Math.floor(h.blinkT * rate * 2) % 2 === 0; },
  };
  // defineProperty, not Object.assign: assign would snapshot the getters as
  // static false values and hit feedback would never flash/lock (found by
  // tests/feel-v8.test.mjs).
  Object.defineProperty(api, 'flashing', { get: () => h.flashLeftMs > 0, enumerable: true });
  Object.defineProperty(api, 'locked', { get: () => h.lockLeftMs > 0, enumerable: true });
  return api;
}

// --------------------------------------------------------------- projectile fx
/** Spin + 8-point ribbon trail for thrown items (SPEC §1). */
export function createProjectileFx({ trailPoints = 8, spinRate = 12 } = {}) {
  const byId = new Map();
  function track(id, x, y) {
    let rec = byId.get(id);
    if (!rec) { rec = { spin: 0, trail: [] }; byId.set(id, rec); }
    rec.trail.push({ x, y });
    while (rec.trail.length > trailPoints) rec.trail.shift();
    return rec;
  }
  function advance(id, dt) {
    const rec = byId.get(id);
    if (rec) rec.spin += spinRate * dt;
  }
  function release(id) { byId.delete(id); }
  function fx(id) { return byId.get(id) || null; }
  return { track, advance, release, fx, of: (id) => byId.get(id) || null, trailPoints };
}

// ------------------------------------------------------------------ pickup fx
/** Floating '+N Resource' text rising 24 px over 0.8 s + item flight to HUD. */
export function createPickupFx({ reducedMotion = false } = {}) {
  const texts = [];  // {text, x, y, t}
  const flights = []; // {type, x, y, t} — fly toward the HUD hand slot
  const POOL_NAMES = { sustenance: 'Sustenance', knowledge: 'Knowledge', coin: 'Coin', credit: 'Credit' };

  function floatText(text, x, y) {
    if (reducedMotion) return;
    texts.push({ text, x, y, t: 0 });
    if (texts.length > 32) texts.shift(); // pooled cap (juice §6)
  }
  function flyToHud(type, x, y) {
    if (reducedMotion) return;
    flights.push({ type, x0: x, y0: y, x: x, y: y, t: 0 });
    if (flights.length > 16) flights.shift();
  }
  /** A resolved entity pickup: sparkle + '+N Name' + flight (hand items only fly). */
  function pickupTaken({ took, amount = 0, pool = null, countable = null, x, y }) {
    pickupSparkle(x, y);
    const label = pool ? POOL_NAMES[pool] || pool : countable ? POOL_NAMES[countable] || countable : took;
    if (amount > 0 && label) floatText(`+${amount} ${label}`, x, y - 40);
    else floatText(`+ ${took}`, x, y - 40);
    flyToHud(took, x, y);
  }
  const pickupSparkleCache = [];
  function pickupSparkle(x, y) { pickupSparkleCache.push({ x, y, t: 0 }); if (pickupSparkleCache.length > 16) pickupSparkleCache.shift(); }

  function update(dt) {
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].t += dt;
      if (texts[i].t >= TEXT_LIFE_S) texts.splice(i, 1);
    }
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      f.t += dt;
      const p = clamp(f.t / (PICKUP_FLY_MS / 1000), 0, 1);
      const e = easeInQuad(p); // ease-IN toward the HUD slot (SPEC §1)
      f.x = lerp(f.x0, f.x0 + 60, e);
      f.y = lerp(f.y0, f.y0 - 220, e);
      if (p >= 1) flights.splice(i, 1);
    }
    for (let i = pickupSparkleCache.length - 1; i >= 0; i--) {
      pickupSparkleCache[i].t += dt;
      if (pickupSparkleCache[i].t > 0.5) pickupSparkleCache.splice(i, 1);
    }
  }
  /** Render view-model: y already offset by the eased rise, alpha fades 2nd half. */
  function viewModel() {
    return texts.map((tx) => {
      const p = clamp(tx.t / TEXT_LIFE_S, 0, 1);
      return {
        text: tx.text,
        x: tx.x,
        y: tx.y - TEXT_RISE_PX * easeOutCubic(p),
        alpha: p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5,
      };
    });
  }
  return { texts, flights, pickups: pickupSparkleCache, floatText, flyToHud, pickupTaken, update, viewModel };
}

// ------------------------------------------------------------------- menu fx
/** Encounter menu 120 ms scale-in + denied-shake on greyed choices (SPEC §1). */
export function createMenuFx({ reducedMotion = false } = {}) {
  const m = { openT: 999, deniedT: 0 };
  function opened() { m.openT = reducedMotion ? MENU_SCALE_IN_MS : 0; }
  function denied() { m.deniedT = reducedMotion ? 0 : 0.25; }
  function update(dt) {
    m.openT = Math.min(999, m.openT + dt * 1000);
    m.deniedT = Math.max(0, m.deniedT - dt);
  }
  /** Scale for the menu card this frame (1.0 once the 120 ms in-play finishes). */
  function scale() {
    const p = clamp(m.openT / MENU_SCALE_IN_MS, 0, 1);
    return lerp(0.85, 1, easeOutQuad(p));
  }
  /** Horizontal wiggle offset for the denied choice row. */
  function deniedOffset() {
    if (m.deniedT <= 0) return 0;
    const p = 1 - m.deniedT / 0.25;
    return Math.sin(p * Math.PI * 6) * 4 * (1 - p);
  }
  return Object.assign(m, { opened, denied, update, scale, deniedOffset });
}

// ------------------------------------------------------------ era sequence
// The SPEC §1 stun moment: a 1.2 s beat machine layered OVER the v6 transition
// (which keeps owning era advance + crossfade alpha). Beats (juice §7 table,
// compressed into the 1.2 s envelope):
//   0    → 350ms  desaturate world + camera push-in 8%   (easeInOutQuad)
//   350  → 550ms  light column at the boundary + figure re-equip white flash
//   450  → 700ms  palette crossfade overlap
//   700  → 950ms  title card slides IN  (easeOutQuart, from side)
//   950  → 1000ms hold fully readable  (≥200 ms visible incl. slide tail)
//   1000 → 1200ms card slides OUT (easeInQuart)
// Skippable with any key after 400 ms → jumps straight to card-out.
export const ERA_BEATS = Object.freeze({
  DESAT_END: 0.35, COLUMN_START: 0.35, COLUMN_END: 0.55,
  FADE_START: 0.45, FADE_END: 0.7,
  CARD_IN_START: 0.7, CARD_IN_END: 0.95, CARD_OUT_START: 1.0, CARD_OUT_END: 1.2,
});

export function createEraSequence({ reducedMotion = false } = {}) {
  const seq = { active: false, fromEra: 1, toEra: 0, name: '', elapsed: 0, skipped: false, flashFired: false, cardShown: false };

  function begin(toEra, opts = {}) {
    if (seq.active) return false;
    seq.active = true; seq.toEra = toEra; seq.elapsed = 0;
    seq.fromEra = opts.fromEra ?? Math.max(1, toEra - 1);
    seq.name = opts.name || '';
    seq.skipped = false; seq.flashFired = false; seq.cardShown = false;
    return true;
  }
  /** Any key after 400 ms: jump straight to card-out (SPEC skip rule). */
  function skip() {
    if (!seq.active || seq.elapsed < ERA_SEQ_SKIP_AFTER_S) return false;
    seq.elapsed = ERA_BEATS.CARD_OUT_START;
    seq.skipped = true;
    return true;
  }
  function update(dt) {
    if (!seq.active) return null;
    seq.elapsed = Math.min(ERA_SEQ_S, seq.elapsed + dt);
    const out = sample(seq.elapsed);
    if (!seq.flashFired && seq.elapsed >= ERA_BEATS.COLUMN_START) { seq.flashFired = true; out.flash = true; }
    if (!seq.cardShown && seq.elapsed >= ERA_BEATS.CARD_IN_START) seq.cardShown = true;
    if (seq.elapsed >= ERA_SEQ_S) { seq.active = false; out.finished = true; }
    return out;
  }
  /** Pure sampler of all beats at time t (tests assert exact beat windows). */
  function sample(t) {
    const B = ERA_BEATS;
    const rm = reducedMotion;
    const desat = rm ? 0 : easeInOutQuad(clamp(t / B.DESAT_END, 0, 1));
    const push = rm ? 1 : 1 + 0.08 * easeInOutQuad(clamp(t / B.DESAT_END, 0, 1));
    const column = (t >= B.COLUMN_START && t <= B.COLUMN_END + 0.15)
      ? (rm ? 1 : clamp(1 - Math.abs(t - (B.COLUMN_START + 0.1)) / 0.25, 0, 1)) : 0;
    const fade = rm ? 1 : easeInOutQuad(clamp((t - B.FADE_START) / (B.FADE_END - B.FADE_START), 0, 1));
    let cardX = 0, cardAlpha = 0, cardT = 0;
    if (!rm) {
      if (t >= B.CARD_IN_START && t < B.CARD_OUT_START) {
        const p = easeOutQuart(clamp((t - B.CARD_IN_START) / (B.CARD_IN_END - B.CARD_IN_START), 0, 1));
        cardX = lerp(-VIEW_W_OFF, 0, p); cardAlpha = p;
        cardT = t - B.CARD_IN_START;
      } else if (t >= B.CARD_OUT_START) {
        const p = easeInQuart(clamp((t - B.CARD_OUT_START) / (B.CARD_OUT_END - B.CARD_OUT_START), 0, 1));
        cardX = lerp(0, VIEW_W_OFF, p); cardAlpha = 1 - p;
        cardT = (B.CARD_OUT_END - B.CARD_OUT_START) * p + 0.25; // fully-in phase + out progress
      }
    }
    return {
      t, desat, push, column, fade,
      flash: t >= B.COLUMN_START && t <= B.COLUMN_START + FLASH_MS / 1000,
      cardX, cardAlpha, cardT, finished: t >= ERA_SEQ_S,
      fromEra: seq.fromEra, toEra: seq.toEra, name: seq.name,
    };
  }
  return Object.assign(seq, { begin, skip, update, sample, duration: ERA_SEQ_S });
}
const VIEW_W_OFF = 520; // card slide distance (offscreen margin, logical px)

// ------------------------------------------------------------------ whisper
/** Ambient whisper scheduler: one line per ~45 s of WALKING (moving counts). */
export function createWhisper({ intervalS = WHISPER_INTERVAL_S } = {}) {
  const w = { bubbleText: null, bubbleT: 0 };
  let walkAccum = 0;
  let lastEra = 0;
  const usedByEra = new Map(); // era -> indices shown (cycle without repeats until exhausted)

  /**
   * @param {number} dt
   * @param {boolean} moving whether the figure is actually walking
   * @param {number} era current era
   * @param {Array<string>} lines per-era line pool (caller filters by era)
   * @returns {string|null} a fresh line this tick
   */
  function update(dt, moving, era, lines = []) {
    w.bubbleT = Math.max(0, w.bubbleT - dt);
    if (w.bubbleT === 0) w.bubbleText = null;
    api.bubbleT = w.bubbleT;           // keep the public view-model in sync
    api.bubbleText = w.bubbleText;
    if (!moving) return null;
    if (era !== lastEra) { walkAccum = 0; lastEra = era; }
    walkAccum += dt;
    if (walkAccum < intervalS || lines.length === 0) return null;
    walkAccum = 0;
    if (!usedByEra.has(era)) usedByEra.set(era, new Set());
    const used = usedByEra.get(era);
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (!used.has(i)) { idx = i; break; }
    if (idx === -1) { used.clear(); idx = 0; }
    used.add(idx);
    w.bubbleText = lines[idx];
    w.bubbleT = 4.0; // bubble lives 4 s
    api.bubbleText = w.bubbleText; // sync the public view-model before returning
    api.bubbleT = w.bubbleT;
    return lines[idx];
  }
  const api = { update, bubbleText: w.bubbleText, bubbleT: w.bubbleT }; // live fields synced in update()
  // defineProperty: Object.assign would snapshot the getter as a static 0.
  Object.defineProperty(api, 'walkingClock', { get: () => walkAccum, enumerable: true });
  return api;
}

// ------------------------------------------------------------------- combo
/**
 * Combo gathering (SPEC §2): gathers within 3 s of EACH OTHER chain.
 * Multiplier ladder [1.2, 1.4, 1.6] then flat CAP 2.0; breaks on damage or
 * 3 s idle. `mult()` is what yields are scaled by BEFORE the gather applies.
 */
export function createCombo({ windowS = COMBO_WINDOW_S, mults = COMBO_MULTS, cap = COMBO_CAP } = {}) {
  const c = { count: 0, sinceLastS: Infinity, broken: 0 };
  /** Per-gather multiplier for the NEXT gather (count already chained so far). */
  function mult() {
    if (c.count === 0) return 1;
    const idx = Math.min(c.count - 1, mults.length - 1);
    const stepped = mults[idx] + Math.max(0, c.count - mults.length) * 0.2;
    return Math.min(cap, Math.round(stepped * 100) / 100);
  }
  function gather() { c.count += 1; c.sinceLastS = 0; return mult(); }
  function damage() { if (c.count > 0) c.broken++; c.count = 0; c.sinceLastS = Infinity; }
  function update(dt) {
    if (c.count === 0) return;
    c.sinceLastS += dt;
    if (c.sinceLastS > windowS) { c.count = 0; c.sinceLastS = Infinity; c.broken++; }
  }
  /** Apply the multiplier to an integer yield (rounded outward, min +1). */
  function apply(amount) { return Math.max(1, Math.round(amount * mult())); }
  return Object.assign(c, { mult, gather, damage, update, apply });
}

// ------------------------------------------------------------------ mastery
/**
 * Hazard mastery (SPEC §2): persistent per-family kill counter; after 5 kills
 * of a family, a throw against that family STUNS it for 1 s instead of doing
 * nothing (chasers freeze; guards look away).
 */
export function createMastery(saveCounter = {}) {
  const counter = saveCounter && typeof saveCounter === 'object' ? saveCounter : {};
  function recordKill(family) { counter[family] = (counter[family] || 0) + 1; return counter[family]; }
  function kills(family) { return counter[family] || 0; }
  function armed(family) { return kills(family) >= MASTERY_KILLS; }
  /** Stun seconds a throw should apply to `family` (0 when not yet mastered). */
  function stunFor(family) { return armed(family) ? MASTERY_STUN_S : 0; }
  return { counter, recordKill, kills, armed, stunFor };
}

// ---------------------------------------------------------------- era score
/**
 * Era report card (SPEC §2): at each boundary, grade the era just walked.
 * Stars: all encounters ≥1 choice resolved AND no collapse AND combo avg ≥ 1.3.
 * Persisted in the save (state.v8.eraScores) and shown on the run summary.
 */
export function gradeEra({ encountersResolved, encountersTotal, collapsed, comboAvg }) {
  let stars = 0;
  const all = encountersTotal > 0 ? encountersResolved >= encountersTotal : true;
  if (all) stars++;                                   // thoroughness
  if (!collapsed) stars++;                             // survival
  if (Number(comboAvg) >= 1.3) stars++;                // style
  return stars;
}

export function createEraScoreTracker(stateV8) {
  const v8 = stateV8;
  if (!v8.eraScores || typeof v8.eraScores !== 'object') v8.eraScores = {};
  function record(era, card) { v8.eraScores[era] = card; return card; }
  function get(era) { return v8.eraScores[era] || null; }
  function totalStars() { return Object.values(v8.eraScores).reduce((n, c) => n + (c.stars || 0), 0); }
  return { record, get, totalStars };
}

// ------------------------------------------------------------- v8 save fields
/** Attach the v8 sub-state to a game state (idempotent). Mirrors ensureV7State. */
export function ensureV8State(state) {
  if (!state.v8 || typeof state.v8 !== 'object') state.v8 = {};
  const v = state.v8;
  if (!v.mastery || typeof v.mastery !== 'object') v.mastery = {};       // family -> kill count
  if (!v.eraScores || typeof v.eraScores !== 'object') v.eraScores = {}; // era -> report card
  if (!Array.isArray(v.echoSeen)) v.echoSeen = [];                       // echo ids already shown
  if (!Number.isFinite(v.runTimeS)) v.runTimeS = 0;
  return v;
}

// ---------------------------------------------------------- master factory
/**
 * One object bundling every juice system for the boot layer.
 * @param {object} deps { reducedMotion?: boolean|(()=>boolean), rng?, state? (game.state for v8 persistence) }
 */
export function createJuice(deps = {}) {
  const rm = deps.reducedMotion === undefined ? false
    : (typeof deps.reducedMotion === 'function' ? deps.reducedMotion() : !!deps.reducedMotion);
  const rng = deps.rng || Math.random;
  const shake = createShake({ reducedMotion: rm, rng });
  const squash = createSquash({ reducedMotion: rm });
  const particles = createParticles({ reducedMotion: rm, rng });
  const hit = createHitFeedback({ reducedMotion: rm });
  const projFx = createProjectileFx();
  const pickup = createPickupFx({ reducedMotion: rm });
  const menu = createMenuFx({ reducedMotion: rm });
  const eraSeq = createEraSequence({ reducedMotion: rm });
  const whisper = createWhisper();
  const combo = createCombo();
  const state = deps.state || null;
  const mastery = createMastery(state ? ensureV8State(state).mastery : {});
  const scores = createEraScoreTracker(state ? ensureV8State(state) : {});

  function update(dt) {
    shake.update(dt); squash.update(dt); particles.update(dt);
    hit.update(dt); pickup.update(dt); menu.update(dt); combo.update(dt);
  }
  /** Combined render offset: engine camera shake + juice shake (additive). */
  function renderOffset(extra = { x: 0, y: 0 }) {
    const o = shake.offset();
    return { x: extra.x + o.x, y: extra.y + o.y };
  }
  return {
    shake, squash, particles, hit, projFx, pickup, menu, eraSeq, whisper,
    combo, mastery, scores, update, renderOffset,
    get reducedMotion() { return rm; },
  };
}
