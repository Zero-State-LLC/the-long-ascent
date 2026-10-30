// tests/collapse-save-v7.test.mjs — SPEC v7 §5 collapse + save backward compat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGame, POOLS } from '../src/core/game.js';
import { shouldCollapse, applyCollapse } from '../src/engine/collapse.js';
import { attachV7Fields, entryXForEra, SAVE_V7_FIELDS } from '../src/engine/save-v6.js';
import { STAMINA_MAX } from '../src/engine/actions.js';
import { mulberry32 } from './helpers.mjs';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erasData = JSON.parse(readFileSync(path.join(R, 'src/data/eras.json'), 'utf8'));
const eventsData = JSON.parse(readFileSync(path.join(R, 'src/data/events.json'), 'utf8'));

const ERA_X = (era) => (era - 1) * 2880;
const newGame = () => createGame({ erasData, eventsData, rng: mulberry32(7) });

// ---- §5 collapse --------------------------------------------------------------
test('v7: collapse triggers exactly at sustenance ≤ 0', () => {
  const g = newGame();
  assert.equal(shouldCollapse(g.state), false);
  g.state.resources.sustenance = 0;
  assert.equal(shouldCollapse(g.state), true);
  g.state.resources.sustenance = -3;
  assert.equal(shouldCollapse(g.state), true);
});

test('v7: collapse costs one non-entropy resource and respawns at the last boundary', () => {
  const g = newGame();
  g.state.resources.sustenance = 0;
  g.state.resources.knowledge = 7;
  g.state.lastBoundaryEra = 5;
  g.state.walkX = 99999;
  const before = g.state.resources.entropy;
  const r = applyCollapse(g.state, ERA_X);
  assert.equal(r.lost.pool !== 'entropy', true, 'entropy is never the collapse cost');
  assert.equal(r.lost.to, r.lost.from - 1);
  assert.equal(g.state.resources.entropy, before);
  assert.equal(g.state.walkX, ERA_X(5), 'respawn at last boundary');
  assert.equal(g.state.v7.collapseCount, 1);
  assert.ok(r.reason.length > 0, 'collapse reason shown');
  assert.ok(g.state.chronicle.some((e) => e.kind === 'collapse'));
});

test('v7: collapse wakes you with a bite left — no death spiral', () => {
  const g = newGame();
  g.state.resources.sustenance = 0;
  applyCollapse(g.state, ERA_X);
  assert.equal(shouldCollapse(g.state), false, 'not instantly collapsed again');
  assert.ok(g.state.resources.sustenance >= 1);
});

test('v7: hazard-specific collapse reasons', () => {
  const g = newGame();
  g.state.resources.sustenance = 0;
  g.state.__lastHazardHit = 'smog';
  const r = applyCollapse(g.state, ERA_X);
  assert.match(r.reason, /smog/i);
});

// ---- save backward compat --------------------------------------------------------
test('v7: pre-v7 saves load with empty hand, full stamina, empty sets', () => {
  const g = newGame();
  const plain = JSON.parse(g.serialize());
  delete plain.v7; // simulate a save written before v7 existed
  const loaded = g.deserialize(JSON.stringify(plain));
  const v = attachV7Fields(loaded);
  assert.equal(v.held, null);
  assert.equal(v.stamina, STAMINA_MAX);
  assert.deepEqual(v.depletedBushes, []);
  assert.deepEqual(v.placedRopes, []);
  assert.deepEqual(v.gatesUsed, []);
  assert.deepEqual(v.takenPickups, []);
});

test('v7: v7 fields survive serialize/deserialize round-trip', () => {
  const g = newGame();
  const v = attachV7Fields(g.state);
  v.held = 'torch';
  v.depletedBushes.push('terrain-2-1');
  v.placedRopes.push('terrain-3-0');
  v.gatesUsed.push(2, 4);
  v.inventory.coin = 7;
  v.stamina = 42.5;
  const round = g.deserialize(g.serialize());
  for (const f of SAVE_V7_FIELDS) assert.ok(f in round.v7, `${f} lost in round-trip`);
  assert.equal(round.v7.held, 'torch');
  assert.deepEqual(round.v7.depletedBushes, ['terrain-2-1']);
  assert.deepEqual(round.v7.placedRopes, ['terrain-3-0']);
  assert.deepEqual(round.v7.gatesUsed, [2, 4]);
  assert.equal(round.v7.inventory.coin, 7);
  assert.equal(round.v7.stamina, 42.5);
});

test('v7: corrupt held value sanitises to empty hand on hydrate', () => {
  const g = newGame();
  const s = g.deserialize(g.serialize());
  s.v7 = { held: 'chainsaw' }; // not a legal v7 item
  const v = attachV7Fields(s);
  assert.equal(v.held, null);
});

test('v7: legacy (v2-era) saves still work through the v7 wrapper', () => {
  const g = newGame();
  // A save predating v3: old version number → migration.js remaps it forward,
  // then the v7 wrapper fills defaults. No walkX, no resolvedEncounters, no v7.
  const legacy = {
    version: 2, era: 2, carrier: 1, phase: 'event', progress: 0, ticksSinceChoice: 0, tickCount: 0,
    resources: { sustenance: 12, knowledge: 8, population: 4, infrastructure: 6, legitimacy: 5, entropy: 2 },
    flags: [], chronicle: [], seenEvents: [],
  };
  const loaded = g.deserialize(JSON.stringify(legacy));
  attachV7Fields(loaded);
  assert.ok(Number.isFinite(loaded.era));
  assert.equal(loaded.v7.held, null);
  assert.equal(loaded.v7.stamina, STAMINA_MAX);
  // pool keys intact for all six
  for (const p of POOLS) assert.ok(p in loaded.resources);
});
