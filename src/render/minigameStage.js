// src/render/minigameStage.js — mini-game overlay on the existing stage canvas
// (SPEC v5 §2/§4). PURE drawing against a ctx with the same fake-ctx contract as
// stagePainter.js (tests drive a recording stub): no DOM access at module load.
//
// The overlay never draws its own background — drawMinigameFrame() is called
// AFTER the stage scene so era art stays visible underneath a dim scrim. All
// colors come from palettes.js tokens with literal fallbacks, and all copy from
// MINIGAME_COPY so Scribe's flavor swap touches zero render code.

import { MINIGAME_COPY } from '../core/minigames.js';

const INK = '#e8ecf6';
const DIM = 'rgba(8, 10, 18, 0.72)';
const GOOD = '#7fd88f';
const BAD = '#e07a6a';
const FAINT = 'rgba(232, 236, 246, 0.35)';

// Map normalized game coords to canvas px (stage space == canvas space here).
const px = (nx, w) => nx * w;

export function drawMinigameFrame(ctx, run, w, h, opts = {}) {
  if (!run) return;
  // Dim scrim over the live stage so the minigame reads as foreground (spec §2).
  ctx.fillStyle = DIM;
  ctx.fillRect(0, 0, w, h);

  const title = MINIGAME_COPY[run.family]?.title || run.family;
  ctx.fillStyle = INK;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(title.toUpperCase(), 14, 24);

  // Timer bar across the top under the title.
  const frac = Math.max(0, Math.min(1, run.t / run.dur));
  ctx.fillStyle = FAINT;
  ctx.fillRect(14, 32, w - 28, 4);
  ctx.fillStyle = INK;
  ctx.fillRect(14, 32, (w - 28) * frac, 4);

  switch (run.family) {
    case 'granary': {
      for (const s of run.items) {
        if (s.missed) continue;
        const age = run.t - (s.t - 1.2);                       // sack visible 1.2s before its line
        if (age < 0) continue;
        const y = Math.min(h * 0.82, h * 0.12 + (age / 1.2) * h * 0.7);
        ctx.fillStyle = s.caught ? GOOD : '#c9a86b';
        ctx.fillRect(px(s.x, w) - 8, y - 8, 16, 16);
      }
      ctx.fillStyle = INK;
      ctx.fillRect(px(run.handX, w) - 22, h * 0.82, 44, 8);     // the hand tray
      label(ctx, `${run.catches}/${run.total}`, w, h);
      break;
    }
    case 'scribe': {
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      for (let i = 0; i < run.seq.length; i++) {
        const glyph = '◇◈◆▣'[run.seq[i]] || '?';
        ctx.fillStyle = i < run.pos ? GOOD : i === run.pos ? INK : FAINT;
        ctx.fillText(glyph, w / 2 + (i - (run.seq.length - 1) / 2) * 44, h * 0.45);
      }
      label(ctx, run.penalty > 0 ? `- ${run.penalty.toFixed(1)}s` : '', w, h);
      break;
    }
    case 'trade': {
      ctx.fillStyle = FAINT;
      ctx.fillRect(0, h * 0.5, w, 2);                            // waterline
      ctx.fillStyle = GOOD;
      ctx.fillRect(px(run.buoyX, w) - 4, h * 0.42, 8, 16);       // buoy
      ctx.fillStyle = INK;
      ctx.fillRect(px(run.boatX, w) - 14, h * 0.48, 28, 8);      // boat
      const g = run.gusts[Math.min(run.gustIdx, run.gusts.length - 1)];
      if (g && !run.arrived) label(ctx, `wind ${g.dir < 0 ? '←' : '→'}`, w, h);
      break;
    }
    case 'sweep': {
      for (const b of run.bands) {
        const y = h * (1 - b.y);
        ctx.fillStyle = b.hit ? BAD : b.passed ? FAINT : '#6b5a4a';
        ctx.fillRect(w * (0.15 + b.lane * 0.28), y - 4, w * 0.2, 8);
      }
      ctx.fillStyle = INK;
      const sy = h * (1 - run.climb);
      ctx.fillRect(w * (0.15 + run.lane * 0.28) + (run.ducking ? 20 : 8), sy - (run.ducking ? 6 : 14), 12, run.ducking ? 6 : 14);
      break;
    }
    case 'fallout': {
      ctx.fillStyle = 'rgba(160, 90, 60, 0.55)';                 // the cloud
      ctx.fillRect(Math.max(0, px(run.cloud, w) - w * 0.12), h * 0.3, w * 0.12 + px(run.cloud, w), h * 0.4);
      ctx.fillStyle = GOOD;
      ctx.fillRect(w - 18, h * 0.35, 14, h * 0.3);               // shelter
      ctx.fillStyle = INK;
      ctx.fillRect(px(run.x, w) - 6, h * 0.42, 12, 20);          // runner
      ctx.fillStyle = FAINT;
      ctx.fillRect(14, h - 26, 100, 6);                          // stamina bar
      ctx.fillStyle = run.stamina > 0.25 ? GOOD : BAD;
      ctx.fillRect(14, h - 26, 100 * run.stamina, 6);
      break;
    }
    case 'carbon': {
      ctx.fillStyle = run.gate === 'L' ? GOOD : FAINT;
      ctx.fillRect(w * 0.25 - 3, h * 0.3, 6, h * 0.4);           // left gate
      ctx.fillStyle = run.gate === 'R' ? GOOD : FAINT;
      ctx.fillRect(w * 0.75 - 3, h * 0.3, 6, h * 0.4);           // right gate
      for (const p of run.pkts) {
        if (p.resolved) continue;
        const eta = p.t - run.t;
        if (eta > 2) continue;
        ctx.fillStyle = INK;
        ctx.fillRect(px(0.5, w) - 5, h * 0.45 - eta * h * 0.15, 10, 10);
      }
      label(ctx, `clean ${run.clean}/${run.routed}`, w, h);
      break;
    }
    case 'signal': {
      ctx.strokeStyle = FAINT;
      ctx.beginPath();                                            // drifting target wave
      for (let x = 0; x <= w; x += 8) {
        const tt = run.t - (w - x) * 0.004;
        const ty = 0.5 + 0.25 * Math.sin(tt * 0.7 + run.ph1) + 0.15 * Math.sin(tt * 1.9 + run.ph2);
        x === 0 ? ctx.moveTo(x, ty * h) : ctx.lineTo(x, ty * h);
      }
      ctx.stroke();
      const inTol = Math.abs(run.tone - (0.5 + 0.25 * Math.sin(run.t * 0.7 + run.ph1) + 0.15 * Math.sin(run.t * 1.9 + run.ph2))) <= run.tol;
      ctx.fillStyle = inTol ? GOOD : BAD;
      ctx.fillRect(w - 40, px(run.tone, h) - 3, 24, 6);          // current tone pip
      label(ctx, `${Math.round((run.goodT / run.dur) * 100)}% locked`, w, h);
      break;
    }
    default: break;
  }
}

