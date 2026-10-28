// src/render/AnimScene.js — per-event animated scene player (SPEC §4.2 / §6).
// Loads a scene sprite sheet (Studio: 1280x180 = 8 cells x 160x180), slices frames
// by pixel offset, plays an 8fps loop while the event card is open, and a one-shot
// outcome pass (frames 5-7, no loop) on choice selection before advancing.
//
// Pure logic lives in `frameAt()` so it is testable without a canvas; playback uses
// an injectable scheduler (rAF in the browser, manual pump() in tests).

export const SCENE_FRAME_W = 160;
export const SCENE_FRAME_H = 180;
export const SCENE_FPS = 8;
// Per visual-assets-v2.md: first 5 frames form the loop, final 3 are the choice outcome.
export const SCENE_LOOP_FRAMES = 5;

// Frame index for elapsed time t (seconds) at `fps`, given a frame count.
// Loops modulo count; one-shot clamps at the last frame (caller decides when done).
export function frameAt(t, fps, frameCount, loop = true) {
  if (!(frameCount > 0) || !(fps > 0)) return 0;
  const i = Math.floor(t * fps);
  if (loop) return ((i % frameCount) + frameCount) % frameCount;
  return Math.max(0, Math.min(i, frameCount - 1));
}

// Slice metadata for a sheet of `frameCount` cells laid out in one row.
export function sliceFrames(sheetWidth, frameCount) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) frames.push({ sx: i * SCENE_FRAME_W, sy: 0, w: SCENE_FRAME_W, h: SCENE_FRAME_H });
  return frames;
}

// Draw frame `f` of `sprite` into ctx at (dx, dy) scaled to (dw, dh).
// No-ops when the sprite is missing or not yet loaded (graceful degradation).
export function drawFrame(ctx, sprite, f, dx, dy, dw, dh) {
  if (!sprite || !spriteReady(sprite)) return false;
  const sx = f * SCENE_FRAME_W;
  ctx.drawImage(sprite, sx, 0, SCENE_FRAME_W, SCENE_FRAME_H, dx, dy, dw, dh);
  return true;
}

export function spriteReady(sprite) {
  if (!sprite) return false;
  if ('complete' in sprite) return !!sprite.complete && (sprite.naturalWidth === undefined || sprite.naturalWidth > 0);
  return true; // non-HTMLImage stubs (tests) are assumed ready
}

export class AnimScene {
  // ctx: 2D context of the destination canvas (e.g. the 320x180 event-card inset)
  // spriteEl: HTMLImageElement (or stub) already pointed at the scene sheet
  // opts: { loopFrames, now, schedule, cancel }
  constructor(ctx, spriteEl, frameW = SCENE_FRAME_W, frameH = SCENE_FRAME_H, fps = SCENE_FPS, opts = {}) {
    this.ctx = ctx;
    this.sprite = spriteEl;
    this.frameW = frameW;
    this.frameH = frameH;
    this.fps = fps;
    this.loopFrames = opts.loopFrames ?? SCENE_LOOP_FRAMES;
    this.totalFrames = opts.totalFrames ?? 8;
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
    this._schedule = opts.schedule || (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
    this._cancel = opts.cancel || (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : () => {});
    this.mode = 'stopped'; // stopped | loop | once
    this.onDone = null;
    this._t0 = 0;
    this._raf = null;
    this.currentFrame = 0;
  }

  get frameCount() { return this.totalFrames; }

  play(loop = true) {
    this.stop();
    this.mode = loop ? 'loop' : 'once';
    this._t0 = this._now();
    this._tick = this._tick.bind(this);
    if (this._schedule) this._raf = this._schedule(this._tick);
    return this;
  }

  playOnce(onDone) {
    this.stop();
    this.mode = 'once';
    this.onDone = onDone || null;
    this._t0 = this._now();
    if (this._schedule) this._raf = this._schedule(this._tick);
    return this;
  }

  stop() {
    if (this._raf != null) this._cancel(this._raf);
    this._raf = null;
    this.mode = 'stopped';
    this.onDone = null;
  }

  // Advance to time t (seconds since play start was tracked internally).
  // Manual pump for tests/headless: pass an explicit time.
  pump(t) {
    if (this.mode === 'stopped') return this.currentFrame;
    const el = (t ?? this._now()) - this._t0;
    if (this.mode === 'loop') {
      this.currentFrame = frameAt(el, this.fps, this.loopFrames, true);
    } else {
      const n = this.totalFrames - this.loopFrames; // outcome frames only (5..7)
      const i = frameAt(el, this.fps, n, false);
      this.currentFrame = this.loopFrames + i;
      if (i >= n - 1 && el >= (n - 1) / this.fps) {
        const cb = this.onDone;
        this.mode = 'stopped';
        this.onDone = null;
        if (cb) cb();
      }
    }
    return this.currentFrame;
  }

  _tick = () => {
    if (this.mode === 'stopped') return;
    this.pump();
    this.render();
    if (this.mode !== 'stopped' && this._schedule) this._raf = this._schedule(this._tick);
  };

  render() {
    if (!this.ctx) return;
    if (!drawFrame(this.ctx, this.sprite, this.currentFrame, 0, 0, this.ctx.canvas?.width || this.frameW * 2, this.ctx.canvas?.height || this.frameH)) {
      // graceful degradation: leave the canvas as-is (UI paints a placeholder)
    }
  }
}
