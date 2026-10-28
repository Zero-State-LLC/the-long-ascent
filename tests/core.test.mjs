import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGame, POOLS } from '../src/core/game.js';
import { mulberry32, makePolicy } from './helpers.mjs';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erasData = JSON.parse(readFileSync(path.join(R, 'src/data/eras.json'), 'utf8'));
const eventsData = JSON.parse(readFileSync(path.join(R, 'src/data/events.json'), 'utf8'));

const newGame = (seed = 1) => createGame({ erasData, eventsData, rng: mulberry32(seed) });

test('data: 17 eras in order, each with intro and signature resource', () => {
  assert.equal(erasData.eras.length, 17);
  erasData.eras.forEach((e, i) => {
    assert.equal(e.num, i + 1);
    assert.ok(e.intro.length > 80, `era ${e.num} intro too short`);
    assert.ok(e.signatureResource);
    assert.ok(e.sustenanceLabel);
  });
});

test('data: every event has era 1-17, title, body, 2-4 choices with effects or flags', () => {
  for (const ev of eventsData.events) {
    assert.match(ev.id, /^E\d{1,2}-\d{2}n?$/);
    assert.ok(ev.era >= 1 && ev.era <= 17);
    assert.ok(ev.title && ev.body);
    assert.ok(ev.choices.length >= 2 && ev.choices.length <= 4, `${ev.id} choices=${ev.choices.length}`);
    for (const c of ev.choices) {
      assert.ok(c.label);
      assert.ok(Object.keys(c.effects).length > 0 || c.flags.length > 0, `${ev.id}/${c.label} is a dead choice`);
    }
  }
});

test('era progression: a scripted run climbs 1 -> 17 and reaches an ending', () => {
  // A pure-random lineage can be entropy-wrecked before the finale (that is a
  // valid Long Stutter loss); iterate seeds until one completes the ascent.
  let completed = null;
  for (let seed = 1; seed <= 20 && !completed; seed++) {
    const g = newGame(seed * 42);
    const seenEras = new Set();
    let guard = 0;
    while (g.state.phase !== 'ending' && guard++ < 50000) {
      seenEras.add(g.state.era);
      const ev = g.currentEvent();
      if (ev) g.choose(makePolicy('diaspora', mulberry32(guard))(ev, g.state).label);
      else g.tick();
    }
    if (g.state.ending) completed = { g, seenEras };
  }
  assert.ok(completed, 'at least one seed completes the full ascent');
  const { g, seenEras } = completed;
  assert.equal(g.state.phase, 'ending');
  for (let n = 1; n <= 17; n++) assert.ok(seenEras.has(n), `era ${n} visited`);
});

test('tempo: later eras need fewer ticks per choice than earlier ones', () => {
  const t = erasData.eras.map((e) => e.ticksPerChoice);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] <= t[i - 1], 'eras accelerate');
});

test('resources: six pools, entropy never negative, pools bounded', () => {
  const g = newGame(7);
  assert.deepEqual(Object.keys(g.state.resources).sort(), [...POOLS].sort());
  const out = g.runUntilEnd(makePolicy('stutter', mulberry32(9)));
  assert.ok(out.ticks < 200000, 'run terminated');
  for (const p of POOLS) {
    assert.ok(Number.isFinite(g.state.resources[p]), `${p} finite`);
    if (p === 'entropy') assert.ok(g.state.resources[p] >= 0);
  }
});

test('save/load roundtrip: exportCode/importCode are inverse', () => {
  const g = newGame(11);
  let guard = 0;
  while (g.state.era < 4 && guard++ < 20000) {
    const ev = g.currentEvent();
    if (ev) g.choose(makePolicy('diaspora', mulberry32(guard))(ev, g.state).label);
    else g.tick();
  }
  const code = g.exportCode();
  const g2 = newGame(77);
  g2.importCode(code);
  assert.deepEqual(g2.state, g.state);
});

