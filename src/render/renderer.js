// src/render/renderer.js — canvas scene composer: parallax strips + background +
// figure (+ costume overlay, badges) + era transitions. Owns the rAF loop and DPR
// scaling; the UI layer calls setEra()/setMotion(). v2: optional SpriteAnimator and
// ParallaxBg layers are composited when available; anything missing degrades to the
// v1 procedural drawing (gameplay is never gated on art).

import { drawBackground } from './palettes.js';
import { drawFigure } from './figure.js';
import { ERA_IDS } from './SpriteAnimator.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let eraNum = 1;
  let prevEra = 1;
  let entropy = 0;
  let copies = 1;
  let reducedMotion = false;
  let crossfadeStart = -1; // time of last era change (-1 = none active)
  let running = true;
  let raf = null;
  let spriteAnimator = null; // SpriteAnimator | null
  let parallax = null;       // ParallaxBg | null
  const bgListeners = new Set(); // notified on era change (audio/UI hooks)

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function frame(ms) {
    if (!running) return;
    const t = ms / 1000;
    resize();
    const w = canvas.width, h = canvas.height;
    // map normalized 100x100 onto the canvas (uniform scale, letterboxed)
    const s = Math.min(w / 100, h / 100);
    ctx.setTransform(s, 0, 0, s, (w - 100 * s) / 2, (h - 100 * s) / 2);
    ctx.clearRect(-w, -h, w * 3, h * 3);

    const fadeDur = reducedMotion ? 0.15 : 0.7;
    const inFade = crossfadeStart >= 0 && t - crossfadeStart < fadeDur;
    if (inFade) {
      const k = (t - crossfadeStart) / fadeDur;
      drawBackground(ctx, prevEra, entropy, t);
      ctx.save(); ctx.globalAlpha = k; drawBackground(ctx, eraNum, entropy, t); ctx.restore();
      ctx.save(); ctx.globalAlpha = 1 - k * 0.4; drawFigure(ctx, prevEra, t, { reducedMotion, copies }); ctx.restore();
    } else {
      crossfadeStart = -1;
      drawBackground(ctx, eraNum, entropy, t);
      drawFigure(ctx, eraNum, t, { reducedMotion, copies });
    }
    // v2 layers over the parametric base (no-ops when assets/instances absent)
    if (parallax) { parallax.update(); parallax.draw(ctx); }
    if (spriteAnimator) spriteAnimator.draw(ctx, t);
    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);

  return {
    setEra(n) {
      if (n !== eraNum) {
        prevEra = eraNum; eraNum = n; crossfadeStart = performance.now() / 1000;
        if (spriteAnimator) spriteAnimator.setEra(n);
        if (parallax) parallax.setEra(n);
        for (const cb of bgListeners) { try { cb(n, prevEra); } catch { /* listener errors never break the loop */ } }
      }
    },
    setEntropy(v) { entropy = v; },
    setCopies(c) { copies = c; },
    setReducedMotion(v) {
      reducedMotion = !!v;
      if (spriteAnimator) spriteAnimator.setReducedMotion(reducedMotion);
      if (parallax) parallax.setReducedMotion(reducedMotion);
    },
    // v2 wiring: pass instances once loaded; null-safe, callable any time.
    setSpriteAnimator(sa) {
      spriteAnimator = sa || null;
      if (spriteAnimator) { spriteAnimator.setEra(eraNum); spriteAnimator.setReducedMotion(reducedMotion); }
    },
    setParallax(p) {
      parallax = p || null;
      if (parallax) { parallax.setEra(eraNum); parallax.setReducedMotion(reducedMotion); }
    },
    // Swap one era's strip pair without resetting scroll offsets mid-era.
    setParallaxLayers(farImg, nearImg) {
      if (parallax) parallax.layers = { far: farImg ?? null, near: nearImg ?? null };
    },
    onEraChange(cb) { bgListeners.add(cb); return () => bgListeners.delete(cb); },
    eraId(num = eraNum) { return ERA_IDS[num - 1] || null; },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); },
  };
}
