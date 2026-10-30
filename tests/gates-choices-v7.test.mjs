// tests/gates-choices-v7.test.mjs — SPEC v7 §3+§4: era gates and action-choice greying.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkGate, takeGate, gateForEra, gateTaken } from '../src/engine/gates.js';
import { attachActionMarks, checkActionRequirement, decorateChoices } from '../src/engine/actionChoices.js';
import { ensureV7State } from '../src/engine/actions.js';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatesDoc = JSON.parse(readFileSync(path.join(R, 'research/gates-v7.json'), 'utf8'));
const choicesDoc = JSON.parse(readFileSync(path.join(R, 'research/action-choices-v7.json'), 'utf8'));

const baseState = (over = {}) => {
  const st = { resources: { sustenance: 10, knowledge: 10, infrastructure: 10, legitimacy: 10, population: 5, entropy: 0 }, flags: [], chronicle: [], ...over };
  ensureV7State(st);
  return st;
};
/** Satisfy a gate requirement generically, per its kind. */
function satisfy(gate, st) {
  const r = gate.requirement;
  if (r.kind === 'item') st.v7.held = r.key;
  else if (r.kind === 'resource') {
    if (['coin', 'credit', 'carbon credits', 'company scrip'].includes(r.key)) st.v7.inventory[r.key] = r.amount;
    else if (r.key === 'resolve') st.morale = r.amount;
    else {
      const pool = { grain: 'sustenance', food: 'sustenance', faith: 'legitimacy', revolution: 'legitimacy', selfhood: 'legitimacy' }[r.key] || r.key;
      st.resources[pool] = r.amount;
    }
  } else st.flags.push(r.key);
}

// ---- §3 gates ---------------------------------------------------------------
test('v7: every era 1..17 has a gate with sign, advantage text, and a requirement of a legal kind', () => {
  for (let era = 1; era <= 17; era++) {
    const g = gateForEra(gatesDoc, era);
    assert.ok(g, `era ${era} missing gate`);
    assert.ok(g.sign && g.advantage, `era ${era} gate missing sign/advantage`);
    assert.ok(['item', 'resource', 'action'].includes(g.requirement.kind), `era ${era} bad kind`);
  }
});

test('v7: item gate met only with the item in hand', () => {
  const g = gatesDoc.gates.find((x) => x.requirement.kind === 'item');
  const st = baseState();
  assert.equal(checkGate(g, st).met, false);
  assert.match(checkGate(g, st).reason, /Requires:/);
  st.v7.held = g.requirement.key;
  assert.equal(checkGate(g, st).met, true);
});

test('v7: resource gate reads pools (grain→sustenance) and countables (coin)', () => {
  const grainGate = gatesDoc.gates.find((x) => x.requirement.kind === 'resource' && x.requirement.key === 'grain');
  if (grainGate) {
    const st = baseState();
    st.resources.sustenance = grainGate.requirement.amount - 1;
    assert.equal(checkGate(grainGate, st).met, false);
    st.resources.sustenance = grainGate.requirement.amount;
    assert.equal(checkGate(grainGate, st).met, true);
  }
  const coinGate = gatesDoc.gates.find((x) => x.requirement.kind === 'resource' && x.requirement.key === 'coin');
  if (coinGate) {
    const st = baseState();
    st.v7.inventory.coin = coinGate.requirement.amount;
    assert.equal(checkGate(coinGate, st).met, true);
    st.v7.inventory.coin = coinGate.requirement.amount - 1;
    assert.equal(checkGate(coinGate, st).met, false);
  }
});

test('v7: action gate needs the completed-action flag', () => {
  const g = gatesDoc.gates.find((x) => x.requirement.kind === 'action');
  const st = baseState();
  assert.equal(checkGate(g, st).met, false);
  st.flags.push(g.requirement.key);
  assert.equal(checkGate(g, st).met, true);
});

test('v7: taking the advantage path records the gate; blocked when unmet', () => {
  const g = gatesDoc.gates[0];
  const st = baseState();
  const denied = takeGate(gatesDoc, st, null, g.era);
  assert.equal(denied.ok, false);
  assert.ok(denied.reason.includes('Requires'));
  satisfy(g, st);
  const ok = takeGate(gatesDoc, st, null, g.era);
  assert.equal(ok.ok, true);
  assert.equal(ok.advantage, g.advantage);
  assert.equal(gateTaken(st, g.era), true);
});

