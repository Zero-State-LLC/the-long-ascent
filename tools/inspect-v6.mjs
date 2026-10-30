// Inspect v6 content JSONs + eras.json shape (dev helper).
import fs from 'node:fs';
const base = new URL('../', import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(base + p, 'utf8'));

const enc = read('research/encounters-v6.json');
const items = enc.encounters;
console.log('encounters top keys:', Object.keys(enc));
console.log('count:', items.length);
const keysets = new Set(items.map((i) => Object.keys(i).sort().join(',')));
console.log('item key variants:', [...keysets]);
const perEra = {};
for (const i of items) perEra[i.era] = (perEra[i.era] || 0) + 1;
console.log('per era:', JSON.stringify(perEra));
const types = {};
for (const i of items) types[i.type] = (types[i.type] || 0) + 1;
console.log('types:', JSON.stringify(types));
const chVar = new Set();
for (const i of items) for (const c of i.choices) chVar.add(Object.keys(c).sort().join(','));
console.log('choice key variants:', [...chVar]);
const eff = {};
let choiceCounts = {};
for (const i of items) {
  choiceCounts[i.choices.length] = (choiceCounts[i.choices.length] || 0) + 1;
  for (const c of i.choices) for (const k of Object.keys(c.effects || {})) eff[k] = (eff[k] || 0) + 1;
}
console.log('effect keys:', JSON.stringify(eff));
console.log('choices-per-encounter:', JSON.stringify(choiceCounts));
const extraTop = new Set();
for (const i of items) for (const k of Object.keys(i)) if (!['id','era','title','type','prompt','choices'].includes(k)) extraTop.add(k);
console.log('extra encounter fields:', [...extraTop]);
// sample an era-16 encounter
console.log('era16 sample:', JSON.stringify(items.find((i) => i.era === 16), null, 1).slice(0, 700));

const bs = read('research/boundary-stones-v6.json');
console.log('\nboundary top keys:', Object.keys(bs), 'stones:', bs.stones.length);
console.log('stone key variants:', [...new Set(bs.stones.map((s) => Object.keys(s).sort().join(',')))]);

const arc = read('research/arc-encounters-v6.json');
console.log('\narc top keys:', Object.keys(arc), 'beats:', arc.arcs.length);
console.log('beat key variants:', [...new Set(arc.arcs.map((a) => Object.keys(a).sort().join(',')))]);
const arcNames = {};
for (const a of arc.arcs) arcNames[a.arc] = (arcNames[a.arc] || 0) + 1;
console.log('arcs:', JSON.stringify(arcNames));
console.log('arc beats (arc,era):', arc.arcs.map((a) => a.arc[0] + a.era).join(' '));

const eras = read('src/data/eras.json');
console.log('\neras.json type:', Array.isArray(eras) ? 'array' : Object.keys(eras));
const first = Array.isArray(eras) ? eras[0] : eras[Object.keys(eras)[0]];
console.log('era record keys:', Object.keys(first));
console.log('first era:', JSON.stringify(first).slice(0, 900));

const pal = read('assets/palette_era01.json');
console.log('\npalette_era01 keys:', Object.keys(pal));
console.log(JSON.stringify(pal).slice(0, 500));
