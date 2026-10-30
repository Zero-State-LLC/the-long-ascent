// src/engine/world.js — SPEC v6 §2/§5: the continuous 17-segment world.
// Pure module (no DOM): builds one long side-scrolling timeline from eras.json
// plus the Scribe v6 content files, exposes a tile collider for player.js, and
// answers era lookup / boundary placement / parallax layer queries for the
// renderer. Deterministic on `seed` — same seed, same terrain.

import { TILE, VIEW_W } from './feel.js';
import { mulberry32 } from '../core/crossing.js'; // seeded PRNG lineage (same as Starfield/palettes)

export const SEG_SCREENS = 3;                    // ~3 screens per era (SPEC §2)
export const SEG_W = VIEW_W * SEG_SCREENS;       // 2880 px per segment
export const WORLD_COLS = 17 * (SEG_W / TILE);   // 1530 cols total
export const WORLD_ROWS = Math.ceil(540 / TILE) + 4; // headroom above the viewport
export const WORLD_W = WORLD_COLS * TILE;        // 48960 px
export const WORLD_H = WORLD_ROWS * TILE;

// Floor band rows: surface sits at row FLOOR_ROW (top of solid ground below).
export const FLOOR_ROW = 13; // feet baseline y = 13*32 = 416 in era-flat terms

// Era boundary structures at the seams (SPEC §1: "a cave mouth, a stone gate,
// a launch gantry — not menus"). Keyed by the seam BEFORE era N (i.e. entering N).
export const BOUNDARY_STRUCTURE = {
  2: 'cave_mouth',     // leaving the cave proper
  3: 'stone_gate',     // walled fields, first borders
  4: 'stone_gate',
  5: 'stone_gate',
  6: 'market_stall',   // print-era trade town
  7: 'factory_gate',
  8: 'factory_gate',
  9: 'factory_gate',
  10: 'monument',      // war memorial at the seam
  11: 'machine_wreck', // atomic anxiety
  12: 'launch_gantry', // the Space Age begins under a gantry
  13: 'antenna',
  14: 'beacon',
  15: 'antenna',       // the Connected Age hums
  16: 'beacon',        // the Long Silence: one beacon left on
  17: 'launch_gantry', // departure gantry for the last crossing
};

// Encounter type -> prop art (assets/prop_<type>.png), mapped onto Studio's 24 props.
const PROP_BY_TYPE = {
  sign: 'sign', npc: 'npc_elder', ruin: 'ruin_column', monument: 'monument',
  shrine: 'shrine', terminal: 'terminal', machine: 'machine_wreck',
};
// A few npc flavors for variety across arcs.
const NPC_FLAVORS = ['npc_elder', 'npc_merchant', 'npc_scientist', 'npc_child'];

/**
 * Build the world.
 * @param {object} data { erasData, encounters, stones, arcs }
 *   encounters: research/encounters-v6.json payload; stones: boundary-stones-v6.json;
 *   arcs: arc-encounters-v6.json. Missing pieces degrade to an empty list.
 * @param {number|string} seed deterministic terrain variation.
 */
