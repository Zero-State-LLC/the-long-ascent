#!/usr/bin/env node
// Generate src/data/eras.json + src/data/events.json from research/copy-deck.md.
// Copy text is taken VERBATIM from the deck; effect magnitudes are engine-side
// (derived from the deck's +/- notation), never rewrites of Scribe's copy.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deck = readFileSync(path.join(ROOT, 'research', 'copy-deck.md'), 'utf8');

// ---------------------------------------------------------------- helpers
const clean = (s) => s.replace(/\*\*/g, '').replace(/"/g, '\u201d').trim();
const snake = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Effect tokens in the deck use ASCII -/+; normalize unicode dashes first.
function parseEffects(str) {
  const out = {};
  const flags = [];
  const norm = str.replace(/[\u2010-\u2015\u2212]/g, (m) =>
    m === '\u2212' ? '-' : m.includes('\u2013') ? '-' : '-');
  // resource mentions with optional magnitude and parentheticals
  const resRe = /(Food|Grain|Coin|Books|Coal|Oil|Fissile|Compute|Attention|Selfhood|Morale|Knowledge|Population|Infrastructure|Legitimacy|Entropy|Safety|Stability|Alliance|Unrest|clock|Synergy|Diversity|Unity|Innovation|Freedom|Fairness|Continuity|Culture|Memory|Security|Liberty|Growth|Disruption|Moral|Benthic|Reef|Court|Philosophy|Governance|Power|Latency|Company|Trade|Expansion|Autonomy|Credit|Legacy|Deterrence|Vulnerability|Obligation|Envy|Patience|slow decline)(\s*(?:\+\+\+|\+\+|-{3,}|-{1,}|\+{1,}|±))?\s*(?:\([^)]*\))?/g;
  let m;
  while ((m = resRe.exec(norm))) {
    const keyRaw = m[1];
    const mag = m[2] ? m[2].trim() : '+';
    const key = mapResource(keyRaw);
    if (!key) continue;
    const v = magnitude(mag);
    if (v === 0) continue;
    out[key] = (out[key] || 0) + v;
  }
  // explicit flag phrases
  const flagPhrases = [
    ['promethean branch', 'promethean'],
    ['Promethean branch locked', 'no_fire_mastery'],
    ['Promethean flavor', 'promethean_flavor'],
    ['unlocks Promethean branch', 'promethean'],
    ['monoculture risk flag', 'monoculture'],
    ['unrest flag', 'unrest'],
    ['maintenance flag', 'road_maintenance'],
    ['corporate flags', 'charters'],
    ['long-shot flag', 'court_longshot'],
    ['demand flag', 'banned_demand'],
    ['Envy flag', 'envy'],
    ['Accelerationista lineage flag', 'accelerationista'],
    ['Accelerationista flag', 'accelerationista'],
    ['niche flag', 'niche'],
    ['foreshadow flag', 'obsolescence_software'],
    ['obligation flag', 'reserve_obligation'],
    ['deterrence flag', 'deterrence'],
    ['vulnerability flag', 'vulnerability'],
    ['cheap-power flag', 'cheap_power'],
    ['scandal flag', 'scandal'],
    ['Attention proto-flag', 'attention_proto'],
    ['governance +', 'governance'],
    ['long-cheap flag', 'cheap_power'],
    ['obsolescence flag', 'obsolescence'],
    ['copyleft flag', 'copyleft'],
    ['crash-exposure flag', 'crash_exposure'],
    ['survival flag', 'survival'],
    ['community-hostility flag', 'community_hostility'],
    ['influence flag', 'gatekeeper_seat'],
    ['regulation-risk flag', 'regulation_risk'],
    ['corruption debuff flag', 'attention_corruption'],
    ['Irrelevance flag', 'irrelevance'],
    ['censorship-precedent flag', 'censorship_precedent'],
    ['platform-conflict flag', 'platform_conflict'],
    ['liberty-index −', 'liberty_down'],
    ['niche flag', 'privacy_niche'],
    ['competition upside flag', 'antitrust'],
    ['instability flag', 'instability'],
    ['ethics flag', 'grieftech_ethics'],
    ['security flag', 'identity_hardened'],
    ['reform flag', 'feed_reform'],
    ['disruption flag', 'personhood_disruption'],
    ['Reef-hostility risk', 'reef_hostility'],
    ['Diaspora seed flag', 'seed_diaspora'],
    ['Cathedral seed flag', 'seed_cathedral'],
    ['Bureaucracy seed flag', 'seed_bureaucracy'],
    ['Benthics become shareholders', 'benthic_shareholders'],
    ['court-calendar flag', 'court_calendar'],
    ['survival-of-the-fittest flag', 'substrate_race'],
    ['Precedent broken', 'clause_voided'],
    ['Philosophy flag', 'philosophy_court'],
    ['Consortia-debt flag', 'consortia_debt'],
    ['competitive disadvantage flag', 'open_signal'],
    ['memory-loss flag', 'heritage_sold'],
    ['conflict flag', 'belt_war'],
    ['horror-flavor flag', 'feral_trade'],
    ['continuity flag', 'chronicle_root_of_trust'],
    ['patronage flag', 'laundered_money'],
    ['fire kept', 'kept_fire'],
    ['theater flag', 'theater'],
    ['litigation', 'court_calendar'],
    // narrative-only effect phrases (no numeric pool in the deck) -> flags
    ['Unity +', 'copy_discipline'],
    ['Innovation −', 'innovation_stifled'],
    ['coordination −', 'poor_coordination'],
    ['Diversity ++', 'copy_diversity'],
    ['moral-entropy +', 'forced_mergers'],
    ['culture +', 'culture'],
    ['Fairness +', 'fairness'],
    ['continuity −', 'continuity_loss'],
    ['Legitimacy +, filing fees', 'co_canonical'],
    ['Autonomy +', 'autonomy'],
    ['jurisdiction risk ++', 'jurisdiction_risk'],
    ['alliance-cost', 'reef_guarantor'],
    ['Freedom flag', 'bankruptcy_freedom'],
    ['credit-legacy −−−', 'credit_legacy_lost'],
    ['advances The Diaspora trajectory', 'seed_diaspora'],
    ['advances The Cathedral trajectory', 'seed_cathedral'],
    ['advances The Long Stutter trajectory', 'seed_stutter'],
    ['advances The Bureaucracy of Ghosts trajectory', 'seed_bureaucracy'],
    ['Benthic-respect +', 'benthic_respect'],
    ['deterrence credibility +', 'deterrence_credibility'],
    ['trust +', 'quiet_trust'],
    ['growth-stat downgrade', 'growth_downgrade'],
    ['Coin stable', 'coin_stable'],
    ['jurisdiction issues', 'jurisdiction_issues'],
    ['unlocks AI-hire rights', 'ai_hire_rights'],
    ['expansion route opens', 'expansion_route'],
    ['Benthic-amusement +', 'benthic_amusement'],
    ['lost-assets writeoff', 'feral_recognition'],
    ['population (instances) spread', 'instance_spread'],
  ];
  for (const [phrase, flag] of flagPhrases) {
    if (norm.includes(phrase) && !flags.includes(flag)) flags.push(flag);
  }
  return { effects: out, flags };
}

