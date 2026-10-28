// src/render/figure.js — parametric stick-figure renderer per visual-assets.md §1.
// Coordinate space: normalized 100x100, origin top-left; baseline y=88; the ctx
// passed to drawFigure must already map that space onto the canvas.

import { ERA_INK, ERA_ACCENT } from './palettes.js';

// Pose tables (visual-assets.md §1). Unlisted joints use defaults:
// head r=5 at (50,32); torso (50,43)->(50,67); shoulder (50,48); hip (50,66/67).
export const POSES = {
  1: { // The Cave — hunched
    head: [48, 32], torso: [[50, 43], [52, 67]],
    armL: [[50, 48], [39, 57], [42, 66]], armR: [[50, 48], [61, 55], [66, 61]],
    legL: [[52, 67], [43, 78], [40, 88]], legR: [[52, 67], [61, 77], [64, 88]],
    prop: 'fire', propAnchor: [66, 61],
  },
  2: { // Agriculture — planted stance
    head: [50, 32], torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [38, 57], [36, 65]], armR: [[50, 48], [62, 54], [64, 63]],
    legL: [[50, 67], [42, 78], [40, 88]], legR: [[50, 67], [59, 78], [61, 88]],
    prop: 'grain', propAnchor: [64, 63],
  },
  3: { // Bronze & Empires — command pose
    head: [50, 32], torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [39, 54], [34, 50]], armR: [[50, 48], [62, 55], [67, 53]],
    legL: [[50, 67], [42, 78], [39, 88]], legR: [[50, 67], [58, 78], [62, 88]],
    prop: 'spear_shield', propAnchor: [34, 50], shieldAt: [67, 57],
  },
  4: { // Dark Ages — cloaked, bowed
    head: [50, 32], torso: [[50, 43], [50, 68]], cloak: true,
    armL: [[50, 48], [43, 57], [45, 64]], armR: [[50, 48], [57, 56], [61, 59]],
    legL: [[50, 68], [45, 78], [44, 88]], legR: [[50, 68], [54, 78], [56, 88]],
    prop: 'book', propAnchor: [61, 59],
  },
  5: { // Renaissance — curious lean
    head: [49, 31], torso: [[50, 43], [51, 67]],
    armL: [[50, 48], [40, 53], [37, 47]], armR: [[50, 48], [61, 54], [65, 60]],
    legL: [[51, 67], [43, 78], [41, 88]], legR: [[51, 67], [58, 78], [60, 88]],
    prop: 'openbook', propAnchor: [51, 59], quillFrom: [37, 47],
  },
  6: { // Steam — braced, forward lean
    head: [51, 31], torso: [[50, 43], [52, 67]],
    armL: [[50, 48], [39, 54], [35, 61]], armR: [[50, 48], [62, 54], [67, 50]],
    legL: [[52, 67], [44, 78], [41, 88]], legR: [[52, 67], [57, 78], [62, 88]],
    prop: 'wrench', propAnchor: [67, 50], gearBadge: [50, 51],
  },
  7: { // American Century — confident relaxed
    head: [50, 32], torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [40, 54], [37, 62]], armR: [[50, 48], [61, 52], [66, 48]],
    legL: [[50, 67], [44, 78], [42, 88]], legR: [[50, 67], [57, 78], [60, 88]],
    prop: 'briefcase', propAnchor: [66, 48],
  },
  8: { // Atomic — guarded, tense
    head: [50, 32], torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [41, 53], [45, 48]], armR: [[50, 48], [59, 53], [55, 48]],
    legL: [[50, 67], [44, 78], [45, 88]], legR: [[50, 67], [56, 78], [55, 88]],
    prop: 'geiger', propAnchor: [45, 48],
  },
  9: { // Digital Dawn — presenting
    head: [50, 31], torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [40, 55], [37, 61]], armR: [[50, 48], [60, 49], [68, 43]],
    legL: [[50, 67], [44, 78], [42, 88]], legR: [[50, 67], [56, 78], [59, 88]],
    prop: 'cursor', propAnchor: [68, 43],
  },
  10: { // Connected Age — phone-facing
    head: [50, 31], torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [40, 55], [37, 62]], armR: [[50, 48], [61, 51], [64, 43]],
    legL: [[50, 67], [44, 78], [42, 88]], legR: [[50, 67], [56, 78], [59, 88]],
    prop: 'phone', propAnchor: [64, 43],
  },
  11: { // Singularity — distributed carrier
    head: [50, 32], hollowHead: true, segmentedTorso: true, torso: [[50, 43], [50, 67]],
    armL: [[50, 48], [40, 54], [36, 58]], armR: [[50, 48], [61, 50], [67, 44]],
    legL: [[50, 67], [44, 78], [42, 88]], legR: [[50, 67], [56, 78], [59, 88]],
    prop: 'starmarker', propAnchor: [67, 44], echoes: true, copyNodes: true,
  },
};

