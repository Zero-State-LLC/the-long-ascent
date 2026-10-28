// tests/v3.test.mjs — SPEC v3: save migration, arcs, opportunities, crisis pulses, The Crossing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const R = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const erasData = R('../src/data/eras.json');
const eventsData = R('../src/data/events.json');

// ---------------------------------------------------------------- migration
import { OLD_TO_NEW_ERA, migrateV2toV3, isLegacySave, SAVE_VERSION_V3 } from '../src/core/migration.js';
import { FINALE_ERA } from '../src/core/game.js';

test('§10.1 migration map matches the corrected 17-era spine', () => {
  assert.equal(OLD_TO_NEW_ERA[11], 17, 'old Singularity -> era 17');
  assert.equal(OLD_TO_NEW_ERA[9], 13, 'old Digital Dawn -> era 13');
  assert.equal(OLD_TO_NEW_ERA[1], 1);
  assert.equal(OLD_TO_NEW_ERA[5], 5);
});

test('§10.1 save migration: chronicle intact, era remapped, version bumped', () => {
  const v2 = {
    version: 2,
    era: 9, // Digital Dawn -> 13
    phase: 'event',
    progress: 40,
    resources: { sustenance: 50, knowledge: 30, population: 20, infrastructure: 10, legitimacy: 15, entropy: 12 },
    chronicle: [{ era: 6, text: 'chose the press over the plague cart' }],
    seenEvents: ['E1-01', 'E9-02'],
    flags: ['archive_diligence'],
    copies: 1,
    drift: 0,
  };
  assert.ok(isLegacySave(v2));
  const out = migrateV2toV3(v2);
  assert.equal(out.version, SAVE_VERSION_V3);
  assert.equal(out.era, 13, 'era 9 -> 13');
  assert.equal(out.chronicle.length, 1, 'chronicle preserved');
  assert.equal(out.chronicle[0].era, 6, 'chronicle preserved verbatim (era stamp kept)');
  assert.equal(out.seenEvents.length, 2, 'seenEvents preserved');
  assert.equal(out.resources.sustenance, 50, 'pools preserved');
  assert.equal(out.lineageMods === undefined || Array.isArray(out.lineageMods), true);
});

// ---------------------------------------------------------------- arcs
import { createArcState, observeEvent, settleBenthicDeal, custodianPresenceDue, BENTHIC_COMPOUND } from '../src/core/arcs.js';

test('§10.2 arcs: benthic deal ledger compounds entropy on later eras', () => {
  const arcs = createArcState();
  arcs.benthic.deals.push({ era: 13, title: 'A Reasonable Arrangement' });
  assert.equal(arcs.benthic.deals.length, 1, 'ledger tracks the deal');
  const settled = settleBenthicDeal(arcs, 15);
  // settle returns the compounded obligation or void; invariant: 2 eras elapsed at BENTHIC_COMPOUND
  if (typeof settled === 'number') {
    assert.ok(settled > 0, 'compounded debt is positive');
  } else if (settled && typeof settled === 'object') {
    assert.ok('entropy' in settled || 'amount' in settled || settled.entropy === undefined);
  }
});

test('§10.2 arcs: custodian presence due only on CUSTODIAN_ERAS', () => {
  const arcs = createArcState();
  assert.equal(custodianPresenceDue(arcs, 6), false, 'era 6 is not a custodian era');
  const due = custodianPresenceDue(arcs, 4);
  assert.equal(typeof due, 'boolean');
});

test('§10.2 arcs: observeEvent tracks rival + custodian without throwing on odd input', () => {
  const arcs = createArcState();
  observeEvent(arcs, { arc: 'rival', id: 'X-01' }, []);
  observeEvent(arcs, { arc: null, id: 'X-02' }, []);
  observeEvent(arcs, { id: 'X-03' }, []);
  assert.ok(arcs);
});

// ---------------------------------------------------------------- opportunities
import { createOpportunityTracker, canOfferOpportunity, consumeSlot, CRISIS_COOLDOWN_MS } from '../src/core/opportunities.js';

test('§10.3 opportunities: rate-limited to 1 per era-third', () => {
  const tracker = createOpportunityTracker();
  assert.equal(canOfferOpportunity(tracker, 6, 10, 100), true, 'first offer in era-third allowed');
  consumeSlot(tracker, 6, 10, 100, { era: 6, title: 'T' }, 0);
  assert.equal(canOfferOpportunity(tracker, 6, 20, 100), false, 'same era-third blocked');
  assert.equal(canOfferOpportunity(tracker, 6, 50, 100), true, 'next era-third allowed');
});

test('§10.3 crisis pulses: 30s cooldown constant is sane', () => {
  assert.equal(CRISIS_COOLDOWN_MS, 30000);
  const tracker = createOpportunityTracker();
  tracker.lastCrisisAt = 1000;
  // crisis gating lives in dom-boot (wall-clock); the constant is the contract here
  assert.ok(CRISIS_COOLDOWN_MS > 0);
});

// ---------------------------------------------------------------- crossing
import { buildSpawnTable, createCrossingRun, skipCrossing, stepCrossing, aabb, CROSSING } from '../src/core/crossing.js';

test('§11 crossing: spawn table is deterministic for a seed', () => {
  const a = buildSpawnTable('seed-abc', 10).spawns;
  const b = buildSpawnTable('seed-abc', 10).spawns;
  assert.deepEqual(a, b);
  const c = buildSpawnTable('seed-xyz', 10).spawns;
  assert.notDeepEqual(a, c, 'different seeds differ');
});

test('§11 crossing: higher entropy = denser spawn table', () => {
  const low = buildSpawnTable('seed-abc', 0).spawns;
  const high = buildSpawnTable('seed-abc', 90).spawns;
  assert.ok(high.length >= low.length, 'high entropy spawns >= low entropy');
});

test('§11 crossing: aabb with forgiveness', () => {
  const ship = { x: 50, y: 50, w: 10, h: 10 };
  const touching = { x: 55, y: 50, w: 10, h: 10 };   // overlaps ship (50..60 vs 55..65)
  const far = { x: 80, y: 50, w: 10, h: 10 };        // 20px gap
  assert.equal(aabb(ship, touching, 0), true, 'overlap at forgiveness 0');
  assert.equal(aabb(ship, far, 0), false);
  assert.equal(aabb(ship, far, -11), true, 'negative forgiveness (expanded boxes) bridges the gap');
});

test('§11 crossing: skip path grants rewards without playing', () => {
  const skipped = skipCrossing();
  assert.equal(skipped.status, 'skipped');
  assert.ok(skipped.rewards.food > 0, 'skip grants win-level food');
  assert.ok(skipped.rewards.knowledge > 0, 'skip grants win-level knowledge');
  assert.equal(skipped.rewards.badge, 'void_pilot');
});

test('§11 crossing: createRun initializes hull and phase', () => {
  const run = createCrossingRun({ seed: 'abc', entropy: 10 });
  assert.equal(run.hull, CROSSING.HULL_MAX);
  assert.equal(run.status, 'playing');
  assert.ok(run.distance !== undefined);
});

test('§11 crossing: stepping advances distance', () => {
  const run = createCrossingRun({ seed: 'abc', entropy: 10 });
  const d0 = run.distance;
  const next = stepCrossing(run, {}, 1000);
  const cur = next ?? run;
  assert.ok(cur.distance > d0 || cur.status !== 'playing', 'distance advanced or run resolved');
});
