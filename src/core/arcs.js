// src/core/arcs.js — SPEC §10.2: the three v3 story arcs as a pure state machine.
//
// Arcs ride on game state (`state.arcs`) and are driven by the event deck: every
// v3 event carries `arc: "custodian" | "benthic" | "rival"` plus a per-choice
// `flag` (custodian_relic_*, benthic_deal_ledger, rival_mirror_*). This module
// owns the ledger math; game.js owns when to call it.

export const ARC_KINDS = ['custodian', 'benthic', 'rival'];

// §10.2: each outstanding deal compounds +0.8 entropy at every era transition
// after the one it was taken in ("credit now, interest later").
export const BENTHIC_COMPOUND = 0.8;

// Custodian presence beats: relic chain eras + the final convergence (SPEC §10.2).
export const CUSTODIAN_ERAS = [4, 7, 9, 12, 14, 16];

/** Fresh arc state for a new lineage. */
export function createArcState() {
  return {
    custodian: { relics: [], presence: null }, // presence: last era the Custodian was felt
    benthic: { deals: [] },                    // [{ era, title }]
    rival: { mirrorChoices: [] },              // [{ era, choice: 'mirror' | 'diverge' }]
  };
}

/**
 * Observe one resolved event. Pure: returns a NEW arc state.
 * `event` may be null/legacy (no arc field) -> state unchanged.
 * `choiceFlags` = the chosen choice's flag(s) (string or array).
 */
export function observeEvent(arcs, event, choiceFlags = []) {
  const next = structuredClone(arcs || createArcState());
  if (!event || !ARC_KINDS.includes(event.arc)) return next;
  const flags = (Array.isArray(choiceFlags) ? choiceFlags : [choiceFlags]).filter(Boolean);
  const era = event.era;

  if (event.arc === 'custodian') {
    next.custodian.presence = era;
    for (const f of flags) {
      // Scribe's per-era Custodian beats carry flags like custodian_sails/_ledger/
      // _bunker/_orbit/_vault/_choice — any custodian_* flag marks a relic stop.
      if (/^custodian_/.test(f) && !next.custodian.relics.includes(f)) next.custodian.relics.push(f);
    }
    // Every custodian scene registers presence even without a relic flag.
    if (!flags.length && !next.custodian.relics.includes(`custodian_seen_e${era}`)) {
      next.custodian.relics.push(`custodian_seen_e${era}`);
    }
  } else if (event.arc === 'benthic') {
    // A deal is on the ledger when the choice takes on Benthic paper: an explicit
    // ledger/settle flag, or the debt-bearing copy flags (cryo sleep = borrowed time).
    const tookDeal = flags.some((f) => /^(benthic_deal|cryo_debt)/.test(f));
    const paidOff = flags.some((f) => /^benthic_settled/.test(f));
    if (paidOff) {
      next.benthic.settled = true;
      next.benthic.deals = []; // "All Loans Come Due" clears the book however it resolves
    } else if (tookDeal && !next.benthic.deals.some((d) => d.era === era)) {
      next.benthic.deals.push({ era, title: event.title || `Era ${era} deal` });
    }
  } else if (event.arc === 'rival') {
    // Scribe keys rival beats by scene (rival_west, rival_ennobled, ...): each one
    // records whichever way the lineage faced its mirror. Diverge reads are the
    // explicit ones; everything else at a mirror scene counts as mirroring.
    const kind = flags.some((f) => /diverge|opposite_flag|concede/.test(f)) ? 'diverge' : 'mirror';
    if (flags.some((f) => /^rival_/.test(f))) next.rival.mirrorChoices.push({ era, choice: kind });
  }
  return next;
}

/**
 * Era transition hook (§10.2): every Benthic deal taken BEFORE `newEra` adds
 * +0.8 entropy once per transition. Returns { arcs, entropyDelta }.
 * Deals are never mutated — the debt is due at every crossing until paid off
 * (a payoff removes the deal via settleBenthicDeal).
 */
export function applyTransitionEntropy(arcs, newEra) {
  const due = (arcs?.benthic?.deals || []).filter((d) => d.era < newEra).length;
  return { arcs, entropyDelta: round1(due * BENTHIC_COMPOUND) };
}

/** Pay off a deal early (rival-arc "buy your debt out" beats): removes it from the ledger. */
export function settleBenthicDeal(arcs, era) {
  const next = structuredClone(arcs);
  next.benthic.deals = next.benthic.deals.filter((d) => d.era !== era);
  return next;
}

/** True when this era should surface a Custodian presence beat. */
export function custodianPresenceDue(arcs, era) {
  return CUSTODIAN_ERAS.includes(era);
}

/** Rival summary: 'mirror' dominant, 'diverge' dominant, or 'mixed'. */
export function rivalStance(arcs) {
  const choices = arcs?.rival?.mirrorChoices || [];
  if (!choices.length) return 'none';
  const mirrors = choices.filter((c) => c.choice === 'mirror').length;
  if (mirrors === choices.length) return 'mirror';
  if (mirrors === 0) return 'diverge';
  return 'mixed';
}

/**
 * Convergence inputs for the final-era event (SPEC §10.2: "Final-era event reads
 * all three"): relic count, outstanding deal count, rival stance.
 */
export function convergenceSummary(arcs) {
  const a = arcs || createArcState();
  return {
    relics: a.custodian.relics.filter((r) => !r.startsWith('custodian_seen')).length,
    sawCustodian: a.custodian.presence != null,
    openDeals: a.benthic.deals.length,
    dealEras: a.benthic.deals.map((d) => d.era),
    rivalStance: rivalStance(a),
  };
}

/** Attach arc state to a loaded save that predates v3 arcs (idempotent). */
export function migrateInto(state) {
  if (!state.arcs) state.arcs = createArcState();
  else {
    state.arcs.custodian = state.arcs.custodian || { relics: [], presence: null };
    state.arcs.benthic = state.arcs.benthic || { deals: [] };
    state.arcs.rival = state.arcs.rival || { mirrorChoices: [] };
  }
  return state.arcs;
}

const round1 = (n) => Math.round(n * 10) / 10;
