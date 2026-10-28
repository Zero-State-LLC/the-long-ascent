// src/render/renderer.js — canvas scene composer: background + figure + era transitions.
// Owns the rAF loop and DPR scaling; the UI layer calls setEra()/setMotion().

import { drawBackground } from './palettes.js';
import { drawFigure } from './figure.js';

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
    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);

  return {
    setEra(n) {
      if (n !== eraNum) { prevEra = eraNum; eraNum = n; crossfadeStart = performance.now() / 1000; }
    },
    setEntropy(v) { entropy = v; },
    setCopies(c) { copies = c; },
    setReducedMotion(v) { reducedMotion = !!v; },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); },
  };
}
