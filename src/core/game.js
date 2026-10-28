// THE LONG ASCENT — core game logic. Pure: zero DOM imports, runs in node.
// Implements SPEC §3: era state machine (11 eras), 6-pool resource model with
// per-era re-keying, data-driven event engine, choice/flag system, the Lineage
// mechanic (death/heir, fork/merge post-upload, copy-drift), Chronicle log,
// save/load with export codes, and the endings evaluator.

export const POOLS = ['sustenance', 'knowledge', 'population', 'infrastructure', 'legitimacy', 'entropy'];
export const SAVE_VERSION = 1;
const CEILING = 1000;

export function createGame({ erasData, eventsData, rng = Math.random }) {
  const eraDefs = erasData.eras;
  const transitions = new Map(erasData.transitions.map((t) => [t.era, t]));
  const allEvents = eventsData.events;
  const lineageEvent = erasData.lineageEvent;

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
    rngSeedNote: 'rng not serialized; saves resume deterministically from state only',
  };

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
    uploaded: () => state.era >= 11,
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

  // ------------------------------------------------------------- choices
  function choose(choiceLabel) {
    const ev = currentEvent();
    if (!ev) throw new Error('no pending decision');
    const choice = ev.choices.find((c) => c.label === choiceLabel);
    if (!choice) throw new Error(`unknown choice "${choiceLabel}" for ${ev.id}`);

    applyEffects(choice.effects, ev.id);
    for (const f of choice.flags) addFlag(f);
    // Milestone badges (SPEC §4.1): flags that name an upgrade badge light it up.
    const BADGE_FLAG_RE = /^(got_badge|milestone)_([a-z]+)$/;
    for (const f of choice.flags || []) {
      const m = BADGE_FLAG_RE.exec(f);
      if (m && !state.badges.includes(m[2])) state.badges.push(m[2]);
    }
    if (ev.id === 'E11-12') state.lastFinaleFlags = [...choice.flags];

    if (ev.kind === 'transition') {
      advanceEra();
      return { ok: true, era: state.era };
    }
    if (ev.kind === 'lineage') {
      resolveLineageDeath(choice);
      return { ok: true, era: state.era };
    }

    state.seenEvents.push(ev.id);
    chronicle(`Era ${state.era}: Carrier ${roman(state.carrier)} chose “${ev.title}” — ${choice.label}. ${choice.quote || ''}`.trim());
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
      return { ok: true, era: state.era };
    }
    checkEndingConditions();
    return { ok: true, era: state.era };
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

  // Post-upload (Era 11): forks, merges, copy-drift pressure.
  function maybeLateGameLineage() {
    if (state.era < 11) return;
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
  function tick() {
    if (state.phase === 'ending') return;
    const def = eraDef();
    // Entropy pressure scales with the era's tempo: eras that run faster also
    // bill faster, but a careful lineage keeps negative choices in reserve.
    const tempoMult = Math.min(10 / def.ticksPerChoice, 2);
    const rate = def.tickRate;
    for (const p of POOLS) {
      let d = rate[p] || 0;
      if (p === 'sustenance' && state.era >= 10 && hasFlag('attention_corruption')) d *= 0.7; // attention corrupts other pools
      if (p === 'knowledge' && state.era === 4) d = Math.min(d, hasFlag('archive_diligence') ? -0.1 : d); // knowledge decay mini-mechanic
      // Entropy never goes down easily (SPEC §3.1): positive drift always lands,
      // negative effects only bite at half strength.
      if (p === 'entropy' && d < 0) d *= 0.5;
      if (p === 'entropy' && d > 0) d *= Math.min(tempoMult * 0.45, 0.6); // entropy scales with era tempo, survivably
      state.resources[p] = clamp(round2(state.resources[p] + d), p === 'entropy' ? 0 : -CEILING, CEILING);
    }
    state.progress = round2(state.progress + 1);
    state.tickCount += 1;
    if (state.resources.entropy >= 100) { checkEndingConditions(); return; }
    if (state.progress >= def.progressTarget) {
      state.phase = 'transition';
      state.pendingEventId = null;
    } else if (state.ticksSinceChoice >= def.ticksPerChoice) {
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
        state.progress = def.progressTarget;
        state.phase = 'transition';
        state.pendingEventId = null;
      }
    } else {
      state.ticksSinceChoice += 1;
    }
  }

  function forcedLineageEvent() {
    // exposed for tests/UI introspection; consumption happens in currentEvent()
    return lineageEvent;
  }

  const round2 = (x) => Math.round(x * 100) / 100;

  function advanceEra() {
    if (state.era >= 11) { finalizeEnding(); return; }
    state.era += 1;
    state.progress = 0;
    state.ticksSinceChoice = 0;
    state.phase = 'event';
    state.pendingEventId = pickNextEventId();
    chronicle(`Era ${state.era} begins: ${eraDef().name}. The pace quickens. It always quickens.`, 'era');
  }

  // ------------------------------------------------------------- endings
  function checkEndingConditions(forceStutter = false) {
    if (forceStutter) { state.ending = 'the_long_stutter'; state.phase = 'ending'; return; }
    // Entropy winning outright ends it early (The Long Stutter is a valid loss).
    if (state.resources.entropy >= 100 && state.era < 11) {
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
    if (state.era === 11 && state.seenEvents.includes('E11-12') && eligibleEvents().length === 0) {
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
    const s = JSON.parse(json);
    if (s.version !== SAVE_VERSION) throw new Error(`save version mismatch: ${s.version}`);
    Object.assign(state, s);
    if (!Array.isArray(state.badges)) state.badges = []; // pre-v2 saves have no badges
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
    currentEvent,
    forcedLineageEvent,
    choose,
    tick,
    runUntilEnd,
    chronicle,
    hasFlag,
    addFlag,
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
