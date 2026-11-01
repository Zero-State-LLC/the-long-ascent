// src/ui/worldview.js — SPEC v9 §4 D1/D2/D4/D5 + §5: ONE layout authority,
// the entity render contract, measured & clamped text, and the fail-visible
// render loop. Split from scroller-boot.js (v9 §7): this module owns geometry,
// blits and the guarded rAF; the boot layer owns wiring.
//
// D5 — One authority geometry: a single layout() computes the uniform scale
//      min(vw/960, vh/540), a dpr-aware backing store, and a centered world
//      rect exported for renderer, hit-tests and chrome. Surplus on non-16:9
//      viewports goes to the chrome bands, never dead space; resize re-runs
//      layout() before the next frame.
// D4 — Measured & clamped text: drawClampedText() wraps to worldRect minus
//      margins, clamps the origin inside the world rect, and ellipsizes past
//      maxLines. No bare fillText in render paths.
// D1 — Entity render contract: blitEntity() computes destW = destH×srcW/srcH
//      from the Studio manifest (feet-anchored), throws loudly in dev when
//      src is missing/broken, and falls back to a labeled silhouette — never
//      an anonymous rect.
// D2 — Fail-visible render loop: frame() wraps update+paint in try/catch, keeps
//      a last-good offscreen framebuffer, paints a diagnostic stripe on fault,
//      auto-pauses after 3 consecutive faults (loop never dies), and R repaints.

import { VIEW_W, VIEW_H, TEXT_MARGIN, RENDER_FAULT_LIMIT, GLOW_FRAMES, GLOW_ALPHA } from '../engine/feel.js';

const FAULT_STRIPE_COLOR = 'rgba(230, 91, 75, 0.85)'; // --warn
const FAULT_BG = 'rgba(9, 15, 28, 0.95)';

/**
 * One authority geometry. Call once at boot; the returned object re-runs
 * layout() on resize (before the next frame) and exports worldRect.
 */
export function createLayout({ canvas, viewport = defaultViewport() } = {}) {
  let worldRect = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  let lastVw = 0, lastVh = 0;

  function layout({ vw, vh, dpr } = {}) {
    const w = vw ?? viewport().vw;
    const h = vh ?? viewport().vh;
    const ratio = dpr ?? viewport().dpr;
    lastVw = w; lastVh = h;
    // Uniform scale: the world is always 960×540 logical; surplus goes to chrome.
    const scale = Math.min(w / VIEW_W, h / VIEW_H);
    const dw = Math.round(VIEW_W * scale);
    const dh = Math.round(VIEW_H * scale);
    worldRect = { x: Math.round((w - dw) / 2), y: Math.round((h - dh) / 2), w: dw, h: dh, scale, dpr: ratio };
    // dpr-aware backing store: the canvas backing store covers the whole
    // viewport so the chrome bands can also live in DOM; the canvas paints the
    // world rect only (letterbox pillarbox is CSS/PALETTES background).
    if (canvas) {
      const bw = Math.max(1, Math.round(w * ratio));
      const bh = Math.max(1, Math.round(h * ratio));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    }
    return worldRect;
  }

  return {
    layout,
    resize() { return layout(); },
    get worldRect() { return worldRect; },
    get viewportSize() { return { vw: lastVw, vh: lastVh }; },
  };
}

function defaultViewport() {
  return () => ({
    vw: (typeof window !== 'undefined' && window.innerWidth) || VIEW_W,
    vh: (typeof window !== 'undefined' && window.innerHeight) || VIEW_H,
    dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
  });
}

/**
 * D4 — measured & clamped text. Wraps `text` to maxW (default worldRect minus
 * 2×TEXT_MARGIN), clamps the origin so the block stays inside the world rect,
 * and ellipsizes past maxLines. Returns the lines drawn.
 * No bare fillText anywhere else in the render paths (§4 D4 lint rule).
 */
