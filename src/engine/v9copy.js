// src/engine/v9copy.js — SPEC v9 §9: Scribe's v9 copy pack wired into the world.
// Pure module (no DOM): looks up missed-station report lines, the walk-away row,
// dimmed-choice reasons, almanac labels, render-fault copy and station-UI hints
// from research/v9-copy.json. Text only — scheduling lives in the station system;
// placement lives in the chrome layer. Mirrors the copy-v8.js pattern.

/** Index the copy doc once at boot; missing doc degrades to safe fallbacks. */
export function loadV9Copy(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  return {
    doc: d,
    missedLines(era) {
      const v = (d.missed_stations || {})[`era_${Math.min(17, Math.max(1, era | 0))}`];
      return Array.isArray(v) ? v : [];
    },
    /** Rotating missed-station line (deterministic on the supplied rng). */
    missedLine(era, rng = Math.random) {
      const lines = this.missedLines(era);
      if (!lines.length) return null;
      const i = Math.floor((typeof rng === 'function' ? rng() : 0) * lines.length) % lines.length;
      return lines[i];
    },
    walkAwayLines() { return Array.isArray(d.walk_away) ? d.walk_away : []; },
    walkAwayLine(rng = Math.random) {
      const lines = this.walkAwayLines();
      if (!lines.length) return 'Walk away.';
      return lines[Math.floor((typeof rng === 'function' ? rng() : 0) * lines.length) % lines.length];
    },
    dimReason(key, fallback = 'Unavailable now') {
      const dr = d.dim_reasons || {};
      return dr[key] || fallback;
    },
    almanac() { return d.almanac_labels || {}; },
    renderFault() { return d.render_fault || { stripe: 'RENDER FAULT — press R.', toast: 'Paused on the last good frame. Press R.' }; },
    stationUi() {
      return d.station_ui || { select_hint: '↑↓ select · ⏎ commit', commit_hint: '⏎ commits.', leave_hint: 'Esc leaves it open.', consequence_pending: 'The consequences are walking over.' };
    },
  };
}

/**
 * The dim-reason key for an unmet action choice, so Scribe's copy replaces the
 * raw requirement string. Reads the choice's action mark (actionChoices.js).
 * Falls back to a pool-based key when the choice carries an explicit pool gate.
 */
export function dimReasonKeyFor(choice) {
  const a = choice?.action;
  if (a && a.verb) {
    if (a.item && ['stone', 'spear', 'torch', 'credit', 'coin'].includes(a.item)) return `no_item_${a.item}`;
    if (a.verb === 'climb') return 'verb_climb';
    if (a.verb === 'sneak') return 'verb_sneak';
  }
  const pool = choice?.pool_gate || choice?.requirement_pool;
  if (pool) return `pool_too_low_${pool}`;
  return null;
}

/** First hazard death of an era / era-entry-with-hunger ambient triggers (§1.3). */
export function ambientHookLine(hook, { era, echoesDoc, collapseDoc } = {}) {
  if (hook === 'first-hazard-death') {
    // echoes-v8 copy re-purposed as a caption: the era's first echo line stands in.
    const lines = (echoesDoc?.echoes || []).filter((e) => String(e.id).startsWith(`E${era}-`));
    return lines.length ? { text: lines[0].text, source: 'echo' } : null;
  }
  if (hook === 'low-sustenance-entry') {
    const reasons = collapseDoc?.reasons || [];
    const gen = reasons.find((r) => r.source === 'generic');
    return gen ? { text: gen.text, source: 'collapse' } : null;
  }
  return null;
}
