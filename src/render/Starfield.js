// src/render/Starfield.js — SPEC §11: The Crossing canvas renderer.
//
// Draws the pure-logic run from core/crossing.js: parallax starfield at high
// tempo (ParallaxBg with the void palette), scrolling obstacle sprites
// (ship_lineage / obs_derelict / obs_comet) and gate rings (gate_ring). All
// sprite loads degrade gracefully — a missing sheet draws a stroked box so the
// game is never gated on art (same contract as SpriteAnimator).

import { ParallaxBg } from './ParallaxBg.js';
import { spriteReady } from './AnimScene.js';
import { mulberry32 } from '../core/crossing.js';

const SPRITE_BASE = 'assets/sprites/';
export const CROSSING_SPRITES = ['ship_lineage', 'obs_derelict', 'obs_comet', 'gate_ring'];

// Deterministic star parallax: 3 depth planes scrolling at 0.15/0.4/0.9 of run
// scroll. Seeded once per renderer so the field is stable across frames.
export function drawStars(ctx, run, width, height, tSec = 0) {
  if (!this._stars) {
    const rng = mulberry32('crossing-stars');
    this._stars = [0.15, 0.4, 0.9].map((f, plane) => ({
      f,
      pts: Array.from({ length: 40 + plane * 30 }, () => ({ x: rng() * width * 2, y: rng() * height, r: 0.6 + plane * 0.7 })),
    }));
  }
  ctx.save();
  ctx.fillStyle = '#cdd6ff';
  for (const plane of this._stars) {
    const off = (run.distance * plane.f) % (width * 2);
    for (const p of plane.pts) {
      let x = p.x - off;
      if (x < -2) x += width * 2;
      if (x <= width) ctx.fillRect(x, p.y, p.r, p.r);
    }
  }
  ctx.restore();
}

export class StarfieldRenderer {
  constructor() {
    this.images = new Map(); // name -> HTMLImageElement (or null if failed)
    this._loaded = false;
  }

  async load() {
    await Promise.all(CROSSING_SPRITES.map(async (name) => {
      const img = new Image();
      try {
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `${SPRITE_BASE}${name}.png`; });
        this.images.set(name, img);
      } catch {
        this.images.set(name, null);
      }
    }));
    this._loaded = true;
    return this;
  }

  has(name) { return !!this.images.get(name); }

  /** Draw one frame of `run` (a crossing.js state) onto ctx (logical W x H). */
  draw(ctx, run, tSec, { width = 960, height = 540 } = {}) {
    // background: void parallax at high tempo. ParallaxBg draws nothing when the
    // strips are missing, so paint a starfield base first and let strips layer on.
    ctx.fillStyle = '#05030d';
    ctx.fillRect(0, 0, width, height);
    // Deterministic 3-plane star parallax; strips (if loaded) layer on top.
    drawStars.call(this, ctx, run, width, height, tSec);
    const bg = this._bg || (this._bg = new ParallaxBg({ reducedMotion: !!run.reducedMotion }));
    bg.setEra(17); // void palette era slot; strips optional
    bg.update(1 / 60 * 3); // high tempo multiplier (§11)
    bg.draw?.(ctx, width, height);

    for (const e of run.entities) {
      if (e.x > width + 80 || e.x + e.w < -80) continue;
      if (e.kind === 'derelict' || e.kind === 'comet') {
        const img = this.images.get(e.kind === 'derelict' ? 'obs_derelict' : 'obs_comet');
        if (spriteReady(img)) ctx.drawImage(img, e.x, e.y, e.w, e.h);
        else { ctx.strokeStyle = e.hit ? '#ff5a4d' : '#7f8bb3'; ctx.strokeRect(e.x, e.y, e.w, e.h); }
      } else if (e.kind.startsWith('gate')) {
        const img = this.images.get('gate_ring');
        if (spriteReady(img)) {
          // ring stretched over the half-post span
          ctx.drawImage(img, e.x - 12, e.y, e.w + 24, e.h);
        } else {
          ctx.strokeStyle = e.hit ? '#ff5a4d' : '#54d6c8';
          ctx.strokeRect(e.x, e.y, e.w, e.h);
        }
      }
    }

    // ship
    const s = run.ship;
    const ship = this.images.get('ship_lineage');
    if (spriteReady(ship)) ctx.drawImage(ship, s.x - 28, s.y - 18, 56, 36);
    else { ctx.fillStyle = '#e9d9b8'; ctx.fillRect(s.x - 14, s.y - 9, 28, 18); }

    // HUD: hull pips + score (canvas-side so it scales with the playfield)
    ctx.fillStyle = '#e9d9b8';
    ctx.font = '16px monospace';
    ctx.fillText(`HULL ${'◆'.repeat(Math.max(0, run.hull))}${'◇'.repeat(Math.max(0, 3 - run.hull))}  SCORE ${Math.floor(run.score)}  GATES ${run.gatesPassed}`, 16, 28);
  }
}
