// Deeper look at eras.json records (dev helper).
import fs from 'node:fs';
const base = new URL('../', import.meta.url).pathname;
const eras = JSON.parse(fs.readFileSync(base + 'src/data/eras.json', 'utf8'));
console.log('eras array len:', eras.eras.length);
console.log('era[0]:', JSON.stringify(eras.eras[0], null, 1));
console.log('era keys union:', [...new Set(eras.eras.flatMap((e) => Object.keys(e)))].join(','));
console.log('era ids/names:', eras.eras.map((e) => e.id + ':' + e.name).join(' | '));
console.log('transitions len:', eras.transitions.length);
console.log('transition[0]:', JSON.stringify(eras.transitions[0]));
console.log('uiStrings keys:', Object.keys(eras.uiStrings || {}));