function label(ctx, text, w, h) {
  if (!text) return;
  ctx.fillStyle = FAINT;
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(text, w - 14, h - 14);
}

// Pre-roll countdown on the stage canvas (spec §4): big numeral, no animation
// needed beyond frames 3/2/1 — reduced motion shows it statically per frame too.
export function drawCountdown(ctx, n, w, h) {
  ctx.fillStyle = DIM;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = INK;
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(n), w / 2, h / 2 + 20);
  ctx.font = '14px monospace';
  ctx.fillText(MINIGAME_COPY.countdown, w / 2, h / 2 + 52);
}

// End-of-run card drawn ON the stage canvas: verdict + score + delta chips
// (spec §4 — "delta chips on end"). deltas like { sustenance: 7, morale: 2 }.
export function drawEndCard(ctx, run, deltas, w, h) {
  ctx.fillStyle = DIM;
  ctx.fillRect(0, 0, w, h);
  const verdict = run.forfeited ? MINIGAME_COPY.forfeit : run.won ? MINIGAME_COPY.win : MINIGAME_COPY.lose;
  ctx.fillStyle = run.won ? GOOD : run.forfeited ? FAINT : BAD;
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(verdict.toUpperCase(), w / 2, h * 0.4);
  ctx.fillStyle = INK;
  ctx.font = '16px monospace';
  ctx.fillText(`${run.score} / ${run.target}`, w / 2, h * 0.4 + 30);
  // Delta chips row.
  const keys = Object.keys(deltas || {});
  let cx = w / 2 - (keys.length - 1) * 42;
  ctx.font = 'bold 13px monospace';
  for (const k of keys) {
    const v = deltas[k];
    ctx.fillStyle = v >= 0 ? 'rgba(60, 90, 66, 0.9)' : 'rgba(110, 60, 55, 0.9)';
    ctx.fillRect(cx - 34, h * 0.62 - 14, 68, 22);
    ctx.fillStyle = v >= 0 ? GOOD : BAD;
    ctx.fillText(`${k === 'sustenance' ? 'food' : k.slice(0, 5)} ${v >= 0 ? '+' : ''}${v}`, cx, h * 0.62 + 2);
    cx += 84;
  }
}
