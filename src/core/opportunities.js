// src/core/opportunities.js — SPEC §10.3: non-blocking opportunity toasts.
//
// Pure rate limiter + offer picker + effect math. The UI (dom-boot) owns the
// toast DOM; this module decides WHEN an offer may fire and WHAT accepting or
// declining does to the pools. Opportunity shape (v3-copy): { era, title, body,
// cost:{pool:n}, reward:{pool:n}, weight }.

export const OPP_WINDOW_MS = 8000;       // auto-dismiss after 8s (§10.3)
export const CRISIS_COOLDOWN_MS = 30000; // max 1 crisis pulse per 30s (§10.3)
export const OPP_CHANCE = 0.25;          // ~1 in 4 ticks a knock is attempted (§10.3)

/**
 * An era is split into thirds by progress toward its target; each third may
 * carry at most ONE opportunity knock (§10.3 rate limit). Returns 0..2.
 */
export function eraThird(eraProgress, progressTarget) {
  if (!(progressTarget > 0)) return 0;
  const f = Math.max(0, Math.min(1, eraProgress / progressTarget));
  return f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2;
}

/** Fresh tracker. */
export function createOpportunityTracker() {
  return { lastOfferedEraThird: null, lastCrisisAt: -Infinity, seenIds: [] };
}

const slotKey = (era, thirdIdx) => `${era}:${thirdIdx}`;

/** May an opportunity knock fire right now? One per era-third only. */
export function canOfferOpportunity(tracker, era, eraProgress, progressTarget) {
  return tracker.lastOfferedEraThird !== slotKey(era, eraThird(eraProgress, progressTarget));
}

/** Weighted deterministic pick among unseen, era-eligible offers. */
export function pickOpportunity(opps, { era }, tracker, rng = () => 0.5) {
  const eligible = (opps || []).filter((o, i) => o.era <= era && !tracker.seenIds.includes(oppId(o, i)));
  if (!eligible.length) return null;
  const total = eligible.reduce((s, o) => s + (o.weight || 1), 0);
  let r = rng() * total;
  for (const o of eligible) {
    r -= (o.weight || 1);
    if (r <= 0) return o;
  }
  return eligible[eligible.length - 1];
}

/** Stable id for an opportunity (no id field in Scribe's schema -> derive one). */
export function oppId(o, i) { return o.id || `opp_${o.era}_${o.title}`; }

/** Consume the era-third slot + mark the offer seen. */
export function consumeSlot(tracker, era, eraProgress, progressTarget, opp, i) {
  tracker.lastOfferedEraThird = slotKey(era, eraThird(eraProgress, progressTarget));
  const id = oppId(opp, i);
  if (!tracker.seenIds.includes(id)) tracker.seenIds.push(id);
  return tracker;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Apply an opportunity outcome. accept=true pays cost & gains reward;
 * decline=false is free (the knock just fades). Mutates state.resources via
 * `clamp(x, lo, hi)` provided by the caller (game.js semantics).
 */
export function applyOpportunity(state, opp, accept, clamp) {
  const deltas = {};
  if (!accept || !opp) return deltas;
  const steps = [
    [opp.cost || {}, -1],
    [opp.reward || {}, +1],
  ];
  for (const [spec, sign] of steps) {
    for (const [pool, v] of Object.entries(spec)) {
      if (typeof v !== 'number' || !(pool in state.resources)) continue;
      const before = state.resources[pool];
      state.resources[pool] = clamp(before + sign * Math.abs(v), pool === 'entropy' ? 0 : -100, 100);
      deltas[pool] = round1((deltas[pool] || 0) + (state.resources[pool] - before));
    }
  }
  return deltas;
}
