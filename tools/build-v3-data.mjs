// tools/build-v3-data.mjs — Forge v3 (SPEC §10.1/§10.6): expand eras.json 11→17
// and merge Scribe's v3-copy events into events.json. Deterministic + idempotent:
// ALWAYS rebuilds from the pristine git baseline (origin/main), so re-running is
// safe even after a previous run modified the working-tree data files.
//
// Inputs:  origin/main eras.json (11 eras) + events.json (132 events),
//          src/data/v3-copy.json (Scribe: 6 new eras + 104 events + arcs).
// Outputs: src/data/eras.json (17 eras), src/data/events.json (236 events),
//          src/data/v3-goals.json, src/data/v3-mini.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(R, ...s);
const readJson = (f) => JSON.parse(readFileSync(p(f), 'utf8'));
const writeJson = (f, o) => writeFileSync(p(f), JSON.stringify(o, null, 2) + '\n');

const erasData = JSON.parse(execSync(`git show origin/main:src/data/eras.json`, { cwd: R, maxBuffer: 64 * 1024 * 1024 }).toString());
const eventsData = JSON.parse(execSync(`git show origin/main:src/data/events.json`, { cwd: R, maxBuffer: 64 * 1024 * 1024 }).toString());
const v3 = readJson('src/data/v3-copy.json');
// SPEC §10.1's example numbering (4,5,8,10,12,16) contradicts its own chronological "between" text;
// history wins (Sails AFTER Renaissance). Scribe keyed copy by the example numbers -> remap to spine:
// sails 4->6, revolution 5->7, wars 8->10, orbit 10->12, green 12->14, silence 16->16.
const COPY_ERA_REMAP = { 4: 6, 5: 7, 8: 10, 10: 12, 12: 14, 16: 16 };
v3.eras = v3.eras.map((e) => ({ ...e, num: COPY_ERA_REMAP[e.num] ?? e.num }));
v3.events = v3.events.map((e) => ({ ...e, era: COPY_ERA_REMAP[e.era] ?? e.era }));
for (const k of Object.keys(v3.chapter_cards || {})) {
  const nn = COPY_ERA_REMAP[Number(k)];
  if (nn && String(nn) !== k) { v3.chapter_cards[String(nn)] = v3.chapter_cards[k]; delete v3.chapter_cards[k]; }
}
v3.opportunities = (v3.opportunities || []).map((o) => ({ ...o, era: COPY_ERA_REMAP[o.era] ?? o.era }));

// ---------------------------------------------------------------- era insertion
// SPEC §10.1: the 6 new eras insert at NEW positions in the 17-era spine:
//   Sails between Renaissance(3) and Industry(old4)      -> new num 4
//   Revolution between Sails and Industry                 -> new num 5
//   World Wars between American Century(old6) and Atomic(old7) -> new num 8
//   Space Age between Atomic(old7) and Digital(old8)      -> new num 10
//   Green Transition between Digital(old8) and Connected(old9) -> new num 12
//   Long Silence between Singularity(old11) and final(old12->17) -> new num 16
// Copy keys them by these same final nums; legacy eras keep display order.
// OLD_TO_NEW is the save-migration table (SPEC §10.1 / §11 migration v2->v3).
const LEGACY_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // old nums in order
// SPEC §10.1 canonical 17-era spine (explicit, no insertion-table ambiguity):
// 1 Cave, 2 Ag, 3 Bronze, 4 Dark, 5 Renaissance, 6 SAILS(copy4), 7 REVOLUTION(copy5),
// 8 Industry, 9 American, 10 WARS(copy8), 11 Atomic, 12 ORBIT(copy10), 13 Digital,
// 14 GREEN(copy12), 15 Connected, 16 SILENCE(copy16), 17 Singularity
const SPINE = [
  { newNum: 1,  oldNum: 1,  copyNum: null },
  { newNum: 2,  oldNum: 2,  copyNum: null },
  { newNum: 3,  oldNum: 3,  copyNum: null },
  { newNum: 4,  oldNum: 4,  copyNum: null },
  { newNum: 5,  oldNum: 5,  copyNum: null },
  { newNum: 6,  oldNum: null, copyNum: 6 },
  { newNum: 7,  oldNum: null, copyNum: 7 },
  { newNum: 8,  oldNum: 6,  copyNum: null },
  { newNum: 9,  oldNum: 7,  copyNum: null },
  { newNum: 10, oldNum: null, copyNum: 10 },
  { newNum: 11, oldNum: 8,  copyNum: null },
  { newNum: 12, oldNum: null, copyNum: 12 },
  { newNum: 13, oldNum: 9,  copyNum: null },
  { newNum: 14, oldNum: null, copyNum: 14 },
  { newNum: 15, oldNum: 10, copyNum: null },
  { newNum: 16, oldNum: null, copyNum: 16 },
  { newNum: 17, oldNum: 11, copyNum: null },
];
const OLD_TO_NEW = {};
for (const s of SPINE) if (s.oldNum != null) OLD_TO_NEW[s.oldNum] = s.newNum;