export function createWorld({ erasData, encounters = [], stones = [], arcs = [] } = {}, seed = 'long-ascent') {
  const rng = mulberry32(`${seed}:terrain`);
  const grid = buildTerrain(rng);
  const objects = placeObjects({ encounters, stones, arcs }, mulberry32(`${seed}:places`));

  const segStart = (eraNum) => (eraNum - 1) * SEG_W;              // era 1..17
  const eraAtX = (x) => Math.min(17, Math.max(1, Math.floor(x / SEG_W) + 1));

  // ------------------------------------------------------------- collider API
  const collider = {
    /** Point query in world px (collision boxes sample just inside edges). */
    solidAt(px, py) {
      const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
      if (r < 0 || r >= WORLD_ROWS) return false;
      if (c < 0) return true;          // left wall: the run starts inside time
      if (c >= WORLD_COLS) return true; // right wall: the finale is a dead end
      return grid[r][c] === 1;
    },
    /** Nearest floor surface within maxDist below feetY, spanning box width. */
    snapDown(bx, feetY, maxDist) {
      const depth = Math.ceil(maxDist / TILE) + 1;
      const r0 = Math.floor(feetY / TILE);
      for (let d = 1; d <= depth; d++) {
        const r = r0 + d;
        if (r >= WORLD_ROWS) break;
        let hit = false;
        for (let c = Math.floor(bx / TILE); c <= Math.floor((bx + PLAYER_SPAN - 0.01) / TILE); c++) {
          if (grid[r]?.[c] === 1) { hit = true; break; }
        }
        if (hit) return r * TILE;
      }
      return null;
    },
    /** Free x-offset ≤ maxPx in direction dir at the current box position. */
    nudgeX(bx, by, dir, maxPx) {
      for (let d = TILE / 2; d <= maxPx; d += 2) {
        const nx = bx + dir * d;
        if (!boxFree(nx, by)) return nx - dir * 2 >= 0 ? Math.round((nx - dir) * 10) / 10 : null;
      }
      return null;
    },
    /** Tile-boundary surface directly under feetY (flush landing). */
    floorJustBelow(bx, feetY) {
      const r = Math.floor((feetY + 0.5) / TILE);
      for (let c = Math.floor(bx / TILE); c <= Math.floor((bx + PLAYER_SPAN - 0.01) / TILE); c++) {
        if (grid[r]?.[c] === 1) return r * TILE;
      }
      return null;
    },
    /** Tile-boundary ceiling just above box top (flush bonk). */
    ceilJustAbove(bx, topY) {
      const r = Math.floor((topY - 0.5) / TILE);
      for (let c = Math.floor(bx / TILE); c <= Math.floor((bx + PLAYER_SPAN - 0.01) / TILE); c++) {
        if (grid[r]?.[c] === 1) return (r + 1) * TILE;
      }
      return null;
    },
  };
  const PLAYER_SPAN = 24; // matches PLAYER_W (feel contract); duplicated to avoid import cycle noise
  function boxFree(bx, by) {
    const l = bx + 0.5, r = bx + PLAYER_SPAN - 0.5, t = by + 0.5, b = by + 56 - 0.5;
    for (const yy of [t, (t + b) / 2, b]) {
      if (collider.solidAt(l, yy) || collider.solidAt(r, yy)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- spawn point
  const spawn = { x: segStart(1) + 120, y: FLOOR_ROW * TILE - 56 };

  return {
    grid,
    objects,
    collider,
    spawn,
    segStart,
    eraAtX,
    worldW: WORLD_W,
    worldH: WORLD_H,
    /** Boundary structure object for the seam entering era N (2..17), or null. */
    boundaryFor(eraNum) {
      return objects.find((o) => o.kind === 'boundary' && o.enterEra === eraNum) || null;
    },
    /** Parallax layer urls for an era (renderer loads + tiles them). */
    layersFor(eraNum) {
      const n = String(Math.min(17, Math.max(1, eraNum))).padStart(2, '0');
      return {
        sky: `assets/bg${n}_sky.png`,
        far: `assets/bg${n}_far.png`,
        near: `assets/bg${n}_near.png`,
        ground: `assets/bg${n}_ground.png`,
      };
    },
  };
}

// ------------------------------------------------------------------- terrain
// One contiguous height column per tile col: gentle rolling ground with pits
// ≤4.5 tiles wide (feel §1 derived check: gaps must stay jumpable), platforms
// that never block forward progress, and a flat landing pad at every seam so
// the boundary set piece always reads clean.
function buildTerrain(rng) {
  const grid = Array.from({ length: WORLD_ROWS }, () => new Array(WORLD_COLS).fill(0));
  const fillBelow = (c, topRow) => { for (let r = topRow; r < WORLD_ROWS; r++) grid[r][c] = 1; };

  let h = FLOOR_ROW;
  for (let c = 0; c < WORLD_COLS; c++) {
    const inSeg = c % (SEG_W / TILE);
    const seamPad = 14; // cols kept flat around each seam (both sides)
    const nearSeam = inSeg < seamPad || inSeg > SEG_W / TILE - seamPad;

    if (!nearSeam) {
      // random-walk height, bounded ±2 tiles from nominal floor
      const roll = rng();
      if (roll < 0.22) h -= 1;
      else if (roll < 0.44) h += 1;
      h = Math.max(FLOOR_ROW - 2, Math.min(FLOOR_ROW + 2, h));
    } else {
      h += Math.sign(FLOOR_ROW - h); // ease back to nominal toward the seam
    }

    // Pit: occasionally drop a gap of 2–4 tiles mid-segment (never near seams).
    const pitHere = !nearSeam && rng() < 0.012;
    if (pitHere) {
      const width = 2 + Math.floor(rng() * 3); // 2..4 tiles ≤ 4.5 budget
      for (let w = 0; w < width && c + w < WORLD_COLS; w++) {
        for (let r = 0; r < WORLD_ROWS; r++) grid[r][c + w] = 0;
      }
      c += width - 1;
      continue;
    }

    fillBelow(c, h);

    // Floating platform above ground sometimes (mantle-reachable: ≤3 tiles up).
    if (!nearSeam && rng() < 0.03) {
      const pr = Math.max(2, h - 3);
      const plen = 3 + Math.floor(rng() * 4);
      for (let w = 0; w < plen && c + w < WORLD_COLS; w++) grid[pr][c + w] = 1;
    }
  }
  // Guarantee the opening runway is flat (first screen teaches walking).
  for (let c = 0; c < 60; c++) {
    for (let r = 0; r < WORLD_ROWS; r++) grid[r][c] = r >= FLOOR_ROW ? 1 : 0;
  }
  return grid;
}

// -------------------------------------------------------------------- objects
// Every interactive thing lives in ONE list with stable ids and spread x
// positions inside its era segment (SPEC §4: encounter objects keep effects
// verbatim; prompts are in-world signage).
function placeObjects({ encounters, stones, arcs }, rng) {
  const objects = [];

  // Boundary stones + structures at each seam (era 1 gets its stone at start).
  const stoneList = Array.isArray(stones) ? stones : (stones.stones || []);
  for (const st of stoneList) {
    objects.push({
      id: `stone-${st.era}`,
      kind: 'stone',
      enterEra: st.era,
      era: st.era,
      type: 'sign',
      prop: 'monolith',
      x: segStartOf(st.era) + (st.era === 1 ? 64 : -160), // era-1 stone opens the run; others sit just before the seam
      inscription: st.inscription,
      prompt: st.inscription,
      choices: [],
    });
  }
  for (let era = 2; era <= 17; era++) {
    const prop = BOUNDARY_STRUCTURE[era] || 'stone_gate';
    objects.push({
      id: `boundary-${era}`,
      kind: 'boundary',
      enterEra: era,
      era,
      type: 'structure',
      prop,
      x: segStartOf(era),           // exactly on the seam line
      prompt: '',
      choices: [],
    });
  }

  // Encounters: spread evenly through their era segment with jitter, sorted by x.
  const encList = Array.isArray(encounters) ? encounters : (encounters.encounters || []);
  const byEra = new Map();
  for (const e of encList) {
    if (!byEra.has(e.era)) byEra.set(e.era, []);
    byEra.get(e.era).push(e);
  }
  for (const [era, list] of byEra) {
    const start = segStartOf(era);
    // Keep clear of the seam pads (±14 tiles) so objects never hang over pits/gates.
    const usable = SEG_W - 2 * 14 * TILE;
    const step = usable / (list.length + 1);
    list.forEach((e, i) => {
      const jitter = (rng() - 0.5) * step * 0.4;
      objects.push({
        id: e.id,
        kind: 'encounter',
        era: e.era,
        type: e.type,
        title: e.title,
        prop: PROP_BY_TYPE[e.type] || 'sign',
        x: Math.round(start + 14 * TILE + step * (i + 1) + jitter),
        prompt: e.prompt,
        choices: e.choices || [],
      });
    });
  }

  // Arc NPCs at position_hint: parse ordinal words to a spot in the era stretch.
  const arcList = Array.isArray(arcs) ? arcs : (arcs.arcs || []);
  const arcSeenPerEra = new Map();
  for (const a of arcList) {
    const frac = hintFraction(a.position_hint, arcSeenPerEra.get(a.era) || 0);
    arcSeenPerEra.set(a.era, (arcSeenPerEra.get(a.era) || 0) + 1);
    const flavor = NPC_FLAVORS[Math.abs(hashStr(a.arc)) % NPC_FLAVORS.length];
    objects.push({
      id: `arc-${a.arc}-${a.era}-${arcSeenPerEra.get(a.era)}`,
      kind: 'arc',
      arc: a.arc,
      era: a.era,
      type: 'npc',
      title: a.npc,
      prop: flavor,
      x: Math.round(segStartOf(a.era) + 14 * TILE + frac * (SEG_W - 2 * 14 * TILE)),
      prompt: a.prompt,
      choices: a.choices || [],
      sourceEvent: (a.choices && a.choices[0] && a.choices[0].source_event) || null,
    });
  }

  objects.sort((a, b) => a.x - b.x);
  return objects;
}

function segStartOf(era) { return (era - 1) * SEG_W; }

// "early era-4 stretch" → 0.2; "midpoint" → 0.5; "late" → 0.8; fallback spreads.
function hintFraction(hint = '', alt = 0) {
  const h = hint.toLowerCase();
  if (/early|first|beginning|opening/.test(h)) return 0.18;
  if (/mid|middle|center/.test(h)) return 0.5;
  if (/late|end|final|last|closing/.test(h)) return 0.82;
  return 0.3 + ((alt * 0.37) % 0.4);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
