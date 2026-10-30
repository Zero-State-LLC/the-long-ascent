// tools/gen-spawn-tables-v7.mjs — generate research/spawn-tables-v7.json.
// Per-era entity spawn tables (SPEC v7 §2): hazards, pickups, terrain props with
// x positions as FRACTIONS of the era segment (0..1), so world placement stays
// resolution-independent and deterministic. Tables are hand-authored per era band
// (eras 1-5 primal, 6-11 industrial, 12-17 near-future) with a seeded jitter of
// the fraction order; the seed is recorded so regeneration is reproducible.
//
// Run: node tools/gen-spawn-tables-v7.mjs
import { writeFileSync } from 'node:fs';

// mulberry32 (same lineage as src/core/crossing.js)
function mulberry32(seedStr) {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) a = (Math.imul(a, 31) + seedStr.charCodeAt(i)) | 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 'long-ascent:v7-spawn';

// --- per-era templates -------------------------------------------------------
// Each list item: { type, f? } — f = fixed fraction (else jittered spread).
// Counts scale lightly with era index (later eras = denser world).
const HAZARDS = {
  // chasers (SPEC §2: boar/wolf/stray_dog eras 1-9, chase within 3 tiles)
  1: ['boar'], 2: ['boar', 'wolf'], 3: ['wolf', 'boar'], 4: ['wolf'],
  5: ['stray_dog', 'wolf'], 6: ['stray_dog', 'bandit'], 7: ['bandit', 'stray_dog'],
  8: ['bandit', 'soldier_patrol'], 9: ['soldier_patrol', 'wolf'],
  10: ['soldier_patrol', 'stray_dog'], 11: ['soldier_patrol', 'radiation_zone'],
  12: ['smog', 'soldier_patrol'], 13: ['datastorm'], 14: ['datastorm', 'smog'],
  15: ['datastorm'], 16: ['radiation_zone'], 17: ['datastorm', 'radiation_zone'],
};
const PICKUPS = {
  1: ['berry', 'meat', 'stone', 'torch', 'torch'],
  2: ['grain', 'grain', 'stone', 'torch'],
  3: ['grain', 'coin', 'scroll', 'spear', 'stone'],
  4: ['coin', 'coin', 'book', 'spear'],
  5: ['coin', 'scroll', 'book', 'spear', 'torch'],
  6: ['coin', 'invoice', 'book', 'spear'],
  7: ['meat', 'invoice', 'coin', 'scroll'],
  8: ['coin', 'invoice', 'book', 'meat'],
  9: ['credit', 'invoice', 'coin', 'scroll'],
  10: ['meat', 'credit', 'scroll', 'coin'],
  11: ['chip', 'credit', 'meat', 'book'],
  12: ['credit', 'chip', 'grain', 'book'],
  13: ['chip', 'credit', 'book'],
  14: ['credit', 'chip', 'grain', 'coin'],
  15: ['chip', 'credit', 'book'],
  16: ['grain', 'chip', 'credit'],
  17: ['credit', 'chip', 'book'],
};
const TERRAIN = {
  1: ['fruit_tree', 'berry_bush', 'crawl_gap', 'dark_cave', 'ledgevine'],
  2: ['grain_stalk', 'berry_bush', 'crawl_gap', 'ledgevine', 'anchor'],
  3: ['grain_stalk', 'fruit_tree', 'crawl_gap', 'rubble_ramp', 'dark_cave', 'anchor'],
  4: ['fruit_tree', 'rubble_ramp', 'crawl_gap', 'anchor'],
  5: ['grain_stalk', 'berry_bush', 'rubble_ramp', 'ledgevine', 'anchor'],
  6: ['grain_stalk', 'fruit_tree', 'rubble_ramp', 'anchor'],
  7: ['berry_bush', 'rubble_ramp', 'ledgevine'],
  8: ['grain_stalk', 'rubble_ramp', 'crawl_gap'],
  9: ['fruit_tree', 'rubble_ramp', 'anchor'],
  10: ['berry_bush', 'rubble_ramp', 'ledgevine'],
  11: ['grain_stalk', 'rubble_ramp', 'crawl_gap', 'anchor'],
  12: ['berry_bush', 'ledgevine', 'rubble_ramp'],
  13: ['grain_stalk', 'ledgevine', 'anchor'],
  14: ['fruit_tree', 'rubble_ramp', 'crawl_gap'],
  15: ['berry_bush', 'ledgevine'],
  16: ['grain_stalk', 'rubble_ramp', 'anchor'],
  17: ['fruit_tree', 'ledgevine', 'rubble_ramp'],
};
// stone piles: "infinite piles near rubble" (SPEC §2) — every era gets one.
// counter-items for zone hazards (SPEC §2 mask/chip/scarf) ride in pickups via
// era-appropriate stand-ins already present (chip covers rad-suit/faraday).

const rng = mulberry32(SEED);
const out = { seed: SEED, note: 'fractions of the era segment (0..1); Forge places at segStart + f*SEG_W', eras: {} };

for (let era = 1; era <= 17; era++) {
  const spread = (list, lo, hi) => {
    const step = (hi - lo) / (list.length + 1);
    return list.map((type, i) => ({
      type,
      f: Math.round((lo + step * (i + 1) + (rng() - 0.5) * step * 0.5) * 1000) / 1000,
    }));
  };
  out.eras[era] = {
    hazards: spread(HAZARDS[era], 0.12, 0.9),
    pickups: spread(PICKUPS[era], 0.08, 0.94),
    terrain: spread(TERRAIN[era], 0.1, 0.92),
    stones: [{ type: 'stone_pile', f: Math.round((0.5 + (rng() - 0.5) * 0.3) * 1000) / 1000 }],
  };
}

writeFileSync(new URL('../research/spawn-tables-v7.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
const counts = Object.values(out.eras).reduce((a, e) => a + e.hazards.length + e.pickups.length + e.terrain.length + e.stones.length, 0);
console.log(`wrote research/spawn-tables-v7.json — ${counts} entities across 17 eras`);
