// src/engine/figure.js — SPEC v6 §1/§3: era costume figure rendering from the
// Studio sheets. Pure data + draw code (no DOM at import time): frame layout,
// anim-state mapping, and a canvas-2D draw that degrades to a parametric stick
// figure when the sheet image is missing (same graceful rule as v2-v5).
//
// Sheet contract (Studio v6, shipped): player_era<NN>.png = 18 frames of
// 64×128 in one row: idle ×6, walk ×6, jump ×4, mantle ×2. The engine's four
// anim states map onto those groups; `fall` reuses the jump group tail.

export const CELL_W = 64;
export const CELL_H = 128;
export const FRAME_GROUPS = {
  idle: { start: 0, count: 6 },
  walk: { start: 6, count: 6 },
  jump: { start: 12, count: 4 },
  mantle: { start: 16, count: 2 },
};
export const ANIM_FPS = { idle: 6, walk: 10, jump: 6, mantle: 8 };

/** Frame index within the sheet for an anim state at time t (seconds). */
export function frameIndex(anim, t) {
  const g = FRAME_GROUPS[anim] || FRAME_GROUPS.idle;
  if (anim === 'jump') return g.start; // hold the launch frame while rising/falling
  const fps = ANIM_FPS[anim] || 6;
  return g.start + (Math.floor(t * fps) % g.count);
}

export function sheetUrl(eraNum) {
  const n = String(Math.min(17, Math.max(1, eraNum))).padStart(2, '0');
  return `assets/player_era${n}.png`;
}

/**
 * Draw the figure. ctx-space: world coordinates already translated by camera.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{img: HTMLImageElement|null}} sheet loaded sheet for the current era
 * @param {{x,y,w,h,facing,anim,vx}} player collision box + state
 * @param {number} t seconds (walk cycle clock)
 * @param {{drawW?:number, drawH?:number}} on-screen size (default 48×96, feet-anchored)
 */
export function drawFigure(ctx, sheet, player, t, { drawW = 48, drawH = 96 } = {}) {
  const feetX = player.x + player.w / 2;
  const feetY = player.y + player.h;
  if (sheet?.img && sheet.img.complete !== false && (sheet.img.naturalWidth || sheet.img.width) > 0) {
    const fi = frameIndex(player.anim, t);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(feetX, feetY);
    if (player.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(sheet.img, fi * CELL_W, 0, CELL_W, CELL_H, -drawW / 2, -drawH, drawW, drawH);
    ctx.restore();
    return true;
  }
  drawStickFallback(ctx, player, t, { drawW, drawH });
  return false;
}

// Parametric stick figure (the v1 lineage): head, spine, arms, legs in stride.
export function drawStickFallback(ctx, player, t, { drawW = 48, drawH = 96 } = {}) {
  const cx = player.x + player.w / 2;
  const feet = player.y + player.h;
  const headR = drawH * 0.11;
  const spineTop = feet - drawH + headR * 2;
  const hip = feet - drawH * 0.42;
  const swing = player.anim === 'walk' ? Math.sin(t * 10) : 0;
  const air = player.anim === 'jump' || player.anim === 'fall';
  ctx.save();
  ctx.strokeStyle = '#DAE8FF';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, feet - drawH + headR, headR, 0, Math.PI * 2); // head
  ctx.moveTo(cx, spineTop); ctx.lineTo(cx, hip);             // spine
  // arms
  const ay = spineTop + drawH * 0.12;
  ctx.moveTo(cx, ay); ctx.lineTo(cx + (air ? -drawW * 0.3 : swing * drawW * 0.25), ay + drawH * 0.2);
  ctx.moveTo(cx, ay); ctx.lineTo(cx - (air ? -drawW * 0.3 : swing * drawW * 0.25), ay + drawH * 0.2);
  // legs
  ctx.moveTo(cx, hip); ctx.lineTo(cx + swing * drawW * 0.3, feet);
  ctx.moveTo(cx, hip); ctx.lineTo(cx - swing * drawW * 0.3, feet);
  ctx.stroke();
  ctx.restore();
}
