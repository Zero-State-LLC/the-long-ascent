// src/ui/stageWalk.js — walkable-figure stage controller (SPEC v4 §2 + v5 §1).
//
// PURE state machine: no DOM, no canvas. The UI layer feeds key events in
// (`press`/`release`/`keyAction`) and reads position/arm state out; tests drive
// it directly with a fake clock.
//
// Model (v5): the figure roams normalized 2D — x ∈ [0, 1], y ∈ [0, FLOOR_TOP]
// (the walkable strip between the stage top and the horizon/floor line; screen
// y grows downward, so the floor line is the BOTTOM of the band).
// Each choice keeps a marker ON THE FLOOR LINE (y = FLOOR_TOP); arming checks
// x distance only AND requires the figure to be standing on the floor band —
// vertical movement never arms or disarms. Idle for IDLE_DRIFT_DELAY seconds
// eases the figure back to the floor line (instant snap under reduced motion).
// With reduced motion arrows teleport between markers as in v4.

export const MAX_MARKERS = 4;
export const DEFAULT_X = 0.25;        // idle spot: stage-x 25%
export const WALK_SPEED = 0.38;       // stage-widths per second
export const FLOOR_TOP = 0.62;        // horizon/floor line == stagePainter FLOOR_FRAC (kept literal: this module stays dependency-free)
export const IDLE_DRIFT_DELAY = 4;    // s without input before drifting back to the floor line (spec §1)
const DRIFT_EPS = 1e-9;               // float-slop guard: dt sums like 4 - 0.4 + 0.4 land at 3.9999…
export const DRIFT_SPEED = 0.22;      // stage-heights per second while easing back down
export const ARM_RADIUS = 0.10;       // |figure - marker| within this arms it (marker gap 0.25 => no dead floor)
export const DISARM_HYSTERESIS = 1.5; // disarm once outside radius * this
export const WALK_FPS = 10;           // costume frames 3-4 alternate at 10fps
export const IDLE_FPS = 6;            // idle cycles the 4-frame costume row

// Costume sheet frame order (visual-assets-v2.md): idle(0), action-A(1),
// action-B(2), reaction(3) — SPEC v4 §4: "walk cycle in frames 3–4", i.e.
// 1-based sheets 3 and 4 => 0-based indices 2 and 3.
export const WALK_FRAMES = [2, 3];
export const IDLE_FRAMES = [0, 1, 2, 3];

