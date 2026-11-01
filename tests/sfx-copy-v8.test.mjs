// tests/sfx-copy-v8.test.mjs — SPEC-v8 §1 (audio) + §3 (copy) wiring.
// sfx.js: 12 SFX names, pickup resolution by resource class, era-bed grouping,
// silent-mode observability (lastEvent), volume plumbing. copy-v8.js: ambient
// lines per era, echo index/once-per-run semantics, collapse reason aliases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSfx, SFX_NAMES, VOICES, pickupVoice, bedForEra } from '../src/engine/sfx.js';
import {
  ambientLinesForEra, indexEchoes, echoForEncounter, markEchoSeen, collapseLine,
} from '../src/engine/copy-v8.js';
import { setCollapseDoc, collapseReason } from '../src/engine/collapse.js';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ambientDoc = JSON.parse(readFileSync(path.join(R, 'research/ambient-v8.json'), 'utf8'));
const echoesDoc = JSON.parse(readFileSync(path.join(R, 'research/echoes-v8.json'), 'utf8'));
const collapseDoc = JSON.parse(readFileSync(path.join(R, 'research/collapse-v8.json'), 'utf8'));

// ---- sfx: the SPEC §1 cue list ------------------------------------------------
test('v8 audio: all 12 SPEC SFX exist (jump, land, pickup×3, throw, hit, collapse, gate-open, era-swell, denied-buzz, menu-click)', () => {
  assert.equal(SFX_NAMES.length, 12, `names: ${SFX_NAMES.join(',')}`);
  for (const n of ['jump', 'land', 'pickup_sustenance', 'pickup_knowledge', 'pickup_coin', 'throw', 'hit', 'collapse', 'gate-open', 'era-swell', 'denied-buzz', 'menu-click']) {
    assert.equal(typeof VOICES[n], 'function', `${n} voice exists`);
  }
});

test('v8 audio: pickup resolves by resource class (organic/crystal/coin)', () => {
  assert.equal(pickupVoice('sustenance'), 'pickup_sustenance');
  assert.equal(pickupVoice('knowledge'), 'pickup_knowledge');
  assert.equal(pickupVoice('coin'), 'pickup_coin');
  assert.equal(pickupVoice('credit'), 'pickup_sustenance', 'unknown pools fall back to the soft chime');
});

test('v8 audio: ambient beds group by era (1–5 acoustic, 6–11 industrial, 12–17 electronic)', () => {
  assert.equal(bedForEra(1), 'acoustic');
  assert.equal(bedForEra(5), 'acoustic');
  assert.equal(bedForEra(6), 'industrial');
  assert.equal(bedForEra(11), 'industrial');
  assert.equal(bedForEra(12), 'electronic');
  assert.equal(bedForEra(17), 'electronic');
});

test('v8 audio: silent mode records every cue on lastEvent (headless test hook)', () => {
  const s = createSfx({}); // no ctx → silent
  assert.equal(s.silent, true);
  s.play('jump');
  assert.equal(s.lastEvent.name, 'jump');
  s.play('pickup', { pool: 'coin' });
  assert.equal(s.lastEvent.name, 'pickup_coin', "'pickup' resolves through the pool");
  s.play('nope-not-a-cue');
  assert.equal(s.lastEvent.name, 'nope-not-a-cue', 'even unknown names are recorded (no throw)');
  assert.ok(s.events.length >= 3);
});

test('v8 audio: setEra tracks the bed per era group, silent mode included', () => {
  const s = createSfx({});
  assert.equal(s.setEra(2), 'acoustic');
  assert.equal(s.era, 'acoustic');
  assert.equal(s.setEra(9), 'industrial');
  assert.equal(s.setEra(9), 'industrial', 'idempotent');
  assert.equal(s.setEra(14), 'electronic');
  assert.equal(createSfx({}).setEra(3), 'acoustic', 'fresh instance starts per its own era');
});

