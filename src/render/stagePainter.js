// src/render/stagePainter.js — SPEC v4 §3: scene availability + never-blank stage.
//
// Pure drawing helpers for the event-card stage canvas: decide whether a scene
// sheet is usable, draw it letterboxed (contain), and fall back to era background
// + idle costume figure when it is not. No DOM beyond an injected 2D context and
// image stubs; tests drive it with a recording fake ctx.

import { drawFrame, spriteReady } from './AnimScene.js';

export const SCENE_SHEET_W = 1280; // Studio contract: 8 cells x 160x180
export const SCENE_SHEET_H = 180;
export const SCENE_CELLS = 8;
export const FLOOR_FRAC = 0.62;    // horizon/floor line the figure walks on (§4 art contract)
export const FIGURE_H_FRAC = 0.5;  // costume height as a fraction of stage height

// Is this sheet usable as an 8-cell scene strip? Logs naturalWidth vs expected on
// every check so a geometry mismatch is visible in the console instead of silently
// no-op'ing (the v3 blank-stage bug). A sheet is drawable when its width slices
// into >=1 cells whose height matches the sheet's own height (square-ish cells) —
// the contract is 8 x 160x180 = 1280x180. Returns { ok, reason }.
export function checkSceneSheet(img, log = null) {
  const natW = img?.naturalWidth || img?.width || 0;
  const natH = img?.naturalHeight || img?.height || 0;
  const report = (ok, reason) => {
    if (log && (!ok || natW !== SCENE_SHEET_W)) log(`[stage] scene sheet: ${reason} (naturalWidth=${natW}, expected ${SCENE_CELLS}x${SCENE_SHEET_W / SCENE_CELLS}=${SCENE_SHEET_W})`);
    return { ok, reason };
  };
  if (!img) return report(false, 'sheet missing (load failed)');
  if (!spriteReady(img)) return report(false, 'sheet not decoded');
  if (!natW || !natH) return report(false, 'zero-size sheet (decode failed)');
  const totalFrames = Math.floor(natW / natH); // equal-height cells laid out in one row
  if (!(totalFrames > 0)) return report(false, `totalFrames computes ${totalFrames}`);
  // Cells must be near-square: a sheet that slices into tall slivers means the
  // frame count is wrong (the blank-stage signature), not just off-contract.
  const cellW = natW / totalFrames;
  if (cellW < natH * 0.9) return report(false, `cells ${Math.round(cellW)}x${natH} too narrow for ${totalFrames}-frame slice (geometry mismatch)`);
  return report(true, `${totalFrames} frames of ${Math.round(cellW)}x${natH}`);
}

// Letterbox ("object-fit: contain") rect for a source of sw×sh inside w×h.
export function containRect(sw, sh, w, h) {
  if (!(sw > 0 && sh > 0 && w > 0 && h > 0)) return { dx: 0, dy: 0, dw: w, dh: h };
  const s = Math.min(w / sw, h / sh);
  const dw = sw * s, dh = sh * s;
  return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
}

// Draw one scene frame letterboxed. Clears first so frame N never ghosts frame N-1.
export function drawSceneFrame(ctx, img, f, w, h, frameCount = SCENE_CELLS) {
  ctx.clearRect(0, 0, w, h);
  const natW = img?.naturalWidth || 0, natH = img?.naturalHeight || 0;
  const { dx, dy, dw, dh } = containRect(natW / frameCount, natH, w, h);
  return drawFrame(ctx, img, f, dx, dy, dw, dh, frameCount);
}

// Fallback layer pair for an unavailable scene: era background strips (tiled to
// fill, near band anchored to the bottom) + the era costume idle figure standing
// on the floor line. Used whenever checkSceneSheet fails OR a scene frame draws
// nothing. The stage is never empty.
export function drawStageFallback(ctx, { bgFar = null, bgNear = null, costume = null }, w, h, frame = 0) {
  ctx.clearRect(0, 0, w, h);
  let drew = false;
  const tile = (img, bandY, bandH, alpha) => {
    const iw = img?.naturalWidth || 0, ih = img?.naturalHeight || 0;
    if (!spriteReady(img) || !iw || !ih) return false;
    const s = bandH / ih;
    const dw = iw * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let x = 0; x < w; x += Math.max(1, dw)) ctx.drawImage(img, 0, 0, iw, ih, x, bandY, dw, bandH);
    ctx.restore();
    return true;
  };
  // far layer fills above the floor line, near layer hugs it
  drew = tile(bgFar, 0, h * FLOOR_FRAC, 0.85) || drew;
  drew = tile(bgNear, h * FLOOR_FRAC - h * 0.18, h * (1 - FLOOR_FRAC) + h * 0.18, 1) || drew;
  if (!drew) {
    // No layers available at all: paint a solid era-tinted backdrop so the
    // stage is never empty even before/without any sprite asset (offline boot).
    ctx.fillStyle = '#141a2b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(90, 110, 150, 0.35)';
    ctx.fillRect(0, Math.round(h * FLOOR_FRAC), w, h - Math.round(h * FLOOR_FRAC));
    drew = true;
  }
  // idle costume figure on the floor line, stage-left of center
  const ch = h * FIGURE_H_FRAC;
  const cw = costume?.naturalWidth && costume?.naturalHeight ? ch * (costume.naturalWidth / 4) / costume.naturalHeight : ch / 2;
  if (drawFrame(ctx, costume, frame, w * 0.25 - cw / 2, h * FLOOR_FRAC - ch, cw, ch, 4)) drew = true;
  return drew;
}