export function drawClampedText(ctx, text, x, y, opts = {}) {
  const {
    maxW = null,
    maxLines = 3,
    lineH = 14,
    align = 'left',
    worldRect = { x: 0, y: 0, w: VIEW_W, h: VIEW_H },
    margin = TEXT_MARGIN,
    color = null,
    font = null,
  } = opts;
  const blockW = maxW ?? (worldRect.w - 2 * margin);
  const lines = wrapToWidth(ctx, String(text ?? ''), blockW, maxLines);
  if (font) ctx.font = font;
  if (color) ctx.fillStyle = color;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = align;
  // Clamp origin: x inside [worldRect.x+margin, worldRect.right−margin−blockW].
  const minX = worldRect.x + margin;
  const maxX = Math.max(minX, worldRect.x + worldRect.w - margin - blockW);
  const cx = Math.min(Math.max(x, minX), maxX);
  const minY = worldRect.y + margin + lineH;
  const cy = Math.min(Math.max(y, minY), worldRect.y + worldRect.h - margin);
  lines.forEach((line, i) => {
    // Negative-x anchor case: the origin is clamped, not mirrored.
    ctx.fillText(line, cx, cy + i * lineH);
  });
  ctx.textAlign = prevAlign;
  return lines;
}

/** Word-wrap with ellipsize on overflow. Pure over ctx.measureText. */
export function wrapToWidth(ctx, text, maxW, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let consumed = 0;
  let broke = false;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      consumed = i;
      line = words[i];
      if (lines.length === maxLines) { broke = i < words.length - 1; break; }
    } else {
      line = test;
      consumed = i + 1;
    }
  }
  if (lines.length < maxLines && line) { lines.push(line); consumed = words.length; }
  // Ellipsize: words remain that the maxLines budget couldn't hold.
  if ((broke || consumed < words.length) && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/**
 * D1 — entity render contract blit. Manifest row: {src, srcW, srcH, destH}.
 * destW = destH × srcW/srcH, anchored at the entity's FEET (x is center-x,
 * y is the feet line). Dev mode throws loudly on missing/broken src; the
 * fallback is a labeled silhouette in the entity's color identity — never an
 * anonymous rect.
 * @returns {{destW:number, destH:number, drawn:boolean}}
 */
export function blitEntity(ctx, row, img, x, feetY, { dev = true, label = null } = {}) {
  if (!row || typeof row !== 'object') throw new Error('blitEntity: missing manifest row');
  const { src, srcW, srcH, destH } = row;
  if (!src || !(srcW > 0) || !(srcH > 0) || !(destH > 0)) {
    if (dev) throw new Error(`blitEntity: broken manifest row ${JSON.stringify(row)}`);
    return { destW: 0, destH: 0, drawn: false };
  }
  const destW = destH * (srcW / srcH);
  const ready = img && (img.naturalWidth === undefined || img.naturalWidth > 0) && (img.complete === undefined || img.complete);
  if (!ready) {
    if (dev) throw new Error(`blitEntity: missing or broken image for ${src} (naturalWidth=0)`);
    drawLabeledSilhouette(ctx, x, feetY, destW, destH, label || row.label || src);
    return { destW, destH, drawn: false };
  }
  // Feet-anchored: bottom edge on the feet line, centered on x. Round to
  // integers so 1-px art stays crisp (imageSmoothingEnabled=false upstream).
  // 9-arg form: (img, sx=0, sy=0, sw=srcW, sh=srcH, dx, dy, dw, dh).
  ctx.drawImage(img, 0, 0, srcW, srcH, Math.round(x - destW / 2), Math.round(feetY - destH), Math.round(destW), Math.round(destH));
  return { destW, destH, drawn: true };
}

/** D1 fallback: a labeled silhouette with the entity's color identity. */
export function drawLabeledSilhouette(ctx, x, feetY, destW, destH, label = 'entity') {
  ctx.save();
  ctx.fillStyle = 'rgba(218, 232, 255, 0.25)'; // silhouette body (never a hard rect)
  const w = Math.max(4, Math.round(destW) || 16);
  const h = Math.max(4, Math.round(destH) || 16);
  ctx.beginPath();
  // Soft-edged capsule reads as "something stands here" without lying about art.
  const r = Math.min(w, h) / 2;
  ctx.moveTo(x - w / 2 + r, feetY);
  ctx.arcTo(x - w / 2, feetY - h, x + w / 2, feetY - h, r);
  ctx.arcTo(x + w / 2, feetY - h, x + w / 2, feetY, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#DAE8FF';
  ctx.font = '600 9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(label).slice(0, 14), x, feetY - h - 3);
  ctx.restore();
}

/**
 * Station glow: 2-frame ember pulse at 30% alpha behind terrain (Studio v9
 * station_glow.png, 256×128 sliced into GLOW_FRAMES frames). t = seconds.
 */
export function drawStationGlow(ctx, img, x, feetY, t, { destH = 64, frameW = null, alpha = GLOW_ALPHA } = {}) {
  if (!img || (img.naturalWidth === 0)) return false;
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return false;
  const fw = frameW ?? (natW / GLOW_FRAMES);
  const frame = Math.floor(t * 2) % GLOW_FRAMES; // ~0.5 s ember pulse
  const destW = destH * (fw / natH);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, frame * fw, 0, fw, natH, Math.round(x - destW / 2), Math.round(feetY - destH), Math.round(destW), Math.round(destH));
  ctx.restore();
  return true;
}

/**
 * D2 — fail-visible render loop. Wraps update+paint in try/catch; keeps a
 * last-good offscreen framebuffer committed only on successful frames; on a
 * fault paints a diagnostic stripe onto it and keeps rAF alive; after
 * RENDER_FAULT_LIMIT consecutive faults auto-pauses (never a dead black
 * screen). `faultCopy` is Scribe's render_fault copy.
 * @returns the controller (frame, resume, faultCount, paused getter)
 */
export function createGuardedLoop({ canvas, paint, update = null, faultCopy, onPause = () => {}, requestFrame = (fn) => requestAnimationFrame(fn) } = {}) {
  let raf = 0;
  let running = false;
  let lastT = 0;
  let consecutive = 0;
  let total = 0;
  let autoPaused = false;
  let lastGood = null; // offscreen committed per successful frame
  const copy = faultCopy || { stripe: 'RENDER FAULT — press R.', toast: 'Three faults running. Paused on the last good frame. Press R to repaint.' };

  function ensureLastGood() {
    if (lastGood || typeof document === 'undefined') return lastGood;
    if (!canvas || !canvas.width) return null;
    lastGood = document.createElement('canvas');
    return lastGood;
  }
  function commitGoodFrame() {
    const lg = ensureLastGood();
    if (!lg || !canvas || !canvas.width) return;
    if (lg.width !== canvas.width || lg.height !== canvas.height) {
      lg.width = canvas.width; lg.height = canvas.height;
    }
    const lctx = lg.getContext('2d');
    if (lctx && canvas.width > 0) lctx.drawImage(canvas, 0, 0);
  }
  function paintFaultStripe() {
    const lg = ensureLastGood();
    const ctx = (lg || canvas)?.getContext?.('2d');
    if (!ctx) return;
    const w = (lg || canvas).width, h = (lg || canvas).height;
    ctx.fillStyle = FAULT_BG;
    ctx.fillRect(0, Math.max(0, h * 0.82), w, Math.max(24, Math.round(h * 0.18)));
    ctx.fillStyle = FAULT_STRIPE_COLOR;
    ctx.fillRect(0, Math.max(0, h * 0.82), w, 4);
    ctx.save();
    ctx.fillStyle = '#DAE8FF';
    ctx.font = `600 ${Math.max(12, Math.round(h * 0.03))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(copy.stripe, w / 2, Math.max(16, h * 0.82 + 26));
    ctx.restore();
  }

  function frame(tms) {
    if (!running) return;
    const dt = lastT ? Math.min(0.25, (tms - lastT) / 1000) : 0;
    lastT = tms;
    try {
      if (update) update(dt);
      paint();
      consecutive = 0;
      commitGoodFrame();
    } catch (err) {
      consecutive += 1;
      total += 1;
      paintFaultStripe();
      if (consecutive >= RENDER_FAULT_LIMIT) {
        autoPaused = true;
        onPause({ consecutive, total, error: err });
        return; // loop stays registered but holds on the last good frame
      }
    }
    raf = requestFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastT = 0;
      raf = requestFrame(frame);
    },
    stop() {
      running = false;
      if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
      raf = 0;
    },
    /** R key: repaint from the last good frame and continue (auto-pause exit). */
    resume() {
      autoPaused = false;
      consecutive = 0;
      if (!running) { running = true; lastT = 0; raf = requestFrame(frame); }
    },
    /** Sim-level pause passthrough so the boot layer can freeze on auto-pause. */
    get paused() { return autoPaused; },
    get faultCount() { return total; },
    get consecutiveFaults() { return consecutive; },
    get running() { return running; },
  };
}