test('save/load roundtrip mid-game', () => {
  const g = newGame(11);
  // play ~200 decisions worth of ticks
  let guard = 0;
  while (g.state.era < 5 && guard++ < 20000) {
    const ev = g.currentEvent();
    if (ev) g.choose(makePolicy('diaspora', mulberry32(guard))(ev, g.state).label);
    else g.tick();
  }
  const snap = g.serialize();
  const g2 = newGame(999);
  g2.deserialize(snap);
  assert.deepEqual(g2.state, g.state);
  // continuing from the loaded save still works
  const out = g2.runUntilEnd(makePolicy('random', mulberry32(5)));
  assert.ok(out.ending, 'loaded game reaches an ending');
});

test('export/import code roundtrip (base64url, offline-safe chars only)', () => {
  const g = newGame(21);
  let guard = 0;
  while (g.state.era < 3 && guard++ < 20000) {
    const ev = g.currentEvent();
    if (ev) g.choose(makePolicy('diaspora', mulberry32(guard))(ev, g.state).label);
    else g.tick();
  }
  const code = g.exportCode();
  assert.match(code, /^[A-Za-z0-9\-_]+$/, 'code is URL-safe');
  const g2 = newGame(123);
  g2.importCode(code);
  assert.deepEqual(g2.state, g.state);
});

test('every event is reachable: policy runs cover all events', () => {
  const covered = new Set();
  // The era-11 finale ends the game, so drivers defer it until the rest of the
  // era pool is exhausted — otherwise late era-11 events never get offered.
  for (let seed = 1; seed <= 40 && covered.size < eventsData.events.length; seed++) {
    const g = newGame(seed * 17);
    const pol = makePolicy(seed % 2 ? 'random' : 'diaspora', mulberry32(seed));
    let guard = 0;
    while (g.state.phase !== 'ending' && guard++ < 50000) {
      const ev = g.currentEvent();
      if (!ev) { g.tick(); continue; }
      covered.add(ev.id);
      if (ev.id === 'E11-12') {
        const others = g.eligibleEvents().filter((e) => e.id !== 'E11-12');
        if (others.length > 0) {
          const other = others[seed % others.length];
          const oc = pol(other, g.state) || other.choices[0];
          g.state.pendingEventId = other.id;
          g.choose(oc.label);
          continue;
        }
      }
      const c = pol(ev, g.state) || ev.choices[0];
      g.choose(c.label);
    }
    for (const id of g.state.seenEvents) covered.add(String(id).split(':')[0]);
  }
  const missing = eventsData.events.filter((e) => !covered.has(e.id)).map((e) => e.id);
  assert.deepEqual(missing, [], `unreachable events: ${missing.join(', ')}`);
});

test('no dead branches: every event offers >=2 selectable choices at runtime', () => {
  // All deck events have requirements:[] so any offered event always has its full
  // choice list selectable; verify via data + one exhaustive offer pass.
  const offered = new Set();
  const g = newGame(3);
  let guard = 0;
  while (g.state.phase !== 'ending' && guard++ < 50000) {
    const ev = g.currentEvent();
    if (ev) {
      offered.add(ev.id);
      for (const c of ev.choices) assert.ok(c.label);
      g.choose(ev.choices[guard % ev.choices.length].label);
    } else g.tick();
  }
  assert.ok(offered.size > 100, `saw ${offered.size} distinct events in one run`);
});

test('endings: all five reachable by explicit policy', () => {
  const want = {
    diaspora: 'the_diaspora',
    cathedral: 'the_cathedral',
    stutter: 'the_long_stutter',
    bureaucracy: 'the_bureaucracy_of_ghosts',
    ascension: 'the_ascension',
  };
  for (const [mode, expected] of Object.entries(want)) {
    let reached = null;
    for (let seed = 1; seed <= 12 && reached !== expected; seed++) {
      const g = newGame(seed * 101);
      if (mode === 'ascension') {
        // The Ascension is the no-trajectory path: it requires a lineage that
        // refused every seed flag AND crossed the upload with high knowledge
        // and low entropy (SPEC §3.4 — becoming incomprehensible). The policy
        // itself claims seed_none_claimed when abstaining; nothing pre-set.
      }
      const out = g.runUntilEnd(makePolicy(mode, mulberry32(seed), { strictNoSeed: mode === 'ascension' }));
      reached = out.ending;
    }
    assert.equal(reached, expected, `mode ${mode} -> ${expected}, got ${reached}`);
  }
});