const DEFAULT_POSE = { head: [50, 32], torso: [[50, 43], [50, 67]] };

// Draw the carrier for `eraNum` at time t (seconds) with breathing ±1 unit.
// opts: { reducedMotion, copies, drift }
export function drawFigure(ctx, eraNum, t = 0, opts = {}) {
  const pose = { ...DEFAULT_POSE, ...(POSES[eraNum] || {}) };
  const ink = ERA_INK[eraNum - 1] || '#E9D9B8';
  const accent = ERA_ACCENT[eraNum - 1] || '#FF7A32';
  const breath = opts.reducedMotion ? 0 : Math.sin((t / 3.2) * Math.PI * 2) * 0.5; // ±1 unit over 3.2s

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.2;

  const shift = (pts) => pts.map(([x, y], i) => [x, y + breath * (i === 0 ? 1 : 0.4)]);

  // echo strokes for era 11 (copy-drift silhouette)
  const passes = [];
  if (pose.echoes) {
    const n = Math.min(2, Math.max(0, (opts.copies || 1) - 1));
    for (let i = n; i > 0; i--) passes.push({ dx: i * 1.6, alpha: 0.22 });
  }
  passes.push({ dx: 0, alpha: 1 });

  for (const pass of passes) {
    ctx.save();
    ctx.translate(pass.dx, 0);
    ctx.globalAlpha = pass.alpha;

    // cloak behind body (era 4)
    if (pose.cloak) {
      ctx.beginPath();
      ctx.moveTo(43, 40 + breath); ctx.lineTo(37, 63); ctx.lineTo(50, 72); ctx.lineTo(63, 63); ctx.lineTo(57, 40 + breath);
      ctx.stroke();
    }

    // torso
    ctx.beginPath();
    if (pose.segmentedTorso) {
      const [[x1, y1], [x2, y2]] = pose.torso;
      for (let s = 0; s < 3; s++) {
        const a = y1 + ((y2 - y1) * s) / 3, b = y1 + ((y2 - y1) * (s + 0.72)) / 3;
        ctx.moveTo(x1, a + breath); ctx.lineTo(x2, b + breath * 0.6);
      }
    } else {
      ctx.moveTo(pose.torso[0][0], pose.torso[0][1] + breath);
      ctx.lineTo(pose.torso[1][0], pose.torso[1][1]);
    }
    ctx.stroke();

    // limbs
    for (const limb of [pose.armL, pose.armR, pose.legL, pose.legR]) {
      if (!limb) continue;
      const p = shift(limb);
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.stroke();
    }

    // head
    const [hx, hy] = [pose.head[0], pose.head[1] + breath];
    ctx.lineWidth = 2.0;
    ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    if (pose.hollowHead) { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.stroke(); }
    else { ctx.fillStyle = ink; ctx.globalAlpha = pass.alpha * 0.15; ctx.fill(); ctx.globalAlpha = pass.alpha; ctx.stroke(); }
    ctx.lineWidth = 2.2;

    // gear badge (era 6)
    if (pose.gearBadge) {
      ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.arc(pose.gearBadge[0], pose.gearBadge[1] + breath, 1.8, 0, 7); ctx.stroke();
      ctx.strokeStyle = ink;
    }
    ctx.restore();
  }

  // props attach to the primary (last) pass only
  const [ax, ay] = pose.propAnchor || [66, 61];
  ctx.globalAlpha = 1;
  drawProp(ctx, pose.prop, ax, ay + breath * 0.5, accent, t, pose);

  // orbiting copy-nodes (era 11)
  if (pose.copyNodes) {
    const n = Math.max(3, Math.min(5, opts.copies || 3));
    ctx.strokeStyle = accent; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.8;
    for (let i = 0; i < n; i++) {
      const a = (t * 0.6 + (i * Math.PI * 2) / n);
      const ox = 50 + Math.cos(a) * 12, oy = 53 + Math.sin(a) * 5;
      ctx.beginPath(); ctx.arc(ox, oy, 1.2, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawProp(ctx, kind, x, y, accent, t, pose) {
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 1.6;
  switch (kind) {
    case 'fire': { // tapered flame above hand
      const f = 1 + 0.25 * Math.sin(t * 6);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x - 1.6, y - 3.5 * f); ctx.lineTo(x, y - 6.5 * f); ctx.lineTo(x + 1.6, y - 3.5 * f);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'grain': { // 4 curved stalks
      for (let i = -1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + i * 1.6, y - 5, x + i * 2.2, y - 8);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x + i * 2.2, y - 8.6, 0.8, 0, 7); ctx.fill();
      }
      break;
    }
    case 'spear_shield': {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 16); ctx.stroke(); // spear toward (29,34)
      ctx.beginPath(); ctx.moveTo(x - 5, y - 16); ctx.lineTo(x - 3.6, y - 13); ctx.moveTo(x - 5, y - 16); ctx.lineTo(x - 6.2, y - 13); ctx.stroke();
      if (pose.shieldAt) { ctx.beginPath(); ctx.arc(pose.shieldAt[0], pose.shieldAt[1], 7, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(pose.shieldAt[0], pose.shieldAt[1], 2, 0, 7); ctx.fill(); }
      break;
    }
    case 'book': {
      ctx.strokeRect(x - 4, y - 5, 8, 10);
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
      break;
    }
    case 'openbook': {
      ctx.beginPath();
      ctx.moveTo(x - 6, y); ctx.quadraticCurveTo(x - 3, y - 2.5, x, y);
      ctx.quadraticCurveTo(x + 3, y - 2.5, x + 6, y);
      ctx.lineTo(x, y + 2); ctx.closePath(); ctx.stroke();
      if (pose.quillFrom) {
        const [qx, qy] = pose.quillFrom;
        ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx - 3, qy - 9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(qx - 3, qy - 9); ctx.lineTo(qx - 4.6, qy - 6.5); ctx.lineTo(qx - 1.8, qy - 7); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'wrench': {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 4, y - 4); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 5, y - 5, 2, 0.6, 5.2); ctx.stroke();
      break;
    }
    case 'briefcase': {
      ctx.strokeRect(x - 4.5, y, 9, 7);
      ctx.beginPath(); ctx.moveTo(x - 1.5, y); ctx.lineTo(x - 1.5, y - 1.6); ctx.lineTo(x + 1.5, y - 1.6); ctx.lineTo(x + 1.5, y); ctx.stroke();
      break;
    }
    case 'geiger': {
      ctx.strokeRect(x - 3, y - 2.5, 6, 5);
      ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 1.8 + Math.sin(t * 3), y - 1.6); ctx.stroke();
      break;
    }
    case 'cursor': {
      const fy = y - 3 - Math.sin(t * 2) * 1; // floating
      ctx.strokeRect(x - 1.4, fy - 1.4, 2.8, 2.8);
      break;
    }
    case 'phone': {
      roundRect(ctx, x - 2.5, y - 4.5, 5, 9, 1.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 3.5, y - 5.5, 0.7, 0, 7); ctx.fill(); // notification dot
      break;
    }
    case 'starmarker': {
      star(ctx, x, y, 2.6, 1.1, 4); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function star(ctx, cx, cy, rOuter, rInner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rInner : rOuter;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
