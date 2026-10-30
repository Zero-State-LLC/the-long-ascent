// Generate research/action-choices-v7.json from tools/v7-action-markup.mjs.
// Emits ONLY choices whose label exists verbatim in encounters-v6.json (asserted).
import { readFileSync, writeFileSync } from 'node:fs';
import { MARKUP } from './v7-action-markup.mjs';

const encs = JSON.parse(readFileSync(new URL('../research/encounters-v6.json', import.meta.url))).encounters;
const byId = new Map(encs.map(e => [e.id, e]));

const markups = [];
let markedChoices = 0;
for (const [id, idxMap] of Object.entries(MARKUP)) {
  const enc = byId.get(id);
  if (!enc) throw new Error(`Unknown encounter id in markup: ${id}`);
  const entries = Object.entries(idxMap).map(([i, v]) => [Number(i), v]).sort((a, b) => a[0] - b[0]);
  if (entries.length > 2) throw new Error(`${id}: more than 2 marked choices`);
  const choices = [];
  for (const [i, [verb, item, requirement]] of entries) {
    const c = (enc.choices || [])[i];
    if (!c) throw new Error(`${id}: no choice at index ${i}`);
    choices.push({ label: c.label, action: { verb, item, requirement } });
    markedChoices++;
  }
  markups.push({ id, choices });
}

const out = { markups };
writeFileSync(new URL('../research/action-choices-v7.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`encounters total: ${encs.length}`);
console.log(`encounters with >=1 action-choice: ${markups.length} (${(100 * markups.length / encs.length).toFixed(1)}%)`);
console.log(`marked choices: ${markedChoices}`);
