// src/render/ParallaxBg.js — two-layer looping background strips (SPEC §4.4 / §6).
// Studio delivers bg_[era]_far/near as 640x180 PNGs = two seamless 320x180 frames
// side by side. We translate + wrap: drawing the strip twice back-to-back and
// keeping the offset in [0, stripW) gives an infinite scroll. Scroll speed scales
// with era index (slow cave -> imperceptibly fast singularity); offsets reset on
// era change so each era starts at its own seam.

export const STRIP_FRAME_W = 320; // one seamless frame
export const STRIP_W = 640;       // delivered sheet width (2 frames)

// Era tempo multiplier per era index (0-based): roughly geometric acceleration,
// era 1 = 0.25x, era 11 = ~8x base px/sec.
export function eraTempo(eraIndex0) {
  const i = Math.max(0, Math.min(10, eraIndex0 | 0));
  return Math.pow(1.4, i);
}

// Layer speeds relative to era tempo (visual-assets-v2.md: far 0.12x / near 0.35x).
export const LAYER_FACTOR = { far: 0.12, near: 0.35 };
export const BASE_SPEED = 10; // px/sec at tempo 1.0

// Wrap a raw offset into [0, period). Negative-safe (leftward scroll).
export function wrapOffset(offset, period) {
  if (!(period > 0)) return 0;
  return ((offset % period) + period) % period;
}

export class ParallaxBg {
  // layers: { far: img|null, near: img|null } for the ACTIVE era (caller swaps via setEra)
  // opts: { now, reducedMotion, baseSpeed }
  constructor(opts = {}) {
    this.layers = { far: null, near: null };
    this.eraNum = 1;
    this.offsets = { far: 0, near: 0 };
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
    this._last = null;
    this.reducedMotion = !!opts.reducedMotion;
    this.baseSpeed = opts.baseSpeed ?? BASE_SPEED;
  }

  // Reset scroll offsets on era change (spec: "Tracks scroll offset per era, resets
  // on era change"). Returns true when the era actually changed.
  setEra(num, layers = null) {
    const changed = num !== this.eraNum;
    if (changed) {
      this.eraNum = num;
      this.offsets.far = 0;
      this.offsets.near = 0;
      this._last = null;
    }
    if (layers) this.layers = { far: layers.far ?? null, near: layers.near ?? null };
    return changed;
  }

  setReducedMotion(v) { this.reducedMotion = !!v; }

  // Advance both layer offsets by dt seconds (auto-measured when omitted).
  update(dt) {
    if (this.reducedMotion) return this.offsets;
    const now = this._now();
    if (dt === undefined) {
      if (this._last == null) this._last = now;
      dt = Math.min(now - this._last, 0.25); // clamp tab-switch jumps
      this._last = now;
    }
    const tempo = eraTempo(this.eraNum - 1);
    const period = this.stripWidth();
    this.offsets.far = wrapOffset(this.offsets.far + this.baseSpeed * LAYER_FACTOR.far * tempo * dt, period);
    this.offsets.near = wrapOffset(this.offsets.near + this.baseSpeed * LAYER_FACTOR.near * tempo * dt, period);
    return this.offsets;
  }

  stripWidth() {
    for (const img of [this.layers.far, this.layers.near]) {
      const w = img && (img.naturalWidth || img.width);
      if (w > 0) return w; // delivered strips are 640; honor whatever loads
    }
    return STRIP_W;
  }

  // Draw both layers into ctx mapped to normalized 100x100 space (like figure/palettes).
  // The strips are painted as full-width bands (far band upper, near band lower),
  // repeated edge-to-edge with the wrapped offset. Missing layer -> skipped silently
  // (the v1 procedural drawBackground underneath still shows).
  draw(ctx, viewW = 100, viewH = 100) {
    const periodUnits = (viewW * this.stripWidth()) / STRIP_FRAME_W / 4; // scale strip into view
    const bandH = viewH * (180 / STRIP_FRAME_W) / 4; // preserve strip aspect at that scale
    const specs = [
      ['far', viewH * 0.18],
      ['near', viewH * 0.58],
    ];
    for (const [name, y] of specs) {
      const img = this.layers[name];
      if (!img || !(img.complete === undefined || img.complete) ) continue;
      if (img.naturalWidth === 0) continue;
      ctx.save();
      const off = wrapOffset(periodUnits - this.offsets[name] * (periodUnits / this.stripWidth()), periodUnits);
      for (let x = -off; x < viewW; x += periodUnits) {
        ctx.drawImage(img, x, y, periodUnits, bandH);
      }
      ctx.restore();
    }
  }
}
