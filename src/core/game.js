// THE LONG ASCENT — core game logic. Pure: zero DOM imports, runs in node.
// Implements SPEC §3 + §10 (v3): era state machine (17 eras), 6-pool resource
// model with per-era re-keying, data-driven event engine, choice/flag system,
// the Lineage mechanic (death/heir, fork/merge post-upload, copy-drift),
// Chronicle log, save/load with export codes + v2→v3 migration, story arcs
// (§10.2), opportunity/crisis mini-events (§10.3) and the endings evaluator.

import { createArcState, observeEvent, applyTransitionEntropy, convergenceSummary } from './arcs.js';
import { migrateV2toV3, isLegacySave, SAVE_VERSION_V3 } from './migration.js';
import { checkCrossings, createCrisisTracker } from './crisisPulses.js';
import { createTracker as createMinigameTracker, recordResult, resetEra } from './minigames.js';
import { createOpportunityTracker, canOfferOpportunity, pickOpportunity, consumeSlot, applyOpportunity, OPP_CHANCE } from './opportunities.js';

export const POOLS = ['sustenance', 'knowledge', 'population', 'infrastructure', 'legitimacy', 'entropy'];
export const SAVE_VERSION = SAVE_VERSION_V3; // v3: 17-era spine + arcs (SPEC §10.1); migrates v2 saves
export const FINALE_ERA = 17; // the Singularity finale (E11-12 kept its legacy id) (SPEC §10.1)
export const UPLOAD_ERA = 13; // copies exist from the Digital Dawn onward (v3 spine)
const CEILING = 1000;

// --- v2.1 depth constants (SPEC §9.2) ---------------------------------------
export const ENTROPY_EVENT_BOOST = 50;   // above this, events fire more often
export const ENTROPY_DECAY_THRESHOLD = 80; // above this, resources decay per tick
export const ENTROPY_DECAY_RATE = 0.02;  // 2%/tick of each non-entropy pool
export const ENTROPY_BGM_THRESHOLD = 70; // UI: swap to bgm_high_entropy above this
export const CARRIER_REACTION_ENTROPY = 60; // UI: carrier reaction flashes above this

// Legacy modifiers accumulated by past choices (SPEC §9.2 "Legacy modifiers pane").
// Data-driven so the Lineage tab and tests share one source of truth.
export const MODIFIER_DEFS = [
  { flag: 'promethean', name: 'Promethean', blurb: 'fire events +20%' },
  { flag: 'promethean_flavor', name: 'Fire-Tender Bloodline', blurb: 'the flame runs in the family' },
  { flag: 'attention_corruption', name: 'Feed Addiction', blurb: 'attention corrupts sustenance income' },
  { flag: 'copy_diversity', name: 'Copy Diversity', blurb: 'forks instances post-upload' },
  { flag: 'instance_spread', name: 'Instance Spread', blurb: 'forks instances post-upload' },
  { flag: 'forced_mergers', name: 'Forced Mergers', blurb: 'copies recombine; synergy up, diversity down' },
  { flag: 'accelerationista', name: 'Accelerationista', blurb: 'late-era options colored by the singularity' },
  { flag: 'ai_hire_rights', name: 'Personhood Granted', blurb: 'unlocks era-11 personhood events' },
];

// Era goal badges (SPEC §9.2 + §10.1): hitting an era's named goal grants these
// at the era transition, keyed to the 17-era spine. Legacy badges keep their old
// slots (remapped through the §10.1 insertion table); each new era earns its own.
export const ERA_GOAL_BADGES = {
  1: 'fire', 2: 'surplus', 3: 'city',            // cave, agriculture, bronze
  4: 'sails',                                     // Sails & Empires (new)
  5: 'ideals',                                    // Revolution & Empire (new)
  6: 'print',                                     // Renaissance (old era 4)
  7: 'factory',                                   // Steam (old era 5)
  9: 'atom',                                      // Atomic (old era 6)
  10: 'orbit',                                    // Space Age (new)
  11: 'code',                                     // Digital Dawn (old era 7)
  12: 'carbon',                                   // Green Transition (new)
  16: 'void',                                     // Long Silence (new)
  17: 'upload',                                   // Singularity (old era 11)
};

