// src/core/crossing.js — SPEC §11: The Crossing mini-game, pure logic.
//
// Zero DOM, zero timers: a fixed-timestep state machine the renderer feeds
// input into and reads positions from. Deterministic on (seed) so tests can
// replay spawns exactly.

/** mulberry32 seeded by string — same texture-prng lineage as palettes.js. */
export function mulberry32(strSeed) {
  let h = 2166136261 >>> 0;
  const s = String(strSeed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CROSSING = {
  TICK_MS: 1000 / 60,          // fixed timestep
  WIDTH: 960, HEIGHT: 540,     // logical playfield
  SHIP_X: 140,                 // ship stays at a fixed x; the field scrolls
  SHIP_W: 28, SHIP_H: 18,
  SCROLL_BASE: 300,            // px/s at entropy 0
  LANE_Y: [90, 180, 270, 360, 450],
  GATE_SPACING: 620,           // px between gate pairs
  GATE_GAP_MIN: 150,           // gap height at entropy 0 (shrinks with entropy)
  GATE_GAP_PER_ENTROPY: 0.6,   // gap loses this many px per point of entropy
  COLLIDE_FORGIVE: 4,          // AABB forgiveness in px (§11.2)
  NEAR_MISS_PX: 18,            // within this of the gate edge = near miss
  HULL_MAX: 3,
  HIT_HULL: -1,                // hull per collision
  HIT_ENTROPY: 4,              // entropy per collision
  GATE_ENTROPY: -1,            // threading a gate pays a little entropy back
  NEAR_MISS_SCORE: 25,
  GATE_SCORE: 100,
  DIST_SCORE: 0.1,             // score per px travelled
  DURATION_S: 45,              // reach the far end => arrival
  LOSE_SUSTENANCE_FRAC: 0.10,  // lose = -10% sustenance, NOT death (§11.2)
  WIN_FOOD: 8,                 // +8 sustenance
  WIN_KNOWLEDGE: 5,            // +5 knowledge
  WIN_BADGE: 'void_pilot',
};

/** Spawn table for one run: deterministic on seed + entropy at launch. */
export function buildSpawnTable(seed, entropyAtLaunch = 0) {
  const rng = mulberry32(`${seed}:crossing`);
  const ent = Math.max(0, Math.min(100, entropyAtLaunch));
  const gap = Math.max(96, CROSSING.GATE_GAP_MIN - ent * CROSSING.GATE_GAP_PER_ENTROPY);
  const density = 1 + ent / 40; // difficulty scales with entropy (§11.2)
  const spawns = [];
  let x = CROSSING.WIDTH + 200;
  let gates = 0;
  while (x < CROSSING.WIDTH + CROSSING.DURATION_S * CROSSING.SCROLL_BASE * 1.4) {
    if (gates % 3 === 2) {
      // gate pair: two obstacles with a threadable gap
      const gapTop = CROSSING.LANE_Y[1] + Math.floor(rng() * (CROSSING.HEIGHT - CROSSING.LANE_Y[1] * 2 - gap));
      spawns.push({ kind: 'gate_top', x, y: 0, w: 34, h: gapTop, gateId: gates });
      spawns.push({ kind: 'gate_bottom', x, y: gapTop + gap, w: 34, h: CROSSING.HEIGHT - gapTop - gap, gateId: gates });
      gates++;
    } else {
      const kind = rng() < 0.5 ? 'derelict' : 'comet';
      const lane = CROSSING.LANE_Y[Math.floor(rng() * CROSSING.LANE_Y.length)];
      spawns.push({
        kind, x, y: lane - 20, w: kind === 'comet' ? 24 : 40, h: kind === 'comet' ? 24 : 40,
        vy: kind === 'comet' ? Math.round((rng() - 0.5) * 120) : 0,
      });
    }
    x += (CROSSING.GATE_SPACING * (0.7 + rng() * 0.6)) / density;
  }
  return { spawns, gap, seed: `${seed}:crossing`, entropyAtLaunch: ent };
}

/** Create a run. `reducedMotion: true` => skip path (full rewards instantly). */
export function createCrossingRun({ seed, entropy = 0, reducedMotion = false }) {
  if (reducedMotion) return skipCrossing();
  const table = buildSpawnTable(seed, entropy);
  return {
    status: 'playing', // playing | won | lost | skipped
    t: 0, distance: 0, scroll: CROSSING.SCROLL_BASE + entropy * 1.5,
    ship: { x: CROSSING.SHIP_X, y: CROSSING.HEIGHT / 2, vy: 0 },
    hull: CROSSING.HULL_MAX, entropy: 0, score: 0,
    gatesPassed: 0, nearMisses: 0, hits: 0,
    table, entities: table.spawns.map((s) => ({ ...s, hit: false, scored: false, missed: false })),
    events: [], // per-tick event log for the renderer/audio: {type,...}
    reducedMotion: false,
  };
}

/** Skip path (§11.2): reduced-motion users get full rewards without playing. */
export function skipCrossing() {
  return {
    status: 'skipped', t: 0, distance: 0, scroll: 0,
    ship: { x: CROSSING.SHIP_X, y: CROSSING.HEIGHT / 2, vy: 0 },
    hull: CROSSING.HULL_MAX, entropy: 0, score: 0,
    gatesPassed: 0, nearMisses: 0, hits: 0, table: null, entities: [], events: [],
    reducedMotion: true, rewards: { ...CROSSING_WIN_REWARDS() },
  };
}

const CROSSING_WIN_REWARDS = () => ({ food: CROSSING.WIN_FOOD, knowledge: CROSSING.WIN_KNOWLEDGE, badge: CROSSING.WIN_BADGE });

/**
 * Advance one fixed tick. `input` = { up, down } booleans. Pure-ish: returns a
 * NEW run object each tick (cheap enough at 60Hz for a canvas game), so React-
 * style renderers can diff. `events` is fresh per tick.
 */
export function stepCrossing(run, input = {}, dtMs = CROSSING.TICK_MS) {
  if (run.status !== 'playing') return run;
  const dt = dtMs / 1000;
  const next = structuredClone(run);
  next.events = [];
  next.t += dt;

  // ship movement: constant climb rate, clamped to the field
  const SPEED = 260;
  let vy = 0;
  if (input.up) vy -= SPEED;
  if (input.down) vy += SPEED;
  next.ship.vy = vy;
  next.ship.y = Math.max(CROSSING.SHIP_H / 2, Math.min(CROSSING.HEIGHT - CROSSING.SHIP_H / 2, next.ship.y + vy * dt));

  // scroll the field
  const dx = next.scroll * dt;
  next.distance += dx;
  next.score += dx * CROSSING.DIST_SCORE;
  for (const e of next.entities) {
    e.x -= dx;
    if (e.vy) e.y = Math.max(0, Math.min(CROSSING.HEIGHT - e.h, e.y + e.vy * dt));
  }

  const shipBox = { x: next.ship.x - CROSSING.SHIP_W / 2, y: next.ship.y - CROSSING.SHIP_H / 2, w: CROSSING.SHIP_W, h: CROSSING.SHIP_H };

  for (const e of next.entities) {
    if (e.hit || e.scored) continue;
    if (e.kind.startsWith('gate')) {
      // gate halves only resolve once BOTH halves passed the ship line
      const partner = next.entities.find((p) => p.gateId === e.gateId && p !== e);
      if (!partner || partner.x + partner.w > shipBox.x) continue;
      if (e.x + e.w <= shipBox.x) {
        // this half is behind the ship: did the ship fit through?
        const overlappedY = !(shipBox.y + shipBox.h <= e.y || shipBox.y >= e.y + e.h);
        if (overlappedY && !e.hit) {
          e.hit = true;
          registerHit(next, e);
        } else if (!overlappedY) {
          e.scored = true;
          if (partner.scored || partner.x + partner.w <= shipBox.x) {
            next.gatesPassed++;
            next.entropy = Math.max(0, next.entropy + CROSSING.GATE_ENTROPY);
            next.score += CROSSING.GATE_SCORE;
            next.events.push({ type: 'gate', gateId: e.gateId });
          }
        }
      }
      continue;
    }
    // obstacle: AABB with 4px forgiveness (§11.2)
    if (aabb(shipBox, e, CROSSING.COLLIDE_FORGIVE)) {
      e.hit = true;
      registerHit(next, e);
    } else if (e.x + e.w <= shipBox.x && !e.missed) {
      e.missed = true;
      if (nearMiss(shipBox, e)) {
        next.nearMisses++;
        next.score += CROSSING.NEAR_MISS_SCORE;
        next.events.push({ type: 'near_miss' });
      }
    }
  }

  // win: survived the duration
  if (next.t >= CROSSING.DURATION_S) {
    next.status = 'won';
    next.rewards = CROSSING_WIN_REWARDS();
    next.events.push({ type: 'win' });
    return next;
  }
  return next;
}

function registerHit(next, e) {
  next.hits++;
  next.hull += CROSSING.HIT_HULL;
  next.entropy += CROSSING.HIT_ENTROPY;
  next.events.push({ type: 'hit', kind: e.kind });
  if (next.hull <= 0) {
    next.status = 'lost';
    next.events.push({ type: 'lose' });
  }
}

/** AABB overlap test with `forgive` px shaved off both boxes. */
export function aabb(a, b, forgive = 0) {
  return a.x + forgive < b.x + b.w - forgive
    && b.x + forgive < a.x + a.w - forgive
    && a.y + forgive < b.y + b.h - forgive
    && b.y + forgive < a.y + a.h - forgive;
}

function nearMiss(shipBox, e) {
  const pad = CROSSING.NEAR_MISS_PX;
  return aabb(shipBox, { x: e.x - pad, y: e.y - pad, w: e.w + pad * 2, h: e.h + pad * 2 }, CROSSING.COLLIDE_FORGIVE)
    && !aabb(shipBox, e, CROSSING.COLLIDE_FORGIVE);
}

/**
 * Settle a finished run against game state (mutates `state` like choose does).
 * Returns { outcome, deltas, badge } for UI/toast/chronicle.
 *  - win:   +8 sustenance, +5 knowledge, void_pilot badge (§11.2)
 *  - skip:  same rewards without playing (reduced motion)
 *  - lose:  -10% of CURRENT sustenance, never death (§11.2)
 */
export function settleCrossing(state, run, clamp = (n) => n) {
  if (run.status === 'won' || run.status === 'skipped') {
    const before = { sustenance: state.resources.sustenance, knowledge: state.resources.knowledge };
    state.resources.sustenance = clamp(state.resources.sustenance + CROSSING.WIN_FOOD);
    state.resources.knowledge = clamp(state.resources.knowledge + CROSSING.WIN_KNOWLEDGE);
    if (!state.badges.includes(CROSSING.WIN_BADGE)) state.badges.push(CROSSING.WIN_BADGE);
    return {
      outcome: run.status,
      deltas: { sustenance: state.resources.sustenance - before.sustenance, knowledge: state.resources.knowledge - before.knowledge },
      badge: CROSSING.WIN_BADGE,
      score: run.score,
    };
  }
  if (run.status === 'lost') {
    const before = state.resources.sustenance;
    state.resources.sustenance = clamp(state.resources.sustenance * (1 - CROSSING.LOSE_SUSTENANCE_FRAC));
    return {
      outcome: 'lost',
      deltas: { sustenance: Math.round((state.resources.sustenance - before) * 100) / 100 },
      badge: null,
      score: run.score,
    };
  }
  return { outcome: 'abandoned', deltas: {}, badge: null, score: run.score };
}
