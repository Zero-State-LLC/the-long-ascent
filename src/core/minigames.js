// src/core/minigames.js — era mini-game framework (SPEC v5 §2, §3).
//
// Follows the crossing.js contract exactly: a run is created from an explicit
// seed (mulberry32 — never Math.random in logic), advanced with step(run, dt),
// and read out with done()/won()/score()/reward(). Every family is a pure
// state machine over {seeded rng, dt, actions} so tests replay deterministically.
//
// Families (spec §3): granary, scribe, trade, sweep, fallout, carbon, signal.
// 'crossing' rides the same registry as a trigger record (Crossing II stays the
// dedicated screen; this only marks that it is unlocked to play).
//
// Rate limits (spec §3): max 2 minigames per era per lineage, never during a
// crisis pulse, never while the Crossing screen is open. Enforced HERE, not in
// the UI, so saves/tests see one source of truth.
//
// Rewards (spec §2/§3): score ∈ [0,1] via each family's documented curve →
// rewardForScore maps onto the tier caps below. Nothing above the cap exists.

import { mulberry32 } from './crossing.js';

export const MINIGAME_VERSION = 1;
export const MAX_PER_ERA = 2;          // spec §3: max 2 per era per lineage
export const SCORE_MAX = 1000;         // all curves normalize to this ceiling

// -----------------------------------------------------------------------------
// Copy placeholders (Scribe flavor lands later — swap this ONE map, nothing else).
export const MINIGAME_COPY = {
  granary: { title: 'Granary Handout', blurb: 'Catch grain sacks before they hit the ground.' },
  scribe: { title: 'Scribe Speed', blurb: 'Copy the glyph sequence before the ink dries.' },
  trade: { title: 'Trade Winds', blurb: 'Steer the boat to the market buoy.' },
  sweep: { title: 'Chimney Sweep', blurb: 'Climb the flue without touching the soot.' },
  fallout: { title: 'Fallout Sprint', blurb: 'Run the dust cloud to shelter.' },
  carbon: { title: 'Carbon Run', blurb: 'Route the packets through clean nodes.' },
  signal: { title: 'Signal Drift', blurb: 'Ride the carrier wave and hold the tone.' },
  crossing: { title: 'The Long Ascent', blurb: 'The final crossing awaits.' },
  countdown: 'Ready…',   // overlay pre-roll label (UI appends 3-2-1)
  forfeit: 'Forfeited',
  win: 'Won',
  lose: 'Lost',
};

// -----------------------------------------------------------------------------
// Score curve (spec §2 — documented once, shared by every family):
//   score ∈ [0, SCORE_MAX]. raw >= target → WIN. The normalized curve is
//   p = clamp01(raw / target); reward tiers are monotone in p:
//     p >= 1.00 → full tier        (win at par)
//     p >= 0.85 → 70% of tier      (close miss still pays something)
//     p >= 0.60 → 40% of tier
//     otherwise → 15% of tier      ( consolation; playing at all is never punished )
//   Forfeit always scores 0 → consolation is NOT paid on forfeit (you quit).
export function scoreCurve(raw, target) {
  const t = Number(target) || 1;
  const p = Math.max(0, Math.min(1, (Number(raw) || 0) / t));
  if (p >= 1) return { p, mult: 1 };
  if (p >= 0.85) return { p, mult: 0.7 };
  if (p >= 0.6) return { p, mult: 0.4 };
  return { p, mult: 0.15 };
}

// Per-resource absolute caps per play (spec §3 "capped rewards"). Keys are the
// engine's POOLS plus 'morale' (game.js tracks morale separately from resources).
export const REWARD_CAPS = { sustenance: 12, knowledge: 8, population: 4, infrastructure: 6, legitimacy: 5, entropy: -6, morale: 10 };