// v3 story-arc flags (SPEC §10.2). The arc state machine in arcs.js mirrors
// these; events data carries `arc` + per-choice flags.
const CUSTODIAN_RE = /^custodian_/;
const RIVAL_MIRROR_RE = /^rival_(west|ennobled|opposite_flag|milestone|circular|convergence)/;

// One-shot production step for a pool (pure; shared by tick() and the UI's
// per-second delta chips so "+X.X/s" always matches what actually lands).
export function poolStepDelta(pool, baseRate, ctx = {}) {
  let d = baseRate || 0;
  if (pool === 'sustenance' && ctx.era >= 15 && ctx.attentionCorruption) d *= 0.7;
  // Era 6 "Keep the Flame" (v2 era 4): knowledge decays unless the lineage keeps
  // copying (archive_diligence slows the bleed to -0.1/tick instead of the era rate).
  if (pool === 'knowledge' && ctx.era === 6 && d < 0) d = ctx.archiveDiligence ? Math.max(d, -0.1) : d;
  if (pool === 'entropy') {
    if (d < 0) d *= 0.5; // entropy never goes down easily (SPEC §3.1)
    else d *= Math.min((ctx.tempoMult || 1) * 0.45, 0.6);
  }
  return d;
}

// Per-tick decay when entropy is critical (>80): 2% of each non-entropy pool.
export function decayAmount(value, rate = ENTROPY_DECAY_RATE) {
  if (!(value > 0)) return 0;
  return round2Static(value * rate);
}

// Snapshot of resource deltas applied during the last choice (SPEC §9.2:
// "+12 Food" outcome chips). Badges are listed separately.
export function deltaSnapshot(before, after) {
  const deltas = {};
  for (const p of POOLS) {
    const d = round2Static(after[p] - before[p]);
    if (d !== 0) deltas[p] = d;
  }
  return deltas;
}

export function formatDeltas(deltas, labels = {}) {
  return Object.entries(deltas).map(([p, v]) => `${v > 0 ? '+' : '−'}${Math.abs(v)} ${labels[p] || p}`);
}

// Chronicle line for a choice's consequences ("+12 Food, −3 Legitimacy").
export function describeDeltas(deltas, badges = [], labels = {}) {
  const parts = formatDeltas(deltas, labels);
  for (const b of badges) parts.push(`+1 badge: ${b[0].toUpperCase()}${b.slice(1)}`);
  return parts.join(', ');
}

function round2Static(x) { return Math.round(x * 100) / 100; }

