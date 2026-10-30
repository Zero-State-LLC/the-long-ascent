// Validate Scribe v7 deliverables against SPEC-v7-actions.md §4 + contract.
// Checks: JSON parses; ids exist; labels verbatim; <=2 marks/encounter; verbs legal;
// items legal; requirements <=8 words; gates: 17, one per era, kinds legal, sign <=12 words;
// no source-novel proper nouns (SPEC §8: Reef/Consortia/Feral/Benthics only).
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT)));

const encs = readJson('research/encounters-v6.json').encounters;
const ac = readJson('research/action-choices-v7.json');
const gatesDoc = readJson('research/gates-v7.json');

const errors = [];
const err = (m) => errors.push(m);

const VERBS = new Set(['climb', 'sneak', 'throw', 'pay', 'gather', 'light']);
const BASE_ITEMS = new Set(['torch', 'spear', 'stone', 'coin', 'credit', 'none']);
const wordCount = (s) => s.trim().split(/\s+/).length;

// --- action-choices ---
if (!Array.isArray(ac.markups)) err('action-choices: missing markups array');
const byId = new Map(encs.map((e) => [e.id, e]));
const seenIds = new Set();
let markedChoices = 0;
for (const m of ac.markups || []) {
  const enc = byId.get(m.id);
  if (!enc) { err(`${m.id}: not an encounter id in encounters-v6.json`); continue; }
  if (seenIds.has(m.id)) err(`${m.id}: duplicate markup entry`);
  seenIds.add(m.id);
  if (!Array.isArray(m.choices) || m.choices.length === 0) err(`${m.id}: empty choices`);
  if ((m.choices || []).length > 2) err(`${m.id}: more than 2 marked choices`);
  for (const c of m.choices || []) {
    markedChoices++;
    if (!enc.choices.some((ec) => ec.label === c.label))
      err(`${m.id}: label not verbatim in encounters-v6.json: ${JSON.stringify(c.label)}`);
    const a = c.action || {};
    if (!VERBS.has(a.verb)) err(`${m.id}/${c.label}: bad verb ${JSON.stringify(a.verb)}`);
    if (typeof a.item !== 'string' || a.item.length === 0)
      err(`${m.id}/${c.label}: item must be a non-empty string`);
    else if (!BASE_ITEMS.has(a.item) && !/^[a-z][a-z -]*$/.test(a.item))
      err(`${m.id}/${c.label}: odd era-item name ${JSON.stringify(a.item)} (lowercase words)`);
    if (typeof a.requirement !== 'string' || a.requirement.length === 0)
      err(`${m.id}/${c.label}: missing requirement text`);
    else if (wordCount(a.requirement) > 8)
      err(`${m.id}/${c.label}: requirement >8 words (${wordCount(a.requirement)}): "${a.requirement}"`);
  }
}

// --- gates ---
const gates = gatesDoc.gates;
if (!Array.isArray(gates) || gates.length !== 17) err(`gates: expected 17, got ${gates ? gates.length : 'none'}`);
const eras = new Set();
for (const g of gates || []) {
  if (!(g.era >= 1 && g.era <= 17)) err(`gate era out of range: ${g.era}`);
  if (eras.has(g.era)) err(`duplicate gate for era ${g.era}`);
  eras.add(g.era);
  if (typeof g.advantage !== 'string' || g.advantage.length === 0) err(`era ${g.era}: missing advantage`);
  const r = g.requirement || {};
  if (!['item', 'resource', 'action'].includes(r.kind)) err(`era ${g.era}: bad requirement kind ${JSON.stringify(r.kind)}`);
  if (typeof r.key !== 'string' || r.key.length === 0) err(`era ${g.era}: missing requirement key`);
  if (!(r.amount === null || typeof r.amount === 'number')) err(`era ${g.era}: amount must be number or null`);
  if (typeof g.sign !== 'string' || g.sign.length === 0) err(`era ${g.era}: missing sign`);
  else if (wordCount(g.sign) > 12) err(`era ${g.era}: sign >12 words (${wordCount(g.sign)}): "${g.sign}"`);
}
for (let i = 1; i <= 17; i++) if (!eras.has(i)) err(`missing gate for era ${i}`);

// --- SPEC §8 naming: only Reef/Consortia/Feral/Benthics allowed as faction names ---
const BANNED = ['Revelation Space', 'Conjoiner', 'Hydronaut', 'Inhibitor', 'Wendell', 'Trine', 'Skade', 'Kamio', 'Ana Khouri', 'Raven'];
const rawAC = readFileSync(new URL('research/action-choices-v7.json', ROOT), 'utf8');
const rawG = readFileSync(new URL('research/gates-v7.json', ROOT), 'utf8');
for (const w of BANNED) {
  if (new RegExp(`\\b${w}\\b`, 'i').test(rawAC) || new RegExp(`\\b${w}\\b`, 'i').test(rawG))
    err(`SPEC §8 violation: banned source-novel name "${w}" present`);
}

// --- summary ---
const pct = ((seenIds.size / encs.length) * 100).toFixed(1);
console.log(`encounters total:            ${encs.length}`);
console.log(`encounters with action-mark: ${seenIds.size} (${pct}% — target 60–70%)`);
console.log(`marked choices:              ${markedChoices}`);
const verbTally = {};
for (const m of ac.markups || []) for (const c of m.choices) verbTally[c.action.verb] = (verbTally[c.action.verb] || 0) + 1;
console.log(`verbs:                       ${JSON.stringify(verbTally)}`);
console.log(`gates:                       ${gates.length} (eras ${[...eras].sort((a, b) => a - b).join(',')})`);
if (errors.length) {
  console.error(`\nFAIL — ${errors.length} error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nPASS: all checks clean.');