test('v8 audio: a fake AudioContext gets real voices with no crashes', () => {
  const nodes = [];
  const ctx = {
    sampleRate: 48000,
    currentTime: 0.5,
    destination: {},
    createGain: () => { const g = { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {} }; nodes.push(g); return g; },
    createOscillator: () => { const o = { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, detune: { value: 0 }, connect() {}, start() {}, stop() {} }; nodes.push(o); return o; },
    createBuffer: () => ({ getChannelData: () => new Float32Array(480) }),
    createBufferSource: () => { const s = { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; nodes.push(s); return s; },
    createBiquadFilter: () => { const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; nodes.push(f); return f; },
  };
  const s = createSfx({ ctx, getSettings: () => ({ volume: 0.5, music: 0.4, sfx: 0.9 }) });
  assert.equal(s.silent, false);
  for (const n of SFX_NAMES) {
    assert.equal(s.play(n), true, `${n} plays through a real context`);
  }
  assert.equal(s.play('pickup', { pool: 'knowledge' }), true);
  s.setEra(12);
  assert.equal(s.era, 'electronic');
});

// ---- copy-v8: Scribe data wired into lookups ------------------------------------
test('v8 copy: ambient lines resolve per era (4 each, SPEC §3)', () => {
  for (let era = 1; era <= 17; era++) {
    const lines = ambientLinesForEra(ambientDoc, era);
    assert.equal(lines.length, 4, `era ${era} has 4 whisper lines`);
    assert.ok(lines.every((l) => typeof l === 'string' && l.length > 0));
  }
  assert.equal(ambientLinesForEra(ambientDoc, 99).length, 0, 'unknown era → empty pool');
  assert.equal(ambientLinesForEra(null, 1).length, 0, 'missing doc degrades to empty');
});

test('v8 copy: echo index maps all 154 ids; lookup honors the once-per-run ledger', () => {
  const idx = indexEchoes(echoesDoc);
  assert.equal(idx.size, 154);
  const st = { echoSeen: [] };
  const e = echoForEncounter(idx, 'E1-01', st);
  assert.equal(e.id, 'E1-01');
  assert.ok(e.text.length > 0, 'echo carries its line');
  markEchoSeen(st, 'E1-01');
  assert.equal(echoForEncounter(idx, 'E1-01', st), null, 'shown echoes never repeat (SPEC §3)');
  assert.deepEqual(st.echoSeen, ['E1-01']);
  // no state → always returns (used for lookups without a run ledger)
  assert.ok(echoForEncounter(idx, 'E1-01', null).id === 'E1-01');
  assert.equal(echoForEncounter(idx, 'nope', st), null, 'unknown id → null');
  assert.equal(echoForEncounter(idx, null, st), null, 'null id → null');
});

test('v8 copy: collapse reasons are source-keyed with alias + generic fallback', () => {
  assert.equal(collapseLine(collapseDoc, 'wolf'), 'The pack audited you at dusk. You lost.');
  assert.equal(collapseLine(collapseDoc, 'soldier_patrol'), collapseDoc.reasons.find((r) => r.source === 'soldier').text, 'soldier_patrol aliases to soldier');
  assert.equal(collapseLine(collapseDoc, 'nuclear_wasp'), collapseDoc.reasons.find((r) => r.source === 'generic').text, 'unknown source falls back to generic');
  assert.equal(collapseLine(collapseDoc, ''), collapseDoc.reasons.find((r) => r.source === 'generic').text);
  assert.equal(collapseLine(null, 'wolf'), 'You stopped. The road did not.', 'missing doc → hard fallback, never undefined');
});

test('v8 copy: setCollapseDoc routes source-keyed lines through collapseReason (save ride-along)', () => {
  const state = { __lastHazardHit: 'datastorm' };
  const doc = collapseDoc;
  setCollapseDoc(doc);
  assert.match(collapseReason(state), /Packet loss/);
  const hungry = {};
  setCollapseDoc(null); // clean up module state for other tests
  assert.equal(collapseReason({ __lastHazardHit: 'wolf' }), 'The wolf got you', 'without a doc the v7 table stands');
  void doc; void hungry;
});

test('v8 copy: scribe data matches the engine hazard alias keys', () => {
  const sources = collapseDoc.reasons.map((r) => r.source);
  for (const s of ['boar', 'wolf', 'stray_dog', 'bandit', 'soldier', 'smog', 'radiation', 'datastorm', 'generic']) {
    assert.ok(sources.includes(s), `reason keyed for ${s}`);
  }
});