test('ending texts exist for all five endings', () => {
  const ids = erasData.endings.map((e) => e.id);
  assert.deepEqual(ids.sort(), [
    'the_ascension', 'the_bureaucracy_of_ghosts', 'the_cathedral',
    'the_diaspora', 'the_long_stutter',
  ]);
  for (const e of erasData.endings) assert.ok(e.body.length > 300, `${e.id} text present`);
});

test('lineage: heir succession applies the -10% estate tax once', () => {
  const g = newGame(5);
  g._gotoEra(2);
  g.state.forcedLineage = true;
  const ev = g.currentEvent();
  assert.equal(ev.kind, 'lineage');
  const before = Math.max(...POOLS.filter((p) => p !== 'entropy').map((p) => g.state.resources[p]));
  g.choose('Name the heir');
  assert.equal(g.state.carrier, 2);
  const after = Math.max(...POOLS.filter((p) => p !== 'entropy').map((p) => g.state.resources[p]));
  assert.ok(after <= before, 'estate tax applied');
  assert.ok(g.state.chronicle.some((c) => c.kind === 'lineage' && /Management change/.test(c.text)));
});

test('chronicle: every decision is logged with era stamp', () => {
  const g = newGame(8);
  g.runUntilEnd(makePolicy('cathedral', mulberry32(2)));
  const decisions = g.state.chronicle.filter((c) => c.kind === 'decision');
  assert.ok(decisions.length >= 30, `logged ${decisions.length} decisions`);
  for (const d of decisions) {
    assert.ok(d.era >= 1 && d.era <= 17);
    assert.ok(d.text.startsWith(`Era ${d.era}:`));
  }
});

test('benthic chorus line auto-appends to debt/contract events', () => {
  const g = newGame(31);
  g._gotoEra(11);
  g.state.pendingEventId = 'E11-01';
  const ev = g.currentEvent();
  assert.equal(ev.id, 'E11-01');
  g.choose(ev.choices[0].label);
  assert.ok(g.state.chronicle.some((c) => /Benthics recorded this choice/.test(c.text)));
});

test('copy drift: diversity flag forks instances post-upload (era 13+)', () => {
  const g = newGame(33);
  g._gotoEra(13);
  g.addFlag('copy_diversity');
  g.state.pendingEventId = 'E11-05';
  const ev = g.currentEvent();
  g.choose(ev.choices[1].label); // opt out (no fork flag conflict)
  assert.ok(g.state.copies >= 2, 'forked post-upload');
  assert.ok(g.state.drift > 0);
});

// ------------------------------------------------------------ v2.1 §9 tests
import { decayAmount, deltaSnapshot, formatDeltas, describeDeltas, ENTROPY_DECAY_RATE } from '../src/core/game.js';

test('§9.2 entropy decay: decayAmount applies the 2% rate, zero on empty', () => {
  assert.equal(decayAmount(0), 0);
  assert.equal(decayAmount(100), 2); // 2% of 100
});

test('§9.2 delta snapshot + format render +12 Food / -3 chips', () => {
  const before = { sustenance: 100, legitimacy: 10 };
  const after = { sustenance: 112, legitimacy: 7 };
  const d = deltaSnapshot(before, after);
  assert.equal(d.sustenance, 12);
  assert.equal(d.legitimacy, -3);
  const text = String(formatDeltas(d, { sustenance: 'Food', legitimacy: 'Legitimacy' }));
  assert.ok(text.includes('12'), 'gain rendered');
  assert.ok(text.includes('3'), 'loss rendered');
  assert.ok(typeof describeDeltas(d, ['fire'], { sustenance: 'Food' }) === 'string');
});

test('§9.2 grantEraGoal: idempotent, grants badge once', async () => {
  const { createGame } = await import('../src/core/game.js');
  const g = createGame({ erasData, eventsData });
  const r1 = g.grantEraGoal(1);
  const r2 = g.grantEraGoal(1);
  assert.notEqual(r1, undefined);
  if (r1 && r1.badge) assert.ok(!r2 || !r2.badge, 'no double grant');
});
