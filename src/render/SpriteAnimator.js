// src/render/SpriteAnimator.js — carrier costume + badge animation (SPEC §4.1 / §6).
// Loads per-era costume sheets (Studio: 512x256 = 4 cells x 128x256; order idle,
// action-A, action-B, reaction), slices the 4 frames, and overlays the current
// frame on the v1 parametric stick figure drawn by figure.js. Milestone badges
// (24x24) are composited as persistent glyphs that carry across costume changes.
//
// Graceful degradation: a missing/failed sheet marks the era unavailable and the
// caller keeps the pure-parametric v1 figure. Gameplay is never gated on art.

import { drawFrame, spriteReady } from './AnimScene.js';

export const COSTUME_FRAME_W = 128;
export const COSTUME_FRAME_H = 256;
export const COSTUME_FPS = 6; // visual-assets-v2.md default
export const COSTUME_FRAMES = 4;
export const BADGE_SIZE = 24;

// v2.1 (§9.3): carrier animation state follows the game, not a fixed loop.
// Sheet frame order is idle(0), action-A(1), action-B(2), reaction(3).
export const CARRIER_STATES = ['idle', 'producing', 'event'];
export const CARRIER_STATE_FRAMES = { idle: 0, producing: 1, event: 0 };
export const REACTION_MIN_ENTROPY = 60; // entropy > 60 => occasional reaction flash
export const REACTION_PERIOD = 7; // seconds between reaction windows
export const REACTION_WINDOW = 0.5 / 7; // ~0.5s flash inside each period

export const ERA_IDS = ['cave', 'agriculture', 'bronze', 'dark_ages', 'renaissance', 'industry',
  'american', 'atomic', 'digital', 'connected', 'singularity'];
export const BADGE_NAMES = ['fire', 'city', 'surplus', 'print', 'factory', 'atom', 'code',
  'upload', 'fork', 'drift', 'benthic', 'star'];

// Badge glyph anchors around the figure (normalized 100x100 space of figure.js):
// an orbit above/around the head so badges read like an aura.
const BADGE_ORBIT = [
  [50, 18], [38, 22], [62, 22], [31, 30], [69, 30], [28, 41],
  [72, 41], [31, 52], [69, 52], [38, 61], [62, 61], [50, 72],
];

// Frame index for elapsed seconds at fps over a 4-frame cycle.
export function costumeFrameAt(t, fps = COSTUME_FPS, frameCount = COSTUME_FRAMES) {
  if (!(frameCount > 0)) return 0;
  return ((Math.floor(t * fps) % frameCount) + frameCount) % frameCount;
}

// Slice metadata for the 4-cell costume row.
export function sliceCostumeFrames() {
  return Array.from({ length: COSTUME_FRAMES }, (_, i) => ({ sx: i * COSTUME_FRAME_W, sy: 0, w: COSTUME_FRAME_W, h: COSTUME_FRAME_H }));
}

// Load every asset through one injectable loader (Image in browser, stub in tests).
// Returns { costumes: Map<eraId, img|null>, badges: Map<name, img|null> } — null means
// "failed/missing", callers fall back to parametric drawing / skip the glyph.
export async function loadAssets({ basePath = 'assets/sprites', loadImage } = {}) {
  const load = loadImage || ((src) => new Promise((res, rej) => {
    if (typeof Image === 'undefined') return rej(new Error('no Image'));
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`load failed: ${src}`));
    img.src = src;
  }));
  const grab = async (file) => {
    try { return await load(`${basePath}/${file}`); } catch { return null; }
  };
  const costumes = new Map();
  const badges = new Map();
  await Promise.all([
    ...ERA_IDS.map(async (id) => costumes.set(id, await grab(`costume_${id}.png`))),
    ...BADGE_NAMES.map(async (n) => badges.set(n, await grab(`badge_${n}.png`))),
  ]);
  return { costumes, badges };
}

