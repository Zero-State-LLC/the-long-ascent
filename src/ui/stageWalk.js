// src/ui/stageWalk.js — walkable-figure stage controller (SPEC v4 §2).
//
// PURE state machine: no DOM, no canvas. The UI layer feeds key events in
// (`press`/`release`/`keyAction`) and reads position/arm state out; tests drive
// it directly with a fake clock.
//
// Model: the figure stands on the stage floor at normalized x ∈ [0, 1]. Each
// choice gets a marker at an evenly spaced x (max MAX_MARKERS). Walking onto a
// marker ARMS that choice; walking away disarms it. Enter/Space confirms the
// armed choice. With reduced motion the figure teleports to the nearest marker
// instead of animating a walk.

export const MAX_MARKERS = 4;
export const DEFAULT_X = 0.25;        // idle spot: stage-x 25%
export const WALK_SPEED = 0.38;       // stage-widths per second
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

export class StageWalk {
  // opts: { count, x, speed, armRadius, reducedMotion, now }
  constructor(opts = {}) {
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
    this.speed = opts.speed ?? WALK_SPEED;
    this.armRadius = opts.armRadius ?? ARM_RADIUS;
    this.reducedMotion = !!opts.reducedMotion;
    this.markers = [];
    this.armed = null;      // marker index or null
    this.facing = 1;        // 1 right, -1 left
    this.dir = 0;           // integrated direction from held keys (-1..1)
    this._held = new Set(); // active directions ('left' | 'right')
    this._teleportTarget = null;
    this._lastT = null;
    this.x = DEFAULT_X;
    this.setChoiceCount(opts.count ?? 0);
    // Anchor the clock at construction so a controller built at t=900 does not
    // teleport on its first update() (dt is capped, but pinning is cleaner).
    this._lastT = this._now();
  }

  // Re-place markers for a new event card. Keeps the figure's spot but re-derives
  // the armed marker so a stale arm never survives a card swap.
  setChoiceCount(count) {
    this.markers = markerPositions(count);
    this.armed = this._markerAt(this.x);
    return this.markers;
  }

  _markerAt(x) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.markers.length; i++) {
      const d = Math.abs(this.markers[i] - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD <= this.armRadius ? best : null;
  }

  hold(dir) { // dir: 'left' | 'right' (ArrowLeft/A, ArrowRight/D map here)
    if (dir !== 'left' && dir !== 'right') return false;
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
    } else if (this.dir !== 0) {
      this.x = clamp01(this.x + this.dir * this.speed * dt);
      this.facing = this.dir;
    }
    // Arm/disarm with hysteresis so standing on a boundary cannot flicker.
    if (this.armed != null) {
      const d = Math.abs(this.markers[this.armed] - this.x);
      if (d > this.armRadius * DISARM_HYSTERESIS) this.armed = null;
    }
    const near = this._markerAt(this.x);
    if (near != null) this.armed = near;
    return this.x;
  }

  // Costume frame index for the current mode at time t. Walk alternates the two
  // gait frames at WALK_FPS; idle cycles all four at IDLE_FPS; reduced motion
  // pins the idle pose (frame 0) — no walk animation ever shows.
  frame(t = this._now()) {
    if (this.reducedMotion) return 0;
    const walking = this.dir !== 0 || this._teleportTarget != null;
    const frames = walking ? WALK_FRAMES : IDLE_FRAMES;
    const fps = walking ? WALK_FPS : IDLE_FPS;
    const i = Math.floor(Math.max(0, t) * fps);
    return frames[((i % frames.length) + frames.length) % frames.length];
  }

  // Key handling. Actions: 'left'/'right' (hold), 'confirm', 'select:<n>',
  // 'ignore'. Arrow keys are always consumed while a card is open so the page
  // never scrolls underneath it.
  keyAction(key) {
    switch (key) {
      case 'ArrowLeft': case 'a': case 'A': return 'left';
      case 'ArrowRight': case 'd': case 'D': return 'right';
      case 'Enter': case ' ': return 'confirm';
      default: {
        const m = /^[1-9]$/.exec(key || '');
        if (m) return `select:${m[0]}`;
        return 'ignore';
      }
    }
  }

  // Apply one keyboard action (from keyAction). Returns a small report so the
  // UI can react (scroll prevention lives in the caller, not here).
  apply(action) {
    if (action === 'left' || action === 'right') {
      if (this.reducedMotion) {
        // No walk mode under reduced motion: jump straight to the next marker.
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
    return {};
  }
}
