// Verify generated data: counts, banned source-novel nouns, verbatim copy vs deck.
import { readFileSync } from 'node:fs';
const R = '/Users/luna/.hermes/work/accelerando/repo';
const ev = JSON.parse(readFileSync(R + '/src/data/events.json')).events;
const eras = JSON.parse(readFileSync(R + '/src/data/eras.json'));
const deck = readFileSync(R + '/research/copy-deck.md', 'utf8');

const perEra = {};
for (const x of ev) perEra[x.era] = (perEra[x.era] || 0) + 1;
console.log('events:', ev.length, 'per era:', JSON.stringify(perEra));
console.log('choice-count dist:', JSON.stringify(ev.reduce((a, x) => ((a[x.choices.length] = (a[x.choices.length] || 0) + 1), a), {})));

const banned = ['macx', 'manfred', 'amber macx', 'aineko', 'franklin', 'pamela', 'wunch', 'hyundai', 'the slug', 'vile offspring', 'lobster', 'field circus', 'panulirus', 'yemeni', 'saturnian', 'amalthea', 'edinburgh'];
const blob = (JSON.stringify(eras) + JSON.stringify(ev)).toLowerCase();
for (const w of banned) if (blob.includes(w)) console.log('BANNED FOUND:', w);

const norm = (s) => s.replace(/\u201d/g, '"').replace(/\*\*/g, '');
let miss = 0;
for (const x of ev) {
  if (!deck.includes(x.title)) { console.log('TITLE MISS', x.id, x.title); miss++; }
  if (!norm(x.body).includes('...') && !deck.includes(x.body) && !deck.includes(x.body.replace(/"/g, '\u201d'))) { console.log('BODY MISS', x.id); miss++; }
  for (const c of x.choices) {
    if (!deck.includes(`*${c.label}.`) && !deck.includes(`*${c.label}`)) { console.log('LABEL MISS', x.id, JSON.stringify(c.label)); miss++; }
  }
}
for (const e of eras.endings) if (!deck.includes(e.body)) { console.log('ENDING BODY MISS', e.id); miss++; }
for (const e of eras.eras) if (!deck.includes(e.intro)) { console.log('ERA INTRO MISS', e.num); miss++; }
console.log('verbatim misses:', miss);
console.log('endings:', eras.endings.map((e) => e.id).join(', '));