export class SpriteAnimator {
  // assets: { costumes: Map<eraId,img|null>, badges: Map<name,img|null> }
  // opts: { now, reducedMotion }
  constructor(assets, opts = {}) {
    this.assets = assets || { costumes: new Map(), badges: new Map() };
    this.eraNum = 1;
    this.badges = []; // earned badge names, persisted by the UI layer
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
    this.reducedMotion = !!opts.reducedMotion;
    // v2.1 carrier anim state (§9.3): producing => action-A loop, event open =>
    // idle, entropy > 60 => occasional reaction frame. Set by the scene layer.
    this.carrierState = 'idle';
    this.entropy = 0;
  }

  setEra(num) { this.eraNum = num; }
  setReducedMotion(v) { this.reducedMotion = !!v; }
  setCarrierState(s) { if (CARRIER_STATES.includes(s)) this.carrierState = s; }
  setEntropy(v) { this.entropy = Number.isFinite(v) ? v : 0; }

  eraId(num = this.eraNum) { return ERA_IDS[num - 1] || null; }

  // Deterministic "occasional" reaction: entropy-gated periodic windows, so a
  // test can pin elapsed time instead of praying to rng. One ~0.5s flash per
  // REACTION_PERIOD cycle, at the end of each cycle (phase >= 1-w).
  isReactionFrame(t = this._now()) {
    if (!(this.entropy > REACTION_MIN_ENTROPY)) return false;
    const phase = (t % REACTION_PERIOD) / REACTION_PERIOD;
    return phase >= 1 - REACTION_WINDOW;
  }

  // Earn a milestone badge (idempotent). Returns true when newly added.
  addBadge(name) {
    if (!BADGE_NAMES.includes(name) || this.badges.includes(name)) return false;
    this.badges.push(name);
    return true;
  }
  hasBadge(name) { return this.badges.includes(name); }

  // True when a usable costume sheet exists for the current era.
  available() {
    const id = this.eraId();
    return !!(id && spriteReady(this.assets.costumes.get(id)));
  }

  // Frame index for the current anim state. Event open pins frame 0 (idle);
  // producing loops from frame 1 (action-A) so the loop never shows idle;
  // a reaction flash overrides everything with frame 3 (§9.3).
  currentFrame(t = this._now()) {
    if (this.isReactionFrame(t)) return 3;
    if (this.carrierState === 'event') return CARRIER_STATE_FRAMES.event;
    if (this.reducedMotion) return 2;
    const start = CARRIER_STATE_FRAMES[this.carrierState] ?? 0;
    return start + (Math.floor(t * COSTUME_FPS) % (COSTUME_FRAMES - start));
  }

  // Overlay the costume frame centered on the figure column of the normalized
  // 100x100 space (figure occupies roughly x 26..74, baseline y=88 -> sheet maps
  // to a 36-wide box standing on the baseline). Badges composite last, always,
  // even when the costume itself is missing (badges are separate files).
  draw(ctx, t = this._now(), opts = {}) {
    const f = this.currentFrame(t);
    const img = this.assets.costumes.get(this.eraId());
    let drewCostume = false;
    if (spriteReady(img)) {
      ctx.save();
      if (this.eraId() === 'singularity') ctx.globalAlpha = 0.85; // partly-transparent carrier (§4.1)
      drewCostume = drawFrame(ctx, img, f, 32, 88 - 72, 36, 72, 4);
      ctx.restore();
    }
    this.drawBadges(ctx, t);
    return drewCostume;
  }

  // Composite earned badges as 24x24 glyphs scaled into the normalized space.
  drawBadges(ctx, t = this._now()) {
    const size = 6.4; // 24px glyph in ~100-unit space
    this.badges.forEach((name, i) => {
      const img = this.assets.badges.get(name);
      if (!spriteReady(img)) return;
      const [bx, by] = BADGE_ORBIT[i % BADGE_ORBIT.length];
      const bob = this.reducedMotion ? 0 : Math.sin(t * 1.6 + i * 1.3) * 0.6;
      drawFrame(ctx, img, 0, bx - size / 2, by - size / 2 + bob, size, size, 1);
    });
  }
}
