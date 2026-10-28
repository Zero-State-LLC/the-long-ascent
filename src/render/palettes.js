// src/render/palettes.js — era palettes + background motifs per research/visual-assets.md §2.
// Pure canvas: no DOM imports beyond the 2D context passed in.

export const ERA_PALETTES = [
  { bg: '#211A18', surface: '#302522', line: '#6A4130', glow: '#FF7A32', grain: '#A8B86A', vignette: 0.55 },
  { bg: '#D8C58B', surface: '#E7D8A5', line: '#79583C', field: '#71884D', grain: '#D49B3B', vignette: 0.12 },
  { bg: '#B87955', surface: '#D59B6D', line: '#70483F', bronze: '#D5A64B', marble: '#E8DCC4', vignette: 0.18 },
  { bg: '#283344', surface: '#354257', line: '#6C7788', candle: '#E5B95E', parchment: '#D0C8B7', vignette: 0.42 },
  { bg: '#E6D7B7', surface: '#F3E8D0', line: '#B8A98D', print: '#8B3F3B', discovery: '#477C78', vignette: 0.08 },
  { bg: '#4A4B4B', surface: '#383B3D', line: '#899397', coal: '#25292B', steam: '#C6C4B9', warning: '#D18A42', vignette: 0.24 },
  { bg: '#32617A', surface: '#244C62', line: '#7693A0', cream: '#F1E5CF', red: '#C84D46', oil: '#34383B', vignette: 0.12 },
  { bg: '#202A32', surface: '#303D43', line: '#647078', phosphor: '#A8D879', alert: '#E65B4B', paper: '#DCE5D5', vignette: 0.34 },
  { bg: '#111D2B', surface: '#1A2A3B', line: '#4766A8', compute: '#54D6C8', signal: '#F3C969', vignette: 0.16 },
  { bg: '#29283F', surface: '#383653', line: '#77739A', attention: '#E779B7', social: '#7D77DC', signal: '#F4C95D', vignette: 0.20 },
  { bg: '#090F1C', surface: '#141D31', line: '#394969', selfhood: '#B79CFF', compute: '#62E8D0', stars: '#F5D58A', vignette: 0.28 },
];

// ink = primary figure stroke per era (visual-assets §1 palette column)
export const ERA_INK = ['#E9D9B8', '#3F4A32', '#382D32', '#D0C8B7', '#3D3A37', '#E0D2B8', '#F1E5CF', '#DCE5D5', '#BFE8E5', '#EEE8FF', '#DAE8FF'];
export const ERA_ACCENT = ['#FF7A32', '#D49B3B', '#D5A64B', '#E5B95E', '#8B3F3B', '#D18A42', '#C84D46', '#A8D879', '#54D6C8', '#E779B7', '#B79CFF'];