// Per-era tick pacing: smooth monotone curve 10 (era 1) → 4 (era 17); the new
// eras smooth the old 10..4 staircase (SPEC §10.6 "ticksPerChoice trending 10→4").
const TICKS_PER_CHOICE = { 1: 10, 2: 9, 3: 9, 4: 8, 5: 8, 6: 8, 7: 7, 8: 7, 9: 7, 10: 6, 11: 6, 12: 6, 13: 6, 14: 5, 15: 5, 16: 5, 17: 4 };

// Tick rates for the 6 new eras (Forge-authored sim values; copy comes from Scribe).
// Shape follows neighbors: sails=trade wealth, revolution=legitimacy wars, wars=mobilized
// industry + heavy entropy, orbit=prestige/knowledge surge, green=first true entropy counters
// (negative entropy drift), void=sparse interstellar economy (low income, drift-management).
const NEW_TICK_RATE = {
  6: { sustenance: 6, knowledge: 1.0, population: 0.7, infrastructure: 0.8, legitimacy: 0.3, entropy: 0.15 },
  7: { sustenance: 5, knowledge: 1.2, population: 0.8, infrastructure: 0.6, legitimacy: 0.8, entropy: 0.25 },
  10: { sustenance: 8, knowledge: 2.2, population: 0.6, infrastructure: 1.4, legitimacy: 0.4, entropy: 1.4 },
  12: { sustenance: 8, knowledge: 2.8, population: 0.9, infrastructure: 1.1, legitimacy: 0.5, entropy: 0.7 },
  14: { sustenance: 9, knowledge: 2.2, population: 1.0, infrastructure: 1.0, legitimacy: 0.3, entropy: -0.15 },
  16: { sustenance: 5, knowledge: 1.6, population: 0.4, infrastructure: 0.5, legitimacy: 0.2, entropy: 0.3 },
};

// ------------------------------------------------------------------ build eras
const oldEraByNum = new Map(erasData.eras.map((e) => [e.num, e]));
const copyEraByNum = new Map(v3.eras.map((e) => [e.num, e]));
const outEras = [];
for (const slot of SPINE) {
  if (slot.oldNum == null) {
    const src = copyEraByNum.get(slot.copyNum);
    if (!src) throw new Error(`v3-copy missing era ${slot.copyNum}`);
    outEras.push({
      num: slot.newNum,
      name: src.name.toUpperCase(),
      intro: src.intro,
      signatureResource: src.signatureResource,
      sustenanceLabel: src.sustenanceLabel,
      progressTarget: 100,
      ticksPerChoice: TICKS_PER_CHOICE[slot.newNum],
      tickRate: NEW_TICK_RATE[slot.copyNum],
      eraGoal: src.eraGoal,
    });
  } else {
    const src = oldEraByNum.get(slot.oldNum);
    if (!src) throw new Error(`old era ${slot.oldNum} missing`);
    outEras.push({ ...src, num: slot.newNum, ticksPerChoice: TICKS_PER_CHOICE[slot.newNum], progressTarget: 100 });
  }
}

// ------------------------------------------------------- transitions re-keying
// Transitions are per-era-slot; renumber onto the 17-slot spine. New-era slots
// reuse the generic inheritance prompt (same contract as every T-slot) with the
// flag suffix re-keyed to the new num.
const oldTrans = new Map(erasData.transitions.map((t) => [t.era, t]));
const rekeyFlags = (t, num) => ({ ...t, choices: t.choices.map((c) => ({ ...c, flags: (c.flags || []).map((f) => f.replace(/_\d+$/, `_${num}`)) })) });
const outTransitions = [];
for (const slot of SPINE) {
  const tpl = slot.oldNum == null ? oldTrans.get(2) : oldTrans.get(slot.oldNum);
  if (!tpl) throw new Error(`transition for era ${slot.oldNum} missing`);
  outTransitions.push({ ...rekeyFlags(tpl, slot.newNum), era: slot.newNum, id: `T${slot.newNum}` });
}

erasData.eras = outEras;
erasData.transitions = outTransitions;
writeJson('src/data/eras.json', erasData);

