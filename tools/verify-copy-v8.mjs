// Scribe v8 copy verifier — SPEC-v8-undeniable.md §3 deliverables.
// Checks research/ambient-v8.json (68 lines, 4/era, ≤60 chars),
// research/echoes-v8.json (154 echoes, ids exactly = action-marked encounters, ≤70 chars),
// research/collapse-v8.json (9 reasons, 8 sources + generic, ≤50 chars),
// and SPEC §8 naming: no source-novel proper nouns (Reef/Consortia/Feral/Benthics only).
// Run: node tools/verify-copy-v8.mjs
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const errors = [];
const err = (m) => errors.push(m);

const load = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const charLen = (s) => [...s].length; // codepoint length

// --- reference data -----------------------------------------------------
const encs = load('research/encounters-v6.json').encounters;
const ac = load('research/action-choices-v7.json').markups;
const markedIds = new Set(ac.map((m) => m.id));
const encIds = new Set(encs.map((e) => e.id));

// --- 1. ambient-v8.json --------------------------------------------------
const amb = load('research/ambient-v8.json');
if (!Array.isArray(amb.lines)) err('ambient-v8.json: missing "lines" array');
else {
  if (amb.lines.length !== 68) err(`ambient: expected 68 lines, got ${amb.lines.length}`);
  const perEra = new Map();
  for (const [i, l] of amb.lines.entries()) {
    if (!(Number.isInteger(l.era) && l.era >= 1 && l.era <= 17))
      err(`ambient[${i}]: era out of range: ${JSON.stringify(l.era)}`);
    if (typeof l.text !== 'string' || l.text.length === 0)
      err(`ambient[${i}]: missing text`);
    else if (charLen(l.text) > 60)
      err(`ambient[${i}] (era ${l.era}): >60 chars (${charLen(l.text)}): "${l.text}"`);
    perEra.set(l.era, (perEra.get(l.era) || 0) + 1);
  }
  for (let e = 1; e <= 17; e++)
    if ((perEra.get(e) || 0) !== 4) err(`ambient: era ${e} has ${perEra.get(e) || 0} lines, expected 4`);
}

// --- 2. echoes-v8.json ---------------------------------------------------
const ech = load('research/echoes-v8.json');
if (!Array.isArray(ech.echoes)) err('echoes-v8.json: missing "echoes" array');
else {
  if (ech.echoes.length !== 154) err(`echoes: expected 154, got ${ech.echoes.length}`);
  const seen = new Set();
  for (const [i, e] of ech.echoes.entries()) {
    if (typeof e.id !== 'string') { err(`echoes[${i}]: missing id`); continue; }
    if (seen.has(e.id)) err(`echoes[${i}]: duplicate id ${e.id}`);
    seen.add(e.id);
    if (!encIds.has(e.id)) err(`echoes[${i}]: id ${e.id} not in encounters-v6.json`);
    if (typeof e.text !== 'string' || e.text.length === 0) err(`echoes[${i}] (${e.id}): missing text`);
    else if (charLen(e.text) > 70)
      err(`echoes[${i}] (${e.id}): >70 chars (${charLen(e.text)}): "${e.text}"`);
  }
  for (const id of markedIds) if (!seen.has(id)) err(`echoes: missing echo for action-marked encounter ${id}`);
  for (const id of seen) if (!markedIds.has(id)) err(`echoes: extra echo ${id} (not action-marked)`);
}

// --- 3. collapse-v8.json -------------------------------------------------
const col = load('research/collapse-v8.json');
const WANT_SOURCES = ['boar', 'wolf', 'stray_dog', 'bandit', 'soldier', 'smog', 'radiation', 'datastorm', 'generic'];
if (!Array.isArray(col.reasons)) err('collapse-v8.json: missing "reasons" array');
else {
  if (col.reasons.length !== 9) err(`collapse: expected 9 reasons, got ${col.reasons.length}`);
  const got = new Set();
  for (const [i, r] of col.reasons.entries()) {
    if (!WANT_SOURCES.includes(r.source)) err(`collapse[${i}]: unexpected source ${JSON.stringify(r.source)}`);
    if (got.has(r.source)) err(`collapse[${i}]: duplicate source ${r.source}`);
    got.add(r.source);
    if (typeof r.text !== 'string' || r.text.length === 0) err(`collapse[${i}] (${r.source}): missing text`);
    else if (charLen(r.text) > 50)
      err(`collapse[${i}] (${r.source}): >50 chars (${charLen(r.text)}): "${r.text}"`);
  }
  for (const s of WANT_SOURCES) if (!got.has(s)) err(`collapse: missing source "${s}"`);
}

// --- SPEC §8 naming: banned source-novel proper nouns --------------------
// Allowed faction vocabulary: Reef, Consortia, Feral, Benthic(s). Everything else
// source-novel is banned. Same list as verify-action-choices-v7.mjs, extended.
const BANNED = [
  'Revelation Space', 'Conjoiner', 'Hydronaut', 'Inhibitor', 'Wendell', 'Trine',
  'Skade', 'Kamio', 'Ana Khouri', 'Raven', 'Matka', 'Vasque', 'Brant',
];
for (const file of ['research/ambient-v8.json', 'research/echoes-v8.json', 'research/collapse-v8.json']) {
  const raw = readFileSync(new URL(file, ROOT), 'utf8');
  for (const w of BANNED)
    if (new RegExp(`\\b${w}\\b`, 'i').test(raw))
      err(`${file}: SPEC §8 violation — banned source-novel name "${w}" present`);
}

// --- summary --------------------------------------------------------------
console.log(`ambient lines:        ${amb.lines?.length ?? 0}/68 (4 per era x 17)`);
console.log(`echoes:               ${ech.echoes?.length ?? 0}/154 (ids == action-marked encounters: ${markedIds.size})`);
console.log(`collapse reasons:     ${col.reasons?.length ?? 0}/9 (8 sources + generic)`);
if (errors.length) {
  console.error(`\nFAIL — ${errors.length} error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nPASS — all v8 copy checks green.');