// deterministic pseudo-random for texture placement
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw the era background into a ctx whose transform already maps the
// 0..100 normalized space onto the canvas. entropy 0..100 drives pollution overlay (era 6+).
export function drawBackground(ctx, eraNum, entropy = 0, timeSec = 0) {
  const p = ERA_PALETTES[eraNum - 1] || ERA_PALETTES[0];
  ctx.save();
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, 100, 100);
  const rnd = prng(eraNum * 977);

  switch (eraNum) {
    case 1: { // cave: ember radial + noise dots + wall arcs
      const g = ctx.createRadialGradient(50, 62, 4, 50, 62, 60);
      g.addColorStop(0, '#58301F'); g.addColorStop(1, '#171313');
      ctx.globalAlpha = 0.8; ctx.fillStyle = g; ctx.fillRect(0, 0, 100, 100); ctx.globalAlpha = 1;
      ctx.fillStyle = p.grain;
      for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.10 + rnd() * 0.05; ctx.fillRect(rnd() * 100, rnd() * 100, 0.6, 0.6); }
      ctx.globalAlpha = 0.10; ctx.strokeStyle = p.line; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(rnd() * 100, rnd() * 40, 20 + rnd() * 25, 0.2, Math.PI - 0.2); ctx.stroke(); }
      break;
    }
    case 2: { // agriculture: furrows + seeds
      for (let y = 70; y < 100; y += 8) {
        ctx.globalAlpha = (y / 8) % 2 ? 0.08 : 0.14; ctx.strokeStyle = p.field; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(100, y); ctx.stroke();
      }
      ctx.fillStyle = p.grain;
      for (let i = 0; i < 24; i++) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(rnd() * 100, 68 + rnd() * 30, 0.5, 0, 7); ctx.fill(); }
      break;
    }
    case 3: { // empires: column silhouettes + stone seams
      ctx.globalAlpha = 0.12; ctx.fillStyle = p.marble;
      for (const x of [12, 30, 70, 88]) { ctx.fillRect(x - 3, 18, 6, 55); ctx.fillRect(x - 4.5, 15, 9, 3); }
      ctx.strokeStyle = p.line; ctx.lineWidth = 0.5;
      for (let y = 25; y < 95; y += 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(100, y); ctx.stroke(); }
      break;
    }
    case 4: { // dark ages: deep gradient + candle pool + margin lines
      const g = ctx.createLinearGradient(0, 0, 0, 100);
      g.addColorStop(0, '#1C2534'); g.addColorStop(1, p.bg);
      ctx.fillStyle = g; ctx.fillRect(0, 0, 100, 100);
      const c = ctx.createRadialGradient(24, 55, 1, 24, 55, 22);
      c.addColorStop(0, 'rgba(229,185,94,0.28)'); c.addColorStop(1, 'rgba(229,185,94,0)');
      ctx.fillStyle = c; ctx.fillRect(0, 0, 100, 100);
      ctx.globalAlpha = 0.14; ctx.strokeStyle = p.parchment; ctx.lineWidth = 0.4;
      for (let y = 12; y < 90; y += 9) { ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(20, y); ctx.stroke(); }
      break;
    }
    case 5: { // renaissance: crosshatch + engraved border + type squares
      ctx.globalAlpha = 0.06; ctx.strokeStyle = p.line; ctx.lineWidth = 0.4;
      for (let i = -100; i < 100; i += 6) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 100, 100); ctx.stroke(); }
      ctx.globalAlpha = 0.35; ctx.strokeRect(3, 3, 94, 94);
      ctx.fillStyle = p.print;
      for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.10; ctx.fillRect(rnd() * 90 + 4, rnd() * 20 + 4, 2.4, 2.4); }
      break;
    }
    case 6: { // steam: rivets, gear arcs, soot streaks
      ctx.fillStyle = p.line;
      for (let x = 6; x < 100; x += 12) for (let y = 6; y < 100; y += 12) { ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.arc(x, y, 0.6, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 0.12; ctx.strokeStyle = p.steam; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(85, 20, 12, 0, 5.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(85, 20, 7, 0.4, 5); ctx.stroke();
      ctx.fillStyle = p.coal;
      for (let i = 0; i < 5; i++) { ctx.globalAlpha = 0.08; ctx.fillRect(rnd() * 100, 0, 1.4, 100); }
      break;
    }
    case 7: { // american century: sunburst + horizon bands + halftone
      ctx.save(); ctx.translate(50, 30); ctx.globalAlpha = 0.10; ctx.fillStyle = p.cream;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 70, Math.sin(a) * 70); ctx.lineTo(Math.cos(a + 0.2) * 70, Math.sin(a + 0.2) * 70);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 0.35; ctx.fillStyle = p.surface; ctx.fillRect(0, 78, 100, 22);
      ctx.globalAlpha = 0.2; ctx.fillStyle = p.red; ctx.fillRect(0, 76, 100, 1.2);
      break;
    }
    case 8: { // atomic: clock ticks + scanlines
      ctx.strokeStyle = p.phosphor; ctx.globalAlpha = 0.18; ctx.lineWidth = 0.6;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        ctx.beginPath();
        ctx.moveTo(50 + Math.cos(a) * 44, 50 + Math.sin(a) * 44);
        ctx.lineTo(50 + Math.cos(a) * 47, 50 + Math.sin(a) * 47);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.05; ctx.fillStyle = p.paper;
      for (let y = 0; y < 100; y += 4) ctx.fillRect(0, y, 100, 0.6);
      break;
    }
    case 9: { // digital: pixel grid + circuit paths + phosphor blocks
      ctx.strokeStyle = p.line; ctx.globalAlpha = 0.18; ctx.lineWidth = 0.4;
      for (let x = 10; x < 100; x += 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 100); ctx.stroke(); }
      for (let y = 10; y < 100; y += 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(100, y); ctx.stroke(); }
      ctx.globalAlpha = 0.35; ctx.strokeStyle = p.compute; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(10, 80); ctx.lineTo(30, 80); ctx.lineTo(36, 74); ctx.lineTo(60, 74); ctx.stroke();
      ctx.fillStyle = p.signal;
      for (let i = 0; i < 5; i++) { ctx.globalAlpha = 0.25; ctx.fillRect(10 * (1 + Math.floor(rnd() * 8)), 10 * (1 + Math.floor(rnd() * 8)), 2, 2); }
      break;
    }
    case 10: { // connected: nodes + links + feed cards
      const nodes = [];
      for (let i = 0; i < 9; i++) nodes.push([rnd() * 100, rnd() * 60]);
      ctx.strokeStyle = p.social; ctx.globalAlpha = 0.2; ctx.lineWidth = 0.5;
      for (let i = 0; i < nodes.length - 1; i++) { ctx.beginPath(); ctx.moveTo(...nodes[i]); ctx.lineTo(...nodes[i + 1]); ctx.stroke(); }
      ctx.fillStyle = p.attention;
      for (const [x, y] of nodes) { ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(x, y, 1.1, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 0.12; ctx.fillStyle = p.surface;
      for (let i = 0; i < 3; i++) roundRect(ctx, 62, 8 + i * 10, 32, 7, 2), ctx.fill();
      break;
    }
    case 11: { // singularity: seeded starfield + orbital arcs
      ctx.fillStyle = p.stars;
      for (let i = 0; i < 60; i++) {
        ctx.globalAlpha = 0.2 + rnd() * 0.6;
        const tw = 0.5 + 0.5 * Math.sin(timeSec * 0.8 + i);
        ctx.beginPath(); ctx.arc(rnd() * 100, rnd() * 100, 0.35 + tw * 0.25, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 0.25; ctx.strokeStyle = p.selfhood; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.ellipse(50, 53, 30, 10, 0.3, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(50, 53, 22, 16, -0.5, 0, 7); ctx.stroke();
      break;
    }
  }

  // entropy pollution overlay (visible from era 6 on, capped alpha 0.22)
  if (eraNum >= 6 && entropy > 0) {
    ctx.globalAlpha = Math.min(entropy / 100, 1) * 0.22;
    ctx.fillStyle = eraNum === 8 ? p.alert : p.coal || '#25292B';
    ctx.fillRect(0, 0, 100, 100);
  }

  // vignette
  const v = ctx.createRadialGradient(50, 50, 30, 50, 50, 78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${p.vignette})`);
  ctx.globalAlpha = 1; ctx.fillStyle = v; ctx.fillRect(0, 0, 100, 100);
  ctx.restore();
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
