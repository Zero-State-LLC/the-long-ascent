// tools/v9-copy-verify.mjs — Scribe v9: validate research/v9-copy.json against SPEC v9 §9 + task schema.
import { readFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync(new URL('../research/v9-copy.json', import.meta.url), 'utf8'));
const errs = [];
const POOLS = ['sustenance', 'knowledge', 'population', 'infrastructure', 'legitimacy', 'entropy'];

// missed_stations: eras 1-17, 2-3 variants each
const ms = doc.missed_stations;
for (let i = 1; i <= 17; i++) {
  const key = `era_${i}`;
  const v = ms[key];
  if (!Array.isArray(v)) { errs.push(`missed_stations.${key} missing`); continue; }
  if (v.length < 2 || v.length > 3) errs.push(`${key}: ${v.length} variants (want 2-3)`);
  for (const line of v) if (typeof line !== 'string' || !line.trim()) errs.push(`${key}: bad line`);
}
const extraMs = Object.keys(ms).filter((k) => k !== 'note' && !/^era_\d+$/.test(k));
if (extraMs.length) errs.push(`missed_stations extra keys: ${extraMs}`);

// walk_away: 4-5 strings
if (!Array.isArray(doc.walk_away) || doc.walk_away.length < 4 || doc.walk_away.length > 5)
  errs.push(`walk_away: ${doc.walk_away?.length} (want 4-5)`);

// dim_reasons: required key families + ≤48 chars
const dr = doc.dim_reasons;
for (const p of POOLS) if (!(dr[`pool_too_low_${p}`])) errs.push(`dim_reasons.pool_too_low_${p} missing`);
for (let t = 1; t <= 4; t++) if (!dr[`entropy_tier_${t}`]) errs.push(`dim_reasons.entropy_tier_${t} missing`);
for (const [k, v] of Object.entries(dr)) {
  if (k === 'note') continue;
  if (v.length > 48) errs.push(`dim_reasons.${k}: ${v.length} chars (>48)`);
  if (!/^(no_item_|pool_too_low_|entropy_tier_|verb_)/.test(k)) errs.push(`dim_reasons.${k}: unknown key family`);
}

// almanac_labels: five keys
for (const k of ['pools_title', 'stations_visited', 'stations_missed', 'era_progress', 'keys_title'])
  if (!doc.almanac_labels?.[k]) errs.push(`almanac_labels.${k} missing`);

// render_fault + station_ui
for (const k of ['stripe', 'toast']) if (!doc.render_fault?.[k]) errs.push(`render_fault.${k} missing`);
for (const k of ['select_hint', 'commit_hint', 'leave_hint', 'consequence_pending'])
  if (!doc.station_ui?.[k]) errs.push(`station_ui.${k} missing`);

// banned-noun scan (SPEC §8): source-novel proper nouns + author
const BANNED = ['accelerando', 'bezier', 'stross', 'dana', 'xanthe', 'anna', 'kunterz', 'brenner',
  'jeff', 'saula', 'pawel', 'lakshmi', 'margaret', 'serena', 'aubrey', 'ingrid', 'viktor',
  'karl', 'marie', 'sophie', 'jordan', 'isidore', 'rabatke', 'neumann', 'winston', 'churchill',
  'hitler', 'einstein', 'elon', 'musk', 'google', 'amazon', 'facebook', 'microsoft', 'nasdaq',
  'mit ', 'darpa', 'solntse', 'chrysalis', 'acceleratora'];
const raw = readFileSync(new URL('../research/v9-copy.json', import.meta.url), 'utf8').toLowerCase();
for (const w of BANNED) {
  const re = new RegExp(`\\b${w.trim()}\\b`, 'g');
  if (re.test(raw)) errs.push(`BANNED NOUN HIT: "${w}"`);
}

// stat-name spelling check: any pool word used must match POOL_ORDER exactly
for (const variant of ['entrophy', 'sustenance '.trim() + 's', 'infra', 'legitimicy']) {
  if (new RegExp(`\\b${variant}\\b`).test(raw)) errs.push(`stat misspelling: "${variant}"`);
}

const counts = {
  missed_lines: Object.keys(ms).filter((k) => k !== 'note').reduce((n, k) => n + ms[k].length, 0),
  walk_away: doc.walk_away.length,
  dim_reasons: Object.keys(dr).filter((k) => k !== 'note').length,
  almanac: Object.keys(doc.almanac_labels).length,
  render_fault: Object.keys(doc.render_fault).filter((k) => k !== 'note').length,
  station_ui: Object.keys(doc.station_ui).length,
};
console.log(JSON.stringify({ errs, counts }, null, 1));
process.exit(errs.length ? 1 : 0);