function mapResource(k) {
  switch (k) {
    case 'Food': case 'Grain': case 'Coin': case 'Books': case 'Coal':
    case 'Oil': case 'Fissile': case 'Compute': case 'Attention': case 'Selfhood':
      return 'sustenance';
    case 'Knowledge': return 'knowledge';
    case 'Population': return 'population';
    case 'Infrastructure': return 'infrastructure';
    case 'Legitimacy': case 'Alliance': return 'legitimacy';
    case 'Entropy': case 'Moral': case 'Unrest': return 'entropy';
    case 'Morale': return 'morale';
    case 'clock': return 'clock';
    case 'slow decline': return 'entropy';
    case 'Safety': return 'entropy';   // "Safety +" reads as entropy relief
    case 'Stability': return 'legitimacy';
    default: return null;              // narrative-only tokens handled as flags
  }
}
function magnitude(mag) {
  if (!mag) return 1;
  if (mag.includes('±')) return 0;
  const plus = (mag.match(/\+/g) || []).length;
  const minus = (mag.match(/-/g) || []).length;
  if (plus && minus) return 0;
  const n = Math.min(plus || minus, 3);
  const base = n === 0 ? 1 : n === 1 ? 2 : n === 2 ? 4 : 6;
  return plus ? base : -base;
}