// Evenly spaced marker x positions along the floor: N choices split the width
// into N+1 columns (2 choices -> 0.33/0.67, 4 -> 0.2/0.4/0.6/0.8).
export function markerPositions(count, max = MAX_MARKERS) {
  const n = Math.max(0, Math.min(count, max));
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
// y lives in the walkable band [0, FLOOR_TOP]: screen y grows downward, so the
// floor line is the bottom of the strip and 0 (stage top) is the back boundary.
const clampBand = (v) => Math.min(FLOOR_TOP, Math.max(0, Number(v) || 0));

export class StageWalk {
  // opts: { count, x, y, speed, armRadius, reducedMotion, now }
  constructor(opts = {}) {
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
    this.speed = opts.speed ?? WALK_SPEED;
    this.armRadius = opts.armRadius ?? ARM_RADIUS;
    this.reducedMotion = !!opts.reducedMotion;
    // v5 §1: free-roam (2D) is ON by default. `v2: false` restores the exact v4
    // contract — vertical keys ignored, no drift-back — for any legacy consumer.
    this.v2 = opts.v2 !== false;
    this.markers = [];
    this.armed = null;      // marker index or null
    this.facing = 1;        // 1 right, -1 left
    this.dir = 0;           // integrated horizontal direction from held keys (-1..1)
    this.vdir = 0;          // integrated vertical direction (-1 up, +1 down) — v5 §1
    this._held = new Set(); // active directions ('left' | 'right' | 'up' | 'down')
    this._teleportTarget = null;
    this._lastT = null;
    this.x = DEFAULT_X;
    this.y = FLOOR_TOP;     // starts standing on the floor line
    this._idleT = 0;        // seconds since the last movement input (drift timer)
    this.setChoiceCount(opts.count ?? 0);
    // Anchor the clock at construction so a controller built at t=900 does not
    // teleport on its first update() (dt is capped, but pinning is cleaner).
    this._lastT = this._now();
  }

  // Re-place markers for a new event card. Keeps the figure's spot but re-derives
  // the armed marker so a stale arm never survives a card swap.
  setChoiceCount(count) {
    this.markers = markerPositions(count);
    this.armed = this._markerAt(this.x, this.y);
    return this.markers;
  }

  // v5 §1: arming is an x-distance check that only applies while the figure
  // stands on the floor band (y at the floor line). Walking up/down never arms.
  _markerAt(x, y = FLOOR_TOP) {
    if (Math.abs(y - FLOOR_TOP) > 0.02) return null;
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.markers.length; i++) {
      const d = Math.abs(this.markers[i] - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD <= this.armRadius ? best : null;
  }

  hold(dir) { // dir: 'left' | 'right' | 'up' | 'down' (arrows/WASD map here)
    if (!['left', 'right', 'up', 'down'].includes(dir)) return false;
    this._held.add(dir);
    this._syncDir();
    return true;
  }

  release(dir) {
    this._held.delete(dir);
    this._syncDir();
    return true;
  }

  _syncDir() {
    const l = this._held.has('left') ? -1 : 0;
    const r = this._held.has('right') ? 1 : 0;
    this.dir = l + r;
    const u = this._held.has('up') ? -1 : 0;
    const d = this._held.has('down') ? 1 : 0;
    this.vdir = u + d;
  }

  // Teleport toward a marker (reduced motion): walks over `duration` seconds by
  // easing x to the target without any walk-cycle animation.
  teleportTo(markerIndex) {
    const m = this.markers[markerIndex];
    if (m == null) return false;
    this._teleportTarget = m;
    return true;
  }

  // Advance the simulation by dt seconds (default: real elapsed time since the
  // last update, capped so a hidden tab cannot teleport the figure). Tests and
  // the rAF driver pass an explicit small dt.
  update(dt = this._now() - (this._lastT ?? this._now())) {
    this._lastT = this._now();
    if (!Number.isFinite(dt)) return this.x;
    dt = Math.max(0, Math.min(dt, 2)); // cap pathological stalls only
    let moved = false;
    if (this._teleportTarget != null) {
      const step = this.speed * 3 * dt; // eased glide, faster than a walk
      const d = this._teleportTarget - this.x;
      if (Math.abs(d) <= Math.max(step, 0.005)) {
        this.x = this._teleportTarget;
        this._teleportTarget = null;
      } else {
        this.x += Math.sign(d) * step;
        this.facing = d >= 0 ? 1 : -1;
      }
      moved = true;
    } else if (this.dir !== 0 || this.vdir !== 0) {
      // v5 §1 free roam: x ∈ [0,1], y ∈ [FLOOR_TOP, 1]. No back-view art exists,
      // so vertical walking just translates the figure (renderer flips x via
      // ctx.scale(-1,1) when facing left).
      if (this.dir !== 0) {
        this.x = clamp01(this.x + this.dir * this.speed * dt);
        this.facing = this.dir;
      }
      if (this.vdir !== 0) this.y = clampBand(this.y + this.vdir * this.speed * dt);
      this._idleT = 0;
      moved = true;
    }
    // Idle drift-back: after IDLE_DRIFT_DELAY s with no movement input, ease
    // back onto the floor line so the composition stays tidy (spec §1). Any
    // held direction above resets the timer via the branch below.
    if (this.v2 && !moved && this._teleportTarget == null) {
      this._idleT += dt;
      if (this._idleT >= IDLE_DRIFT_DELAY - DRIFT_EPS && this.y < FLOOR_TOP) {
        if (this.reducedMotion) this.y = FLOOR_TOP; // reduced motion: instant snap
        else this.y = Math.min(FLOOR_TOP, this.y + DRIFT_SPEED * dt); // drift back DOWN to the floor line
      }
    }
    // Arm/disarm with hysteresis so standing on a boundary cannot flicker.
    // Both checks are floor-band gated: being off the band never arms, and it
    // does NOT disarm either — going up to look around keeps your armed choice.
    if (this.armed != null && this.onFloor()) {
      const d = Math.abs(this.markers[this.armed] - this.x);
      if (d > this.armRadius * DISARM_HYSTERESIS) this.armed = null;
    }
    const near = this._markerAt(this.x, this.y);
    if (near != null) this.armed = near;
    return this.x;
  }

  // Standing on the floor band (close enough to the floor line to arm markers)?
  onFloor(band = 0.02) { return Math.abs(this.y - FLOOR_TOP) <= band; }

  // Costume frame index for the current mode at time t. Walk alternates the two
  // gait frames at WALK_FPS; idle cycles all four at IDLE_FPS; reduced motion
  // pins the idle pose (frame 0) — no walk animation ever shows.
  frame(t = this._now()) {
    if (this.reducedMotion) return 0;
    const walking = this.dir !== 0 || this.vdir !== 0 || this._teleportTarget != null;
    const frames = walking ? WALK_FRAMES : IDLE_FRAMES;
    const fps = walking ? WALK_FPS : IDLE_FPS;
    const i = Math.floor(Math.max(0, t) * fps);
    return frames[((i % frames.length) + frames.length) % frames.length];
  }

  // Key handling. Actions: 'left'/'right'/'up'/'down' (hold), 'confirm',
  // 'select:<n>', 'forfeit', 'ignore'. Arrow keys are always consumed while a
  // card is open so the page never scrolls underneath it (v4 §2 unchanged).
  keyAction(key) {
    switch (key) {
      case 'ArrowLeft': case 'a': case 'A': return 'left';
      case 'ArrowRight': case 'd': case 'D': return 'right';
      // v5 §1: vertical roam keys are gated on the controller's own v2 flag, so
      // a v4-mode controller (v2: false) keeps the v4 contract exactly. The key
      // itself is still consumed by the UI (no page scroll) either way.
      case 'ArrowUp': return this.v2 ? 'up' : 'ignore';
      case 'ArrowDown': return this.v2 ? 'down' : 'ignore';
      case 'w': case 'W': case 's': case 'S': return this.v2 ? (key.toLowerCase() === 'w' ? 'up' : 'down') : 'ignore';
      case 'Enter': case ' ': return 'confirm';
      default: {
        const m = /^[1-9]$/.exec(key || '');
        if (m) return `select:${m[0]}`;
        return 'ignore';
      }
    }
  }

  // v5 §4: Escape means 'forfeit' — but ONLY to the minigame overlay. Walk mode
  // keeps the v4 contract (Escape is not walk input), so this lives beside
  // keyAction instead of inside it.
  forfeitAction(key) { return key === 'Escape' ? 'forfeit' : 'ignore'; }

  // Apply one keyboard action (from keyAction). Returns a small report so the
  // UI can react (scroll prevention lives in the caller, not here).
  apply(action) {
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      if (this.reducedMotion) {
        // No walk mode under reduced motion: horizontal arrows jump straight to
        // the next marker; vertical keys are consumed but do nothing (v4 §2).
        if (action === 'up' || action === 'down') return { moved: false };
        const cur = this.armed != null ? this.armed : (this.x < 0.5 ? -1 : this.markers.length);
        const next = action === 'left' ? cur - 1 : cur + 1;
        if (next >= 0 && next < this.markers.length) this.teleportTo(next);
        return { moved: true, teleported: true };
      }
      this.hold(action);
      return { moved: true };
    }
    if (action.startsWith('select:')) {
      const idx = Number(action.slice(7)) - 1;
      if (idx >= 0 && idx < this.markers.length) {
        this.x = this.markers[idx];
        this.armed = idx;
        this._teleportTarget = null;
        return { selected: idx };
      }
      return {};
    }
    if (action === 'confirm') {
      return this.armed != null ? { confirm: this.armed } : {};
    }
    // 'forfeit' / 'ignore': nothing for walk mode — the minigame overlay owns Esc.
    return {};
  }
}