export function createGame({ erasData, eventsData, copyData = null, miniData = null, rng = Math.random }) {
  const eraDefs = erasData.eras;
  const transitions = new Map(erasData.transitions.map((t) => [t.era, t]));
  const allEvents = eventsData.events;
  const lineageEvent = erasData.lineageEvent;
  const MINI = miniData || {}; // v3 sidecar: opportunities + crisis_pulses (SPEC §10.3)

  const state = {
    version: SAVE_VERSION,
    era: 1,
    phase: 'event', // event | transition | ending
    progress: 0,
    ticksSinceChoice: 0,
    tickCount: 0,
    resources: { sustenance: 20, knowledge: 5, population: 10, infrastructure: 5, legitimacy: 10, entropy: 0 },
    morale: 50,
    clock: 100, // doomsday-clock buffer (Era 8+); lower = closer to midnight
    copies: 1,
    drift: 0,
    carrier: 1,
    heirPending: null,
    flags: [],
    badges: [], // earned milestone badge names (SPEC §4.1); Object.assign keeps old saves compatible via default here
    chronicle: [],
    seenEvents: [],
    pendingEventId: null,
    seedCounts: {},
    ending: null,
    // v2.1 (SPEC §9.2): legacy modifiers harvested from flags at each choice,
    // and which era goals have already paid out their badge + bonus.
    lineageMods: [],
    eraGoalsDone: [],
    lastDeltas: null, // deltas of the most recent choice, for the outcome chips
    // v3 (SPEC §10.2): story-arc ledger — custodian relics, benthic deals, rival mirrors.
    arcs: createArcState(),
    crossingUnlocked: false, // set on era-16 arrival; title screen offers THE CROSSING (§11.4)
    minigames: createMinigameTracker(), // v5 (SPEC §3): per-era rate limits + best-score ledger
    rngSeedNote: 'rng not serialized; saves resume deterministically from state only',
  };

  // UI-facing trackers (not serialized): opportunity rate-limit + crisis latch.
  const oppTracker = createOpportunityTracker();
  const crisisTracker = createCrisisTracker();

  // v5 §3: minigame offers must never fire during a crisis pulse — expose the
  // live latch (crisisPulses keeps it UI-side, not in the save).
  Object.defineProperty(state, 'crisisLatched', { get: () => crisisTracker.latched, enumerable: false });

  const hasFlag = (f) => state.flags.includes(f);
  const addFlag = (f) => { if (!hasFlag(f)) state.flags.push(f); };

  function eraDef(n = state.era) { return eraDefs.find((e) => e.num === n); }

  function chronicle(text, kind = 'decision') {
    state.chronicle.push({ era: state.era, carrier: state.carrier, text, kind, seq: state.chronicle.length });
  }

  // ------------------------------------------------------------- requirements
  // Requirements are authored as small predicates over flags/resources so the
  // engine stays data-driven; the JSON carries requirement ids resolved here.
  const REQUIREMENTS = {
    uploaded: () => state.era >= 13, // post-Digital Dawn: copies exist (v3 spine)
    personhood_granted: () => hasFlag('ai_hire_rights') || hasFlag('personhood_disruption'),
    promethean_locked: () => !hasFlag('no_fire_mastery'),
  };

  function meetsRequirements(ev) {
    for (const r of ev.requirements || []) {
      const fn = REQUIREMENTS[r];
      if (fn && !fn()) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- event engine
  function eligibleEvents() {
    return allEvents.filter((ev) => ev.era === state.era && !state.seenEvents.includes(ev.id) && meetsRequirements(ev));
  }

  function pickNextEventId() {
    const elig = eligibleEvents();
    if (elig.length === 0) return null;
    // deterministic-ish pick through injected rng
    const i = Math.floor(rng() * elig.length) % elig.length;
    return elig[i].id;
  }

  function currentEvent() {
    if (state.phase === 'transition') {
      const t = transitions.get(state.era);
      return t ? { ...t, kind: 'transition' } : null;
    }
    if (state.phase !== 'event') return null;
    if (state.forcedLineage) return lineageEvent; // sticky until resolved via choose()
    if (!state.pendingEventId) state.pendingEventId = pickNextEventId();
    if (!state.pendingEventId) return null;
    return allEvents.find((e) => e.id === state.pendingEventId) || null;
  }

  // ------------------------------------------------------------- effects
  function applyEffects(effects, sourceLabel) {
    for (const [k, v] of Object.entries(effects || {})) {
      if (k === 'heir_tax') continue; // handled by lineage path
      if (POOLS.includes(k)) {
        state.resources[k] = clamp(state.resources[k] + v, k === 'entropy' ? 0 : -CEILING, CEILING);
      } else if (k === 'clock') {
        state.clock = clamp(state.clock - v, 0, 100); // clock + = more danger
      } else if (k === 'morale') {
        state.morale = clamp(state.morale + v, 0, 100);
      }
      // narrative-only tokens arrive as flags instead (see data generator)
    }
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // ------------------------------------------------------------- minigames (SPEC v5 §3)
  // Apply a completed run's reward deltas onto the world. Deltas come from
  // minigames.reward(run) — already tier-capped there; this clamps to pool
  // bounds exactly like applyEffects and records the ledger best + era slot.
  function applyMinigameReward(family, deltas, { score = 0 } = {}) {
    const applied = {};
    for (const [k, v] of Object.entries(deltas || {})) {
      if (POOLS.includes(k)) {
        const before = state.resources[k];
        state.resources[k] = clamp(before + v, k === 'entropy' ? 0 : -CEILING, CEILING);
        applied[k] = Math.round((state.resources[k] - before) * 100) / 100;
      } else if (k === 'morale') {
        const before = state.morale;
        state.morale = clamp(state.morale + v, 0, 100);
        applied.morale = Math.round((state.morale - before) * 100) / 100;
      }
    }
    recordResult(state.minigames, family, { eraNum: state.era, score });
    state.lastDeltas = applied; // outcome chips on the end card read this (spec §4)
    return applied;
  }

  // The era's offered family (eras.json `minigame.family`), or null. 'crossing'
  // is a trigger record, not a playable overlay — Crossing II keeps its screen.
  function eraMinigame(n = state.era) {
    const def = eraDef(n);
    return def?.minigame?.family || null;
  }

  // ------------------------------------------------------------- choices
  function choose(choiceLabel) {
    const ev = currentEvent();
    if (!ev) throw new Error('no pending decision');
    const choice = ev.choices.find((c) => c.label === choiceLabel);
    if (!choice) throw new Error(`unknown choice "${choiceLabel}" for ${ev.id}`);

    const before = { ...state.resources };
    applyEffects(choice.effects, ev.id);
    state.lastDeltas = deltaSnapshot(before, state.resources);
    // v5 §3 rate-limit support: keep the crisis latch current so the UI knows a
    // pulse is live (latched per pool until recovery; 30s global cooldown).
    checkCrossings(crisisTracker, before, state.resources, MINI.crisis_pulses, Date.now());
    for (const f of choice.flags) addFlag(f);
    harvestModifiers(choice.flags);
    // v3 (§10.2): the arc ledger mirrors every resolved arc event.
    if (ev.arc) state.arcs = observeEvent(state.arcs, ev, choice.flags);
    // Milestone badges (SPEC §4.1): flags that name an upgrade badge light it up.
    const BADGE_FLAG_RE = /^(got_badge|milestone)_([a-z]+)$/;
    const newBadges = [];
    for (const f of choice.flags || []) {
      const m = BADGE_FLAG_RE.exec(f);
      if (m && !state.badges.includes(m[2])) { state.badges.push(m[2]); newBadges.push(m[2]); }
    }
    if (ev.id === 'E11-12') state.lastFinaleFlags = [...choice.flags];

    if (ev.kind === 'transition') {
      advanceEra();
      return { ok: true, era: state.era, deltas: state.lastDeltas, badges: newBadges };
    }
    if (ev.kind === 'lineage') {
      resolveLineageDeath(choice);
      return { ok: true, era: state.era, deltas: state.lastDeltas, badges: newBadges };
    }

    state.seenEvents.push(ev.id);
    chronicle(`Era ${state.era}: Carrier ${roman(state.carrier)} chose “${ev.title}” — ${choice.label}. ${choice.quote || ''}`.trim());
    // v2.1 (SPEC §9.2): the consequences ride along in the Chronicle.
    const deltaLine = describeDeltas(state.lastDeltas, newBadges, { sustenance: eraDef().sustenanceLabel });
    if (deltaLine) chronicle(deltaLine, 'outcome');
    if (/\bBenthic/i.test(ev.body + ev.title)) chronicle('The Benthics recorded this choice. They always record this choice.', 'outcome');
    state.pendingEventId = null;

    // Era-11 management actions can trigger fork/merge/drift between events.
    maybeLateGameLineage();

    // The finale decision IS the ending claim: evaluate it directly, before
    // any pool-derived fallbacks can override the player's stated trajectory.
    if (ev.id === 'E11-12') {
      const claimed = (choice.flags || []).filter((f) => f.startsWith('seed_') && f !== 'seed_none_claimed');
      // A lineage that refused every trajectory outranks a driver-forced seed pick.
      finalizeEnding(state.flags.includes('seed_none_claimed') ? [] : claimed);
      return { ok: true, era: state.era, deltas: state.lastDeltas, badges: newBadges };
    }
    checkEndingConditions();
    return { ok: true, era: state.era, deltas: state.lastDeltas, badges: newBadges };
  }

  // v2.1: fold newly-taken flags into the visible Lineage modifier list (§9.2).
  function harvestModifiers(flags) {
    for (const f of flags || []) {
      const def = MODIFIER_DEFS.find((d) => d.flag === f);
      if (def && !state.lineageMods.some((m) => m.flag === f)) {
        state.lineageMods.push({ flag: def.flag, name: def.name, blurb: def.blurb, era: state.era });
      }
    }
  }

  function roman(n) {
    const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out || 'I';
  }

  // ------------------------------------------------------------- lineage
  function resolveLineageDeath(choice) {
    if (choice.label === 'Name the heir') {
      // heir tax: -10% of one pool (largest non-entropy pool)
      const pools = POOLS.filter((p) => p !== 'entropy');
      const target = pools.reduce((a, b) => (state.resources[a] >= state.resources[b] ? a : b));
      const before = state.resources[target];
      state.resources[target] = Math.round(before * 0.9 * 100) / 100;
      state.carrier += 1;
      chronicle(`Died in era ${state.era}; heir ${roman(state.carrier)} absorbed the -10% of ${target}. Management change.`, 'lineage');
    } else {
      chronicle('Succession stalled. Death negotiates; it does not concede.', 'lineage');
    }
    state.forcedLineage = false;
    state.seenEvents.push('LX-death:' + state.era);
    state.pendingEventId = null;
  }

  // Post-upload (Era 13+ in the v3 spine): forks, merges, copy-drift pressure.
  function maybeLateGameLineage() {
    if (state.era < UPLOAD_ERA) return;
    const forked = hasFlag('copy_diversity') || hasFlag('instance_spread');
    if (forked && state.copies < 5) {
      state.copies += 1;
      state.drift = clamp(state.drift + 15, 0, 100);
      chronicle(`Forked into ${state.copies} instances; drift index ${state.drift}%`, 'lineage');
    }
    if (hasFlag('forced_mergers') && state.copies > 1) {
      state.copies -= 1;
      state.drift = clamp(state.drift - 10, 0, 100);
      chronicle(`Merged down to ${state.copies} instances; synergy up, diversity down`, 'lineage');
    }
    if (state.drift >= 70) addFlag('copy_drift_crisis');
  }

  // ------------------------------------------------------------- ticks & progression
  // Shared context for pool deltas (tick + UI per-second chips stay in lockstep).
  function stepCtx() {
    const def = eraDef();
    return {
      era: state.era,
      tempoMult: Math.min(10 / def.ticksPerChoice, 2),
      attentionCorruption: hasFlag('attention_corruption'),
      archiveDiligence: hasFlag('archive_diligence'),
    };
  }

  // Per-tick production delta for one pool at current state (UI: "+X.X/s").
  function poolRate(pool) {
    return poolStepDelta(pool, eraDef().tickRate[pool] || 0, stepCtx());
  }

  // v2.1 (§9.2): above 50 entropy, events fire more often (halved cooldown).
  function eventCooldown() {
    const base = eraDef().ticksPerChoice;
    return state.resources.entropy > ENTROPY_EVENT_BOOST ? Math.max(3, Math.ceil(base / 2)) : base;
  }

  function tick(paused = false) {
    if (state.phase === 'ending') return;
    // Pause during choices (SPEC §9.1): the UI passes paused=true while an event
    // card is open so reading doesn't cost resources. Progress still advances —
    // "it advances regardless" is the game's thesis, not a bug to pause away.
    if (!paused) {
      const ctx = stepCtx();
      const rate = eraDef().tickRate;
      const decay = state.resources.entropy > ENTROPY_DECAY_THRESHOLD; // §9.2: >80 => 2%/tick
      for (const p of POOLS) {
        let d = poolStepDelta(p, rate[p] || 0, ctx);
        if (decay && p !== 'entropy') d -= decayAmount(state.resources[p]);
        state.resources[p] = clamp(round2(state.resources[p] + d), p === 'entropy' ? 0 : -CEILING, CEILING);
      }
    }
    state.progress = round2(state.progress + 1);
    state.tickCount += 1;
    if (state.resources.entropy >= 100) { checkEndingConditions(); return; }
    if (state.progress >= progressTargetForEra()) {
      state.phase = 'transition';
      state.pendingEventId = null;
    } else if (state.ticksSinceChoice >= eventCooldown()) {
      state.ticksSinceChoice = 0;
      const nextId = pickNextEventId();
      // lineage death opportunity: once per era, gated on era>=2 and rng
      const lineageDue = !state.seenEvents.includes('LX-death:' + state.era) && state.era >= 2 && rng() < 0.25;
      if (lineageDue) {
        state.pendingEventId = null;
        state.forcedLineage = true;
      } else if (nextId) {
        state.pendingEventId = nextId;
      } else {
        // every scheduled event in this era has played; let the ascent continue
        state.progress = progressTargetForEra();
        state.phase = 'transition';
        state.pendingEventId = null;
      }
    } else {
      state.ticksSinceChoice += 1;
    }
  }

  const progressTargetForEra = () => eraDef().progressTarget;

  function forcedLineageEvent() {
    // exposed for tests/UI introspection; consumption happens in currentEvent()
    return lineageEvent;
  }

  const round2 = (x) => Math.round(x * 100) / 100;

  function advanceEra() {
    if (state.era >= FINALE_ERA) { finalizeEnding(); return; }
    grantEraGoal(state.era); // §9.2: goal completes as the bar fills
    state.era += 1;
    state.progress = 0;
    state.ticksSinceChoice = 0;
    state.phase = 'event';
    resetEra(state.minigames, state.era); // v5 §3: fresh 2-per-era budget each era
    state.pendingEventId = pickNextEventId();
    chronicle(`Era ${state.era} begins: ${eraDef().name}. The pace quickens. It always quickens.`, 'era');
  }

  // ------------------------------------------------------------- era goals (SPEC §9.2)
  // Named per-era goal from v21-copy.json (Scribe copy). The progress bar IS the
  // goal meter: reaching the transition = hitting the goal, UNLESS the lineage
  // explicitly refused it (Era 1: no_fire_mastery locks the Promethean branch).
  function eraGoal(n = state.era) {
    const goals = (copyData && copyData.era_goals) || [];
    return goals.find((g) => g.era === n) || null;
  }
  function eraGoalRefused(n = state.era) {
    if (n === 1) return hasFlag('no_fire_mastery');
    return false;
  }
  // Pay out the goal at the era transition: badge + resource bonus, once per era.
  function grantEraGoal(n = state.era) {
    if (state.eraGoalsDone.includes(n)) return null;
    state.eraGoalsDone.push(n);
    const goal = eraGoal(n);
    if (!goal || eraGoalRefused(n)) return null;
    const badge = ERA_GOAL_BADGES[n] || null;
    if (badge && !state.badges.includes(badge)) state.badges.push(badge);
    state.resources.knowledge = clamp(round2(state.resources.knowledge + 5), -CEILING, CEILING);
    state.resources.legitimacy = clamp(round2(state.resources.legitimacy + 3), -CEILING, CEILING);
    chronicle(`Era ${n} goal “${goal.name}” complete. ${badge ? `+1 badge: ${badge[0].toUpperCase()}${badge.slice(1)}. ` : ''}+5 Knowledge, +3 Legitimacy.`, 'goal');
    return { goal, badge };
  }

  // ------------------------------------------------------------- endings
  function checkEndingConditions(forceStutter = false) {
    if (forceStutter) { state.ending = 'the_long_stutter'; state.phase = 'ending'; return; }
    // Entropy winning outright ends it early (The Long Stutter is a valid loss).
    if (state.resources.entropy >= 100 && state.era < FINALE_ERA) {
      state.ending = 'the_long_stutter';
      state.phase = 'ending';
      chronicle('Entropy reached critical before the finale. The long stutter begins early.', 'ending');
      return;
    }
    // The era-11 FINALE (E11-12, "The Tempo Question") is the last decision of
    // the game: only it evaluates an ending. Other events never finalize, so a
    // run always plays the whole era before the upload story resolves.
    // Safety net: if the finale somehow already played and every other event in
    // era 11 is exhausted, evaluate from the accumulated flags.
    if (state.era === FINALE_ERA && state.seenEvents.includes('E11-12') && eligibleEvents().length === 0) {
      finalizeEnding(undefined);
    }
  }

  function finalizeEnding(preferSeeds) {
    // `preferSeeds` is the authoritative claim list (flags taken AT the finale).
    // An empty array means "no trajectory claimed" — do NOT fall back to the
    // flag history, which still holds mid-era foreshadowing seeds.
    const seeds = preferSeeds !== undefined ? preferSeeds : ['seed_diaspora', 'seed_cathedral', 'seed_stutter', 'seed_bureaucracy'].filter(hasFlag);
    // canonical ending ids (data ids, not raw flag names)
    const SEED_TO_ID = {
      seed_diaspora: 'the_diaspora',
      seed_cathedral: 'the_cathedral',
      seed_stutter: 'the_long_stutter',
      seed_bureaucracy: 'the_bureaucracy_of_ghosts',
    };
    let id;
    if (seeds.length > 0) {
      // most recent seed wins (finale overrides mid-era seeds)
      id = SEED_TO_ID[seeds[seeds.length - 1]];
    } else if (hasFlag('seed_none_claimed') && state.resources.knowledge >= 60 && state.resources.entropy <= 55) {
      // The Ascension: refused every trajectory, crossed the upload comprehensible-adjacent.
      id = 'the_ascension';
    } else if (state.resources.knowledge >= 60 && state.resources.entropy <= 55) {
      id = 'the_ascension';
    } else if (state.resources.entropy >= 70) {
      id = 'the_long_stutter';
    } else if (state.copies >= 3) {
      id = 'the_diaspora';
    } else if (state.copies === 1) {
      id = 'the_cathedral';
    } else {
      id = 'the_bureaucracy_of_ghosts';
    }
    // The Diaspora is the scatter trajectory: claiming it at the finale IS the
    // scatter — unless the lineage explicitly refused every trajectory, which
    // outranks any pool-derived fallback (SPEC §3.4 Ascension).
    if (id === 'the_diaspora' && state.copies < 3 && !seeds.includes('seed_diaspora')) {
      id = 'the_bureaucracy_of_ghosts';
    }
    if (!seeds.length && hasFlag('seed_none_claimed')
        && state.resources.knowledge >= 60 && state.resources.entropy <= 55) {
      id = 'the_ascension';
    }
    state.ending = id;
    state.phase = 'ending';
    chronicle(`Ending reached: ${id.replace(/_/g, ' ')}.`, 'ending');
  }

  function endingText() {
    if (!state.ending) return null;
    return erasData.endings.find((e) => e.id === state.ending) || null;
  }

  // ------------------------------------------------------------- save/load
  function serialize() {
    return JSON.stringify(structuredClone(state));
  }
  function deserialize(json) {
    let s = JSON.parse(json);
    // v3 (§10.6): a v2 save (or older/absent version) migrates forward instead
    // of throwing — era numbers remap through the §10.1 insertion table and
    // Chronicle + lineageMods survive untouched.
    if (isLegacySave(s)) s = migrateV2toV3(s);
    if (s.version !== SAVE_VERSION) throw new Error(`save version mismatch: ${s.version}`);
    Object.assign(state, s);
    if (!Array.isArray(state.badges)) state.badges = []; // pre-v2 saves have no badges
    if (!Array.isArray(state.lineageMods)) state.lineageMods = []; // v2.1
    if (!Array.isArray(state.eraGoalsDone)) state.eraGoalsDone = []; // v2.1
    if (!state.arcs) state.arcs = createArcState(); // v3 arc ledger
    if (!state.minigames) state.minigames = createMinigameTracker(); // v5 §3 (pre-v5 saves)
    harvestModifiers(state.flags); // rebuild modifier pane for saves written pre-v2.1
    return state;
  }
  // Export code: base64url(JSON), offline-safe.
  function exportCode() {
    const bytes = new TextEncoder().encode(serialize());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function importCode(code) {
    let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    deserialize(new TextDecoder().decode(bytes));
    return state;
  }

  // ------------------------------------------------------------- auto-driver (tests, idle mode)
  // Plays the game to completion with a policy(event,state)->choice|null.
  // A null policy response means "abstain": resolve with the first choice that
  // claims no seed flag (or any choice if none qualify).
  function runUntilEnd(policy, maxTicks = 200000) {
    let ticks = 0;
    while (state.phase !== 'ending' && ticks < maxTicks) {
      const ev = currentEvent();
      if (ev) {
        let choice = policy(ev, state);
        if (!choice) choice = ev.choices.find((c) => !c.flags.some((f) => f.startsWith('seed_'))) || ev.choices[0];
        choose(choice.label);
      } else {
        tick();
      }
      ticks += 1;
    }
    return { ending: state.ending, ticks, chronicle: state.chronicle.length };
  }

  return {
    state,
    eraDef,
    eraGoal,
    grantEraGoal,
    poolRate,
    eventCooldown,
    currentEvent,
    forcedLineageEvent,
    choose,
    tick,
    runUntilEnd,
    chronicle,
    hasFlag,
    addFlag,
    applyMinigameReward, // v5 §3: apply capped run rewards + ledger record
    eraMinigame,         // v5 §3: this era's offered family from eras.json
    eligibleEvents,
    endingText,
    serialize,
    deserialize,
    exportCode,
    importCode,
    // direct hooks used by tests and the UI's dev panel
    _setPhase(p) { state.phase = p; },
    _gotoEra(n) { state.era = n; state.progress = 0; state.pendingEventId = pickNextEventId(); },
  };
}