// ---------------------------------------------------------------- era goals
// v21-copy.json holds era_goals keyed by OLD era nums; game.js looks them up
// there. Re-key onto the 17-era spine and append the 6 new eraGoal objects from
// v3-copy so goal payouts follow the new numbering.
const oldGoals = (readJson('src/data/v21-copy.json').era_goals || []).map((g) => ({ ...g, era: OLD_TO_NEW[g.era] }));
for (const slot of SPINE) {
  if (slot.oldNum == null) {
    const src = copyEraByNum.get(slot.copyNum);
    if (src && src.eraGoal) oldGoals.push({ era: slot.newNum, name: src.eraGoal.name, description: src.eraGoal.description });
  }
}
oldGoals.sort((a, b) => a.era - b.era);
writeJson('src/data/v3-goals.json', { version: '3.0', source: 'SPEC §10: era_goals re-keyed to the 17-era spine (v21-copy old nums -> new nums via §10.1 insertion table) + 6 new eraGoal objects from v3-copy.json.', era_goals: oldGoals });

// ------------------------------------------------------- mini-events sidecar
// Opportunities / crisis pulses / chapter cards / crossing copy are consumed by
// dedicated v3 modules (core/opportunities.js, core/crisisPulses.js, ui, crossing).
// Extract verbatim so nothing depends on loading the full Scribe deck at runtime.
writeJson('src/data/v3-mini.json', {
  version: '3.0',
  source: 'SPEC §10.3/§10.2/§11 — extracted verbatim from v3-copy.json by tools/build-v3-data.mjs.',
  opportunities: v3.opportunities,
  crisis_pulses: v3.crisis_pulses,
  chapter_cards: v3.chapter_cards,
  crossing: v3.crossing,
});

// ------------------------------------------------------------------ merge events
// Schema reconciliation (SPEC §10.6 / Scribe schema): v3 events carry
// choices[{label, effect{pool}, quote}] + event-level `flag`; engine schema is
// choices[{label, effects{}, flags[], quote}]. Normalize on merge. The v3 `arc`
// field is preserved verbatim (the arc state machine reads it).
function normalizeV3Event(ev, id) {
  return {
    id,
    scene_id: ev.scene_id,
    era: ev.era,
    title: ev.title,
    arc: ev.arc ?? null,
    body: ev.body,
    requirements: [],
    choices: ev.choices.map((c) => {
      const flags = [];
      // event-level flag fires on any choice unless the choice opts out via `no_flag`
      if (ev.flag && !c.no_flag) flags.push(ev.flag);
      for (const f of c.flags || []) if (!flags.includes(f)) flags.push(f);
      const out = { label: c.label, effects: { ...(c.effect ?? c.effects ?? {}) }, flags };
      if (c.quote) out.quote = c.quote;
      return out;
    }),
  };
}

const seenIds = new Set(eventsData.events.map((e) => e.id));
// Legacy events carry OLD era numbers; rekey through the migration table (Forge's self-diagnosis + SPEC §10.1).
const merged = eventsData.events.map((e) => ({ ...e, era: OLD_TO_NEW[e.era] ?? e.era }));
let added = 0;
for (const raw of v3.events) {
  // v3 ids are era-keyed and can collide with legacy ids after renumbering
  // (legacy E4-01 vs Sails E4-01). Namespace the NEW ones as <id>n.
  let id = raw.id;
  if (seenIds.has(id)) id = `${id}n`;
  if (seenIds.has(id)) throw new Error(`event id collision: ${id}`);
  seenIds.add(id);
  merged.push(normalizeV3Event(raw, id));
  added++;
}
merged.sort((a, b) => (a.era - b.era) || a.id.localeCompare(b.id, 'en', { numeric: true }));
writeJson('src/data/events.json', { events: merged });

// ------------------------------------------------------------------- verification
const perEra = {};
for (const e of merged) perEra[e.era] = (perEra[e.era] || 0) + 1;
console.log('eras:', outEras.length, '| ticksPerChoice:', outEras.map((e) => e.ticksPerChoice).join(','));
console.log('events:', merged.length, `(added ${added})`, '| per era:', JSON.stringify(perEra));
console.log('old->new map:', JSON.stringify(OLD_TO_NEW));
const bad = merged.filter((e) => e.era < 1 || e.era > 17);
if (bad.length) throw new Error(`events outside 1..17: ${bad.map((e) => e.id).join(',')}`);
const monotonic = outEras.every((e, i) => i === 0 || e.ticksPerChoice <= outEras[i - 1].ticksPerChoice);
if (!monotonic) throw new Error('ticksPerChoice not monotone');
console.log('OK');