// rewardForScore(raw, target, caps) -> { res: amount } honoring REWARD_CAPS ∩
// family caps. Negative caps (entropy rewards = entropy REDUCTION) scale the
// same way but stay negative; a positive raw score can never add entropy.
export function rewardForScore(raw, target, caps) {
  const { mult } = scoreCurve(raw, target);
  const out = {};
  for (const [res, capRaw] of Object.entries(caps || {})) {
    const globalCap = REWARD_CAPS[res];
    if (globalCap == null) continue;
    // family cap and global cap must agree in sign; magnitude takes the min.
    const cap = Math.sign(capRaw) !== 0 && Math.sign(capRaw) === Math.sign(globalCap)
      ? Math.sign(globalCap) * Math.min(Math.abs(capRaw), Math.abs(globalCap))
      : 0;
    if (cap === 0) continue;
    const amt = Math.round(cap * mult);
    if (amt !== 0) out[res] = amt;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Family table. Each descriptor:
//   { id, duration(s at diff 0), durationAt(diff), target(s at diff 0),
//     targetAt(diff), caps(res→max), create(run-shaped opts), step(run, dt),
//     action(run, name), hud(run) }
// A run carries: { family, seed, rng, t, dur, target, diff, score, done, won,
//   forfeited, ...family state }. step() returns the run.

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Difficulty scales windows tighter and durations longer: diff 0..1. For the
// count-based families (granary, carbon) `targetAt(n, diff)` takes the item
// count; for the time/quality families it takes a 0..SCORE_MAX base target.
const durAt = (base, diff) => base * (1 + 0.5 * clamp(diff, 0, 1));
const winAt = (base, diff) => base * (1 - 0.4 * clamp(diff, 0, 1));   // reserved: per-family window tightening

// ---- granary: catch falling sacks -------------------------------------------
// Sacks spawn at seeded x positions and fall; the hand moves left/right under
// them. Catch window is a horizontal radius. Winnable at diff 0 with perfect
// play: spawn spacing guarantees reachability (speed × gap ≥ max dx).
const GRANARY = {
  id: 'granary',
  durationAt: (d) => durAt(20, d),
  targetAt: (n, d) => Math.max(1, Math.round(n * (0.6 + 0.2 * clamp(d, 0, 1)))),
  caps: { sustenance: 10, morale: 4 },   // granary: food + a little morale
  create(run) {
    const n = 10;                       // sacks per run
    const items = [];
    let x = 0.5;
    for (let i = 0; i < n; i++) {
      // deterministic walk of spawn x; |dx| ≤ 0.3 keeps every sack reachable
      x = clamp(x + (run.rng() - 0.5) * 0.6, 0.05, 0.95);
      items.push({ x, t: i * 1.6 + 0.8, caught: false, missed: false });
    }
    return { ...run, items, total: n, handX: 0.5, handDir: 0, handSpeed: 0.9, catches: 0, misses: 0 };
  },
  action(run, name) {
    if (name === 'left') run.handDir = -1;
    else if (name === 'right') run.handDir = 1;
    else if (name === 'stop') run.handDir = 0;
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    run.handX = clamp01(run.handX + run.handDir * run.handSpeed * dt);
    for (const s of run.items) {
      if (s.caught || s.missed) continue;
      if (run.t >= s.t) {               // sack reaches the hand line at its t
        if (Math.abs(s.x - run.handX) <= 0.12) s.caught = true, run.catches++;
        else s.missed = true, run.misses++;
      }
    }
    if (run.t >= run.dur || run.catches + run.misses >= run.total) finish(run, run.catches * (SCORE_MAX / run.total));
    return run;
  },
};

// ---- scribe: repeat the shown glyph sequence ---------------------------------
// A seeded sequence of 4 glyphs (0..3); the player presses digits 1..4. Wrong
// press costs time (penalty), right press advances. Score = remaining time.
const SCRIBE = {
  id: 'scribe',
  durationAt: (d) => durAt(15, d),
  targetAt: (base, d) => Math.round(base * (1 - 0.3 * clamp(d, 0, 1))),
  caps: { knowledge: 7, morale: 3 },
  create(run) {
    const seq = [];
    for (let i = 0; i < 5; i++) seq.push(Math.floor(run.rng() * 4));
    return { ...run, seq, pos: 0, penalty: 0, finishedEarly: false };
  },
  action(run, name) {
    const m = /^digit:([0-3])$/.exec(name || '');
    if (!m || run.done) return run;
    if (run.seq[run.pos] === Number(m[1])) {
      run.pos++;
      if (run.pos >= run.seq.length) run.finishedEarly = true;
    } else {
      run.penalty += 1.5;               // seconds shaved off the clock
    }
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    if (run.finishedEarly) {
      finish(run, Math.max(0, Math.round((run.dur - run.t - run.penalty) / run.dur * SCORE_MAX)));
    } else if (run.t + run.penalty >= run.dur) {
      finish(run, Math.round(run.pos / run.seq.length * 0.5 * SCORE_MAX));
    }
    return run;
  },
};

// ---- trade: steer the boat to the buoy ---------------------------------------
// Wind pushes the boat sideways (seeded gusts); player counter-steers. Reaching
// the buoy x-band within the duration wins; score decays with drift error.
const TRADE = {
  id: 'trade',
  durationAt: (d) => durAt(18, d),
  targetAt: (base, d) => Math.round(base * (1 - 0.3 * clamp(d, 0, 1))),
  caps: { legitimacy: 4, morale: 5 },   // trade: deals land as legitimacy + morale
  create(run) {
    const gusts = [];
    for (let i = 0; i < 6; i++) gusts.push({ t: 2 + i * 2.5, dir: run.rng() < 0.5 ? -1 : 1, strength: 0.25 + run.rng() * 0.2 });
    return { ...run, boatX: 0.1, buoyX: 0.9, steer: 0, gusts, gustIdx: 0, arrived: false };
  },
  action(run, name) {
    if (name === 'left') run.steer = -1;
    else if (name === 'right') run.steer = 1;
    else if (name === 'stop') run.steer = 0;
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    while (run.gustIdx < run.gusts.length && run.t >= run.gusts[run.gustIdx].t) {
      const g = run.gusts[run.gustIdx++];
      run.boatX = clamp01(run.boatX + g.dir * g.strength * 0.5);
    }
    run.boatX = clamp01(run.boatX + run.steer * 0.45 * dt);
    // Arrival is timed at the gust that follows it: steering back into the buoy
    // band before the LAST gust still counts (a mid-run touch would otherwise
    // freeze the score and let a later gust strand the boat — soft-lose).
    if (run.gustIdx >= run.gusts.length && Math.abs(run.boatX - run.buoyX) <= 0.05) run.arrived = true;
    if ((run.arrived && run.gustIdx >= run.gusts.length) || run.t >= run.dur) {
      const err = Math.abs(run.boatX - run.buoyX);
      finish(run, run.arrived ? Math.round(clamp01(1 - err * 4) * SCORE_MAX) : Math.round(clamp01(1 - err) * 0.4 * SCORE_MAX));
    }
    return run;
  },
};

// ---- sweep: climb the flue, dodge soot patches -------------------------------
// Auto-climb; soot bands at seeded heights sweep horizontally. Player ducks
// (hold 'duck') or shifts lanes ('left'/'right' between 3 lanes). Clean climb =
// no contact; each contact shaves score.
const SWEEP = {
  id: 'sweep',
  durationAt: (d) => durAt(22, d),
  targetAt: (base, d) => Math.round(base * (1 - 0.25 * clamp(d, 0, 1))),
  caps: { infrastructure: 6, sustenance: 3 },   // sweep: soot-cleaning pays in infrastructure
  create(run) {
    const bands = [];
    for (let i = 0; i < 8; i++) {
      bands.push({ y: 0.15 + i * 0.1, lane: Math.floor(run.rng() * 3), t: 0, hit: false, passed: false });
    }
    return { ...run, lane: 1, ducking: false, climb: 0, climbSpeed: 1 / 20, contacts: 0, bands };
  },
  action(run, name) {
    if (name === 'left') run.lane = clamp(run.lane - 1, 0, 2);
    else if (name === 'right') run.lane = clamp(run.lane + 1, 0, 2);
    else if (name === 'duck') run.ducking = true;
    else if (name === 'stand') run.ducking = false;
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    run.climb = Math.min(1, run.climb + run.climbSpeed * dt);
    for (const b of run.bands) {
      if (b.passed) continue;
      if (run.climb >= b.y) {
        b.passed = true;
        const dodged = run.ducking || run.lane !== b.lane;
        if (!dodged) { b.hit = true; run.contacts++; }
      }
    }
    if (run.climb >= 1 || run.t >= run.dur) finish(run, Math.max(0, SCORE_MAX - run.contacts * Math.round(SCORE_MAX / 8)));
    return run;
  },
};

// ---- fallout: outrun the dust cloud ------------------------------------------
// Cloud chases from behind at seeded surges; player sprints (hold 'run'), must
// rest periodically (stamina). Reach shelter (x=1) before the cloud (cloud >= x).
const FALLOUT = {
  id: 'fallout',
  durationAt: (d) => durAt(25, d),
  targetAt: (base, d) => Math.round(base * (1 - 0.3 * clamp(d, 0, 1))),
  caps: { population: 3, morale: 5 },   // fallout: survivors + morale for making it
  create(run) {
    const surges = [];
    for (let i = 0; i < 5; i++) surges.push({ t: 3 + i * 4, speed: 0.05 + run.rng() * 0.04 });
    return { ...run, x: 0.05, cloud: -0.15, stamina: 1, running: false, surges, surgeIdx: 0, reached: false };
  },
  action(run, name) {
    if (name === 'run') run.running = true;
    else if (name === 'rest') run.running = false;
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    // Sprint pacing: net +0.04/s while sprinting (speed 0.09, cloud base 0.05),
    // net -0.05/s while resting. Stamina drains in 8s of sprint (0.125/s),
    // refills in ~6.7s of rest (0.15/s) — a perfect player sprints 8s, rests
    // ~5.3s, and reaches shelter at x=1 around t≈24s vs the cloud ≈ t≈26s.
    const moving = run.running && run.stamina > 0;
    if (moving) {
      run.x = clamp01(run.x + 0.09 * dt);
      run.stamina = Math.max(0, run.stamina - 0.125 * dt);
    } else {
      run.stamina = Math.min(1, run.stamina + 0.15 * dt);
    }
    while (run.surgeIdx < run.surges.length && run.t >= run.surges[run.surgeIdx].t) run.surgeIdx++;
    const cloudSpeed = 0.05 + (run.surgeIdx > 0 ? 0.008 * run.surgeIdx : 0);
    run.cloud += cloudSpeed * dt;
    if (run.x >= 1) { run.reached = true; finish(run, Math.round(clamp01(1 - (run.x - run.cloud) * -0.1 - (1 - run.dur + run.t) * 0.02) * SCORE_MAX)); }
    else if (run.cloud >= run.x) finish(run, Math.round(clamp01(run.x) * 0.3 * SCORE_MAX));
    else if (run.t >= run.dur) finish(run, Math.round(clamp01(run.x) * 0.5 * SCORE_MAX));
    return run;
  },
};

// ---- carbon: route packets through clean nodes -------------------------------
// Packets arrive at seeded lanes; two gates toggle with 'gate:left'/'gate:right'.
// Route to the packet's required polarity; clean routing accumulates score.
const CARBON = {
  id: 'carbon',
  durationAt: (d) => durAt(20, d),
  targetAt: (n, d) => Math.max(1, Math.round(n * (0.6 + 0.2 * clamp(d, 0, 1)))),
  caps: { knowledge: 6, entropy: -5 },   // carbon: clean routing = knowledge + entropy relief
  create(run) {
    const n = 8;
    const pkts = [];
    for (let i = 0; i < n; i++) pkts.push({ need: run.rng() < 0.5 ? 'L' : 'R', t: 1.5 + i * 2 });
    return { ...run, gate: 'L', pkts, routed: 0, clean: 0, total: n };
  },
  action(run, name) {
    if (name === 'gate:left') run.gate = 'L';
    else if (name === 'gate:right') run.gate = 'R';
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    for (const p of run.pkts) {
      if (p.resolved) continue;
      if (run.t >= p.t) { p.resolved = true; run.routed++; if (p.need === run.gate) run.clean++; }
    }
    if (run.routed >= run.total || run.t >= run.dur) finish(run, run.clean * (SCORE_MAX / run.total));
    return run;
  },
};

// ---- signal: hold the drifting carrier tone ----------------------------------
// Target tone drifts (seeded sine sum); player nudges with 'up'/'down'. Score =
// fraction of time inside tolerance. Hold long enough near center to win.
const SIGNAL = {
  id: 'signal',
  durationAt: (d) => durAt(20, d),
  targetAt: (base, d) => Math.round(base * (1 - 0.3 * clamp(d, 0, 1))),
  caps: { legitimacy: 4, knowledge: 3 },   // signal: a locked carrier = reach + know-how
  create(run) {
    const ph1 = run.rng() * Math.PI * 2, ph2 = run.rng() * Math.PI * 2;
    // vel is a per-frame impulse accumulator (decays by ^dt); tone integrates it.
    return { ...run, tone: 0.5, vel: 0, ph1, ph2, goodT: 0, tol: 0.12 };
  },
  action(run, name) {
    if (name === 'up') run.vel += 0.6;
    else if (name === 'down') run.vel -= 0.6;
    return run;
  },
  step(run, dt) {
    if (run.done) return run;
    run.t += dt;
    const target = 0.5 + 0.25 * Math.sin(run.t * 0.7 + run.ph1) + 0.15 * Math.sin(run.t * 1.9 + run.ph2);
    run.vel *= Math.pow(0.05, dt);       // strong damping: impulses decay fast
    run.tone = clamp01(run.tone + run.vel * dt);
    if (Math.abs(run.tone - target) <= run.tol) run.goodT += dt;
    if (run.t >= run.dur) finish(run, Math.round(clamp01(run.goodT / run.dur) * SCORE_MAX));
    return run;
  },
};

function finish(run, raw) {
  run.score = Math.max(0, Math.min(SCORE_MAX, Math.round(raw)));
  run.done = true;
  run.won = !run.forfeited && run.score >= run.target;
  return run;
}

export const FAMILIES = { granary: GRANARY, scribe: SCRIBE, trade: TRADE, sweep: SWEEP, fallout: FALLOUT, carbon: CARBON, signal: SIGNAL };

// -----------------------------------------------------------------------------
// Run lifecycle (crossing.js contract mirror).

// createRun(family, { seed, diff, now }) — seed REQUIRED (no default randomness).
export function createRun(family, opts = {}) {
  const desc = FAMILIES[family];
  if (!desc) throw new Error(`unknown minigame family: ${family}`);
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : 1;
  const diff = clamp(Number(opts.diff) || 0, 0, 1);
  const dur = desc.durationAt(diff);
  const target = desc.targetAt(desc.id === 'granary' || desc.id === 'carbon' ? 10 : 700, diff);
  const base = {
    family, seed, rng: mulberry32(seed), t: 0, dur, target, diff,
    score: 0, done: false, won: false, forfeited: false,
  };
  return desc.create(base);
}

export function step(run, dt) {
  if (!run || run.done) return run;
  return FAMILIES[run.family].step(run, dt);
}

// act(run, name) — discrete input ('left','right','up','down','duck','stand',
// 'run','rest','stop','gate:left','gate:right','digit:0'..'digit:3').
export function act(run, name) {
  if (!run || run.done) return run;
  return FAMILIES[run.family].action(run, name);
}

export function done(run) { return !!run?.done; }
export function won(run) { return !!run?.won; }
export function score(run) { return run?.score || 0; }

// Forfeit (Esc, spec §4): ends immediately, score 0, no consolation.
export function forfeit(run) {
  if (!run || run.done) return run;
  run.forfeited = true;
  return finish(run, 0);
}

// reward(run) -> deltas object ({} on forfeit).
export function reward(run) {
  if (!run || run.forfeited) return {};
  return rewardForScore(run.score, run.target, FAMILIES[run.family].caps);
}

// Deterministic winnability proof used by tests: greedy per-family autopilot.
// Returns the final run after playing `policy` perfectly on a fixed tick.
export function simulate(family, seed, diff = 0, tick = 1 / 30) {
  let run = createRun(family, { seed, diff });
  const policies = {
    granary(r) {
      const next = r.items.find((s) => !s.caught && !s.missed);
      if (!next) return 'stop';
      if (next.x < r.handX - 0.02) return 'left';
      if (next.x > r.handX + 0.02) return 'right';
      return 'stop';
    },
    scribe(r) { return `digit:${r.seq[r.pos] ?? 0}`; },
    trade(r) { return r.boatX < r.buoyX ? 'right' : 'left'; },
    sweep(r) {
      const next = r.bands.find((b) => !b.passed);
      if (!next) return 'stand';
      const imminent = next.y - r.climb < 0.03;
      return imminent ? 'duck' : 'stand';
    },
    fallout(r) { return r.stamina > 0.25 ? 'run' : 'rest'; },
    carbon(r) {
      const next = r.pkts.find((p) => !p.resolved);
      return next ? (next.need === 'L' ? 'gate:left' : 'gate:right') : 'gate:left';
    },
    signal(r) {
      const target = 0.5 + 0.25 * Math.sin(r.t * 0.7 + r.ph1) + 0.15 * Math.sin(r.t * 1.9 + r.ph2);
      if (r.tone < target - 0.02) return 'up';
      if (r.tone > target + 0.02) return 'down';
      return 'noop';
    },
  };
  const policy = policies[family];
  let guard = 0;
  while (!run.done && guard++ < 10000) {
    const a = policy(run);
    if (a && a !== 'noop') run = act(run, a);
    run = step(run, tick);
  }
  return run;
}

// -----------------------------------------------------------------------------
// Session tracker — rate limits live here (spec §3). Serialized into the save.

export function createTracker() {
  return { version: MINIGAME_VERSION, era: null, playedThisEra: 0, playedByFamily: {}, best: {}, lastLineage: null };
}

// isAvailable(tracker, family, { eraNum, crisisActive, crossingOpen }) ->
// { ok, why }. NEVER during a crisis pulse or while the Crossing screen is open;
// max MAX_PER_ERA per era; once per family per era.
export function isAvailable(tracker, family, ctx = {}) {
  if (!FAMILIES[family] && family !== 'crossing') return { ok: false, why: 'unknown' };
  if (ctx.crisisActive) return { ok: false, why: 'crisis' };
  if (ctx.crossingOpen) return { ok: false, why: 'crossing' };
  if (tracker.playedThisEra >= MAX_PER_ERA) return { ok: false, why: 'era_limit' };
  const key = `${ctx.eraNum ?? '?'}:${family}`;
  if (tracker.playedByFamily[key]) return { ok: false, why: 'family_once' };
  return { ok: true, why: '' };
}

// recordResult(tracker, family, { eraNum, score }) — call once per completed run.
export function recordResult(tracker, family, ctx = {}) {
  tracker.playedThisEra++;
  tracker.playedByFamily[`${ctx.eraNum ?? '?'}:${family}`] = true;
  const prev = tracker.best[family]?.score || 0;
  if ((ctx.score || 0) > prev) tracker.best[family] = { score: ctx.score || 0, era: ctx.eraNum ?? null };
  return tracker;
}

// resetEra(tracker, eraNum) — call when the game advances to a new era.
export function resetEra(tracker, eraNum) {
  tracker.era = eraNum;
  tracker.playedThisEra = 0;
  return tracker;
}

// Ledger rows for the scoreboard UI (spec §4): [{family, title, best, plays}].
export function ledgerRows(tracker) {
  return Object.keys(FAMILIES).map((f) => ({
    family: f,
    title: MINIGAME_COPY[f]?.title || f,
    best: tracker.best[f]?.score ?? 0,
    plays: Object.keys(tracker.playedByFamily).filter((k) => k.endsWith(`:${f}`)).length,
  })).filter((row) => row.plays > 0);
}