test('v7: every gate can be satisfied through state alone (no dead doors)', () => {
  for (const g of gatesDoc.gates) {
    const st = baseState();
    satisfy(g, st);
    assert.equal(checkGate(g, st).met, true, `era ${g.era} unsatisfiable: ${JSON.stringify(g.requirement)}`);
  }
});

test('v7: unknown requirement kinds fail OPEN (the open path always exists)', () => {
  const st = baseState();
  const chk = checkGate({ requirement: { kind: 'wizards-say-maybe' }, sign: '?' }, st);
  assert.equal(chk.met, true);
});

// ---- §4 action-choice greying --------------------------------------------------
test('v7: markup attaches to world encounter choices by label', () => {
  const first = choicesDoc.markups[0];
  const objects = [{ id: first.id, choices: first.choices.map((c) => ({ label: c.label, effects: {} })) }];
  const marked = attachActionMarks(objects, choicesDoc);
  assert.ok(marked >= 1);
  const withAction = objects[0].choices.find((c) => c.action);
  assert.ok(withAction, 'at least one choice gains an action mark');
});

test('v7: throw verb greys without the named item in hand', () => {
  const ctx = { state: baseState(), actions: { crouching: false } };
  assert.equal(checkActionRequirement({ verb: 'throw', item: 'stone' }, ctx).met, false);
  ctx.state.v7.held = 'stone';
  assert.equal(checkActionRequirement({ verb: 'throw', item: 'stone' }, ctx).met, true);
  // "none" = any thrown object: always available (you can always throw what's held)
  assert.equal(checkActionRequirement({ verb: 'throw', item: 'none' }, { state: baseState(), actions: { crouching: false } }).met, true);
});

test('v7: sneak greys unless crouching; light greys without torch; gather greys with busy hand', () => {
  const st = baseState();
  assert.equal(checkActionRequirement({ verb: 'sneak' }, { state: st, actions: { crouching: false } }).met, false);
  assert.equal(checkActionRequirement({ verb: 'sneak' }, { state: st, actions: { crouching: true } }).met, true);
  assert.equal(checkActionRequirement({ verb: 'light', item: 'torch' }, { state: st, actions: { crouching: false } }).met, false);
  st.v7.held = 'torch';
  assert.equal(checkActionRequirement({ verb: 'light', item: 'torch' }, { state: st, actions: { crouching: false } }).met, true);
  assert.equal(checkActionRequirement({ verb: 'gather' }, { state: st, actions: { crouching: false } }).met, false);
  st.v7.held = null;
  assert.equal(checkActionRequirement({ verb: 'gather' }, { state: st, actions: { crouching: false } }).met, true);
});

test('v7: pay verb needs coin/credit in the pocket', () => {
  const st = baseState();
  assert.equal(checkActionRequirement({ verb: 'pay', item: 'coin' }, { state: st, actions: {} }).met, false);
  st.v7.inventory.coin = 5;
  assert.equal(checkActionRequirement({ verb: 'pay', item: 'coin' }, { state: st, actions: {} }).met, true);
});

test('v7: climb verb passes near a climbable prop or with stamina left', () => {
  const st = baseState();
  assert.equal(checkActionRequirement({ verb: 'climb' }, { state: st, actions: {}, nearClimbable: true }).met, true);
  st.v7.stamina = 0;
  assert.equal(checkActionRequirement({ verb: 'climb' }, { state: st, actions: {}, nearClimbable: false }).met, false);
});

test('v7: decorateChoices marks disabled + requirement text, keeps effects untouched', () => {
  const choices = [
    { label: 'Offer a stone at the boundary stone', effects: { legitimacy: 2 }, action: { verb: 'throw', item: 'stone', requirement: 'a stone in hand' } },
    { label: 'Plain choice', effects: { toast: 'hi' } },
  ];
  const out = decorateChoices(choices, { state: baseState(), actions: { crouching: false } });
  assert.equal(out[0].disabled, true);
  assert.equal(out[0].requirement, 'a stone in hand');
  assert.deepEqual(out[0].effects, choices[0].effects); // effects unchanged (§4)
  assert.equal(out[1].disabled, false);
  assert.equal(out[1].requirement, undefined);
});