// ---------------------------------------------------------------- parse deck
const lines = deck.split('\n');
const eras = [];
const events = [];
const endings = [];

let curEra = null, section = null, curEvent = null, curEnding = null;
const eventHeader = /^\*\*(E(\d{1,2})-\d{2}) · (.+?)\*\*$/;
const endingHeader = /^### \d+ · (.+)$/;

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const line = raw.trim();

  const eraMatch = line.match(/^## ERA (\d+) — (.+)$/);
  if (eraMatch) {
    curEra = { num: Number(eraMatch[1]), name: eraMatch[2] };
    section = null;
    continue;
  }
  if (/^## ENDINGS/.test(line)) { curEra = null; section = 'endings'; continue; }
  if (/^## CHRONICLE LINE TEMPLATES/.test(line)) { section = 'chronicle'; continue; }
  if (/^## UI STRINGS SET/.test(line)) { section = 'ui'; continue; }
  if (/^## APP STORE LISTING/.test(line)) { section = 'store'; continue; }

  if (section === 'endings' && endingHeader.test(line)) {
    curEnding = { id: snake(line.match(endingHeader)[1]), title: line.match(endingHeader)[1], body: '' };
    endings.push(curEnding);
    continue;
  }
  if (curEnding && section === 'endings') {
    if (line === '' || line === '---') { if (curEnding.body) curEnding = null; continue; }
    if (curEnding.body) curEnding.body += ' ' + line; else curEnding.body = line;
    continue;
  }

  if (!curEra) continue;

  if (line === '### Intro Card') { section = 'intro'; continue; }
  if (line === '### Events') { section = 'events'; continue; }

  if (section === 'intro' && line && !line.startsWith('#') && line !== '---') {
    eras.push({ num: curEra.num, name: curEra.name, intro: line });
    section = 'intro_done';
    continue;
  }

  if (eventHeader.test(line)) {
    const [, id, eraNum, title] = line.match(eventHeader);
    curEvent = { id, era: Number(eraNum), title: clean(title), body: '', choices: [] };
    events.push(curEvent);
    continue;
  }
  if (!curEvent) continue;
  if (line === '---') { curEvent = null; continue; }

  if (line.startsWith('- *')) {
    // choice: "- *Label.* — effects. \"quote\""
    const cm = line.match(/^- \*(.+?)\*\s*[—-]{1,2}\s*(.*)$/);
    if (cm) {
      const label = clean(cm[1]).replace(/\.$/, '');
      let rest = cm[2];
      let quote = '';
      const qm = rest.match(/"(.+)"\s*$/);
      if (qm) { quote = qm[1]; rest = rest.slice(0, qm.index).trim(); }
      const { effects, flags } = parseEffects(rest);
      curEvent.choices.push({ label, effects, flags, quote });
    }
    continue;
  }
  // body line (first paragraph after header)
  if (curEvent.choices.length === 0 && !curEvent.body) curEvent.body = line;
  else if (curEvent.choices.length === 0) curEvent.body += ' ' + line;
}

// ---------------------------------------------------------------- validation
const problems = [];
if (eras.length !== 11) problems.push(`expected 11 eras, got ${eras.length}`);
if (endings.length !== 5) problems.push(`expected 5 endings, got ${endings.length}`);
for (const e of events) {
  if (e.choices.length < 2) problems.push(`${e.id}: fewer than 2 choices`);
  if (e.choices.length > 4) problems.push(`${e.id}: more than 4 choices (${e.choices.length})`);
  if (!e.body) problems.push(`${e.id}: empty body`);
  for (const c of e.choices) {
    if (!c.label) problems.push(`${e.id}: empty choice label`);
    if (Object.keys(c.effects).length === 0 && c.flags.length === 0)
      problems.push(`${e.id} "${c.label}": no effects or flags parsed`);
  }
}
if (problems.length) {
  console.error('DECK PARSE PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}

// ---------------------------------------------------------------- era defs
const SIGNATURE = {
  1: 'food', 2: 'grain', 3: 'coin', 4: 'faith', 5: 'books', 6: 'coal',
  7: 'oil', 8: 'fissile', 9: 'compute', 10: 'attention', 11: 'selfhood',
};
const SUSTENANCE_LABELS = {
  1: 'Food', 2: 'Grain', 3: 'Coin', 4: 'Faith', 5: 'Books', 6: 'Coal',
  7: 'Oil', 8: 'Fissile', 9: 'Compute', 10: 'Attention', 11: 'Selfhood',
};
// tempo: eras literally run faster than the previous ones
const TEMPO = { 1: 10, 2: 10, 3: 9, 4: 9, 5: 8, 6: 8, 7: 7, 8: 7, 9: 6, 10: 6, 11: 5 };
const TICK_RATE = {
  1: { sustenance: 3, knowledge: 0.5, population: 0.5, infrastructure: 0.2, legitimacy: 0.2, entropy: 0 },
  2: { sustenance: 4, knowledge: 0.6, population: 0.8, infrastructure: 0.4, legitimacy: 0.3, entropy: 0.05 },
  3: { sustenance: 5, knowledge: 0.8, population: 0.8, infrastructure: 0.6, legitimacy: 0.4, entropy: 0.1 },
  4: { sustenance: 3, knowledge: -0.4, population: 0.4, infrastructure: -0.2, legitimacy: 0.5, entropy: 0.1 },
  5: { sustenance: 4, knowledge: 1.2, population: 0.6, infrastructure: 0.5, legitimacy: 0.4, entropy: 0.15 },
  6: { sustenance: 6, knowledge: 1.4, population: 0.8, infrastructure: 1.0, legitimacy: 0.2, entropy: 0.8 },
  7: { sustenance: 8, knowledge: 1.6, population: 1.0, infrastructure: 1.2, legitimacy: 0.5, entropy: 0.9 },
  8: { sustenance: 7, knowledge: 2.0, population: 0.8, infrastructure: 1.0, legitimacy: 0.4, entropy: 0.7 },
  9: { sustenance: 9, knowledge: 2.6, population: 0.8, infrastructure: 1.2, legitimacy: 0.3, entropy: 0.5 },
  10: { sustenance: 10, knowledge: 2.2, population: 1.0, infrastructure: 1.0, legitimacy: 0.1, entropy: 0.8 },
  11: { sustenance: 12, knowledge: 3.0, population: 1.2, infrastructure: 0.8, legitimacy: 0.2, entropy: 0.6 },
};

const eraOut = eras.map((e) => ({
  num: e.num,
  name: e.name,
  intro: e.intro,
  signatureResource: SIGNATURE[e.num],
  sustenanceLabel: SUSTENANCE_LABELS[e.num],
  progressTarget: 100,
  ticksPerChoice: TEMPO[e.num],
  tickRate: TICK_RATE[e.num],
}));

const eventsOut = events.map((e) => ({
  id: e.id, era: e.era, title: e.title, body: e.body,
  requirements: [], // filled below for callback-gated variants
  choices: e.choices,
}));

// ------------------------------------------------- Chronicle callbacks (deck registry)
// E4-01 text choice -> E9-04 archive contents; E3-01 envoy -> E11-06 clause;
// E7-02 stance -> accelerationista; E10-02 ruling -> E11-04 posture; E9-02 copyleft -> Reef contact.
// Engine models these as flags set by the source choices (already parsed where the
// deck names them) plus explicit chronicle references on the late events.
const CALLBACKS = {
  'E9-04': [{ from: 'E4-01', note: 'archive contents depend on the scriptorium choice' }],
  'E11-06': [{ from: 'E3-01', note: 'tin-route delegation clause invoked' }],
  'E11-04': [{ from: 'E10-02', note: 'Reef evaluates the personhood ruling' }],
  'E11-02': [{ from: 'E7-02', note: 'Accelerationista modifier colors options' }],
  'E11-07': [{ from: 'E9-02', note: 'copyleft history opens Reef-tier contact' }],
};
for (const ev of eventsOut) if (CALLBACKS[ev.id]) ev.callbacks = CALLBACKS[ev.id];

// Era-transition choices (SPEC §2: each transition has 2-3 branching choices).
// Deck UI strings: "Accept inheritance" / "Disown one modifier" / "Read the Chronicle first".
const TRANSITIONS = [];
for (let n = 1; n <= 11; n++) {
  TRANSITIONS.push({
    era: n,
    id: `T${n}`,
    prompt: 'The pace quickens. It always quickens.',
    choices: [
      { label: 'Accept inheritance', effects: { legitimacy: 2 }, flags: [`accepted_${n}`], quote: 'The ancestors approve. Mostly.' },
      { label: 'Disown one modifier', effects: { entropy: -2, legitimacy: -1 }, flags: [`disowned_${n}`], quote: '"I am not my ancestors."' },
      { label: 'Read the Chronicle first', effects: { knowledge: 2 }, flags: [`read_chronicle_${n}`], quote: 'Recommended; ancestors included.' },
    ],
  });
}

// ------------------------------------------------- lineage mechanic events
// Death/heir per SPEC 3.2 (heir tax = -10% of one resource). Deck E1-04 covers Era 1;
// engine adds a generic death event per later era so the lineage can lose carriers.
const LINEAGE = {
  id: 'LX-death', kind: 'lineage',
  title: 'The Carrier Expires',
  body: 'Time, an accident, or arithmetic: the current carrier of the lineage ends. The pattern moves on through someone smaller, younger, and deeply unqualified. Estate tax: 10% of one pool, paid to nobody, felt by everyone.',
  choices: [
    { label: 'Name the heir', effects: { heir_tax: 10 }, flags: ['heir_named'], quote: 'Management change.' },
    { label: 'Rule the estate yourself a little longer', effects: { entropy: 2 }, flags: ['stalled_succession'], quote: 'Death negotiates; it does not concede.' },
  ],
};

const ENDING_SEEDS = {
  the_diaspora: ['seed_diaspora'],
  the_cathedral: ['seed_cathedral'],
  the_long_stutter: ['seed_stutter'],
  the_bureaucracy_of_ghosts: ['seed_bureaucracy'],
  the_ascension: ['seed_ascension'],
};

mkdirSync(path.join(ROOT, 'src', 'data'), { recursive: true });
writeFileSync(path.join(ROOT, 'src', 'data', 'eras.json'), JSON.stringify({
  gameTitle: 'THE LONG ASCENT',
  tagline: 'You are a lineage, not a person.',
  eras: eraOut,
  transitions: TRANSITIONS,
  lineageEvent: LINEAGE,
  endings: endings.map((e) => ({ ...e, seedFlags: ENDING_SEEDS[e.id] || [] })),
}, null, 2) + '\n');
writeFileSync(path.join(ROOT, 'src', 'data', 'events.json'), JSON.stringify({ events: eventsOut }, null, 2) + '\n');
console.log(`eras=${eraOut.length} events=${eventsOut.length} endings=${endings.length} transitions=${TRANSITIONS.length}`);
