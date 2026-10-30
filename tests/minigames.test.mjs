// tests/minigames.test.mjs — SPEC v5 §2/§3: framework contract, per-family
// deterministic sims (seeded, winnable at diff 0, no softlock at max diff,
// calm/reduced-motion parity is a render concern covered in minigamestage),
// reward caps, rate limits, score curve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, step, act, done, won, score, forfeit, reward, simulate,
  scoreCurve, rewardForScore, REWARD_CAPS, FAMILIES,
  createTracker, isAvailable, recordResult, resetEra, ledgerRows, MINIGAME_COPY,
} from '../src/core/minigames.js';

const FAMILY_IDS = Object.keys(FAMILIES); // granary..signal ('crossing' is a trigger record)

test('v5 framework: createRun requires a family and seeds deterministically', () => {
  assert.throws(() => createRun('nope', { seed: 1 }), /unknown minigame family/);
  const a = createRun('granary', { seed: 42 });
  const b = createRun('granary', { seed: 42 });
  assert.deepEqual(
    { items: a.items.map((s) => s.x), dur: a.dur, target: a.target },
    { items: b.items.map((s) => s.x), dur: b.dur, target: b.target },
    'same seed => identical layout',
  );
  const c = createRun('granary', { seed: 43 });
  assert.notDeepEqual(a.items.map((s) => s.x), c.items.map((s) => s.x), 'different seed => different layout');
});

test('v5 framework: crossing.js contract surface exists for every family', () => {
  for (const f of FAMILY_IDS) {
    const run = createRun(f, { seed: 7 });
    assert.equal(typeof run.family, 'string');
    assert.equal(run.done, false);
    assert.equal(won(run), false);
    assert.equal(score(run), 0);
    const stepped = step(run, 1 / 30);
    assert.equal(stepped, run, 'step returns the run');
    assert.ok(run.t > 0, `${f}: step advances t`);
    assert.equal(done(run), run.done);
  }
});

test('v5 framework: no Math.random in logic modules', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/core/minigames.js', import.meta.url), 'utf8'));
  const codeOnly = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/Math\.random/.test(codeOnly), 'minigames.js must be seeded-only');
});

test('v5 §3: every family is winnable by a perfect autopilot at diff 0 (seeds 1-6)', () => {
  for (const f of FAMILY_IDS) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const run = simulate(f, seed, 0);
      assert.ok(run.done, `${f} seed ${seed}: finishes (no softlock)`);
      assert.ok(won(run), `${f} seed ${seed}: winnable at diff 0 (score ${run.score}/${run.target})`);
    }
  }
});

test('v5 §3: no softlock at max difficulty — runs always terminate', () => {
  for (const f of FAMILY_IDS) {
    for (const seed of [11, 12]) {
      const run = simulate(f, seed, 1);
      assert.ok(run.done, `${f} seed ${seed} diff 1: terminates`);
      assert.ok(run.t <= run.dur + 1 / 30 + 1e-9, `${f} diff 1: ends by its duration cap`);
    }
  }
});

test('v5 §3: sims are deterministic — same seed+diff replays identically', () => {
  for (const f of FAMILY_IDS) {
    const a = simulate(f, 99, 0.5);
    const b = simulate(f, 99, 0.5);
    assert.equal(a.score, b.score, `${f}: replay score equal`);
    assert.equal(a.won, b.won, `${f}: replay verdict equal`);
  }
});

test('v5 §2: score curve tiers are monotone with documented breakpoints', () => {
  assert.equal(scoreCurve(100, 100).mult, 1);
  assert.equal(scoreCurve(85, 100).mult, 0.7);
  assert.equal(scoreCurve(60, 100).mult, 0.4);
  assert.equal(scoreCurve(10, 100).mult, 0.15);
  assert.equal(scoreCurve(0, 100).p, 0);
  assert.equal(scoreCurve(500, 100).p, 1, 'normalized curve clamps at 1');
});

test('v5 §3: rewards respect family caps ∩ global caps for every family', () => {
  for (const f of FAMILY_IDS) {
    const caps = FAMILIES[f].caps;
    const full = rewardForScore(1e6, 1, caps);
    for (const [res, amt] of Object.entries(full)) {
      assert.ok(REWARD_CAPS[res] != null, `${f}: ${res} has a global cap`);
      if (REWARD_CAPS[res] >= 0) {
        assert.ok(amt >= 0 && amt <= Math.min(caps[res], REWARD_CAPS[res]), `${f}.${res}=${amt} within caps`);
      } else {
        assert.ok(amt <= 0 && amt >= Math.max(caps[res], REWARD_CAPS[res]), `${f}.${res}=${amt} within negative cap`);
      }
    }
    const con = rewardForScore(0, 1, caps); // consolation tier still pays something
    const total = Object.values(con).reduce((s, v) => s + Math.abs(v), 0);
    assert.ok(total > 0, `${f}: playing at all is never punished`);
  }
});

test('v5 §4: forfeit scores 0, pays nothing, and is recorded', () => {
  const run = createRun('trade', { seed: 5 });
  step(run, 1);
  const f = forfeit(run);
  assert.equal(f.forfeited, true);
  assert.equal(f.done, true);
  assert.equal(f.score, 0);
  assert.deepEqual(reward(f), {}, 'forfeit pays no consolation');
  assert.equal(forfeit(f), f, 'forfeit on a finished run is a no-op');
});

test('v5 §3: rate limits — max 2 per era, once per family, never during crisis or Crossing', () => {
  const tr = createTracker();
  resetEra(tr, 3);
  assert.equal(isAvailable(tr, 'granary', { eraNum: 3 }).ok, true);
  recordResult(tr, 'granary', { eraNum: 3, score: 8 });
  assert.equal(isAvailable(tr, 'granary', { eraNum: 3 }).why, 'family_once', 'same family twice per era: no');
  recordResult(tr, 'scribe', { eraNum: 3, score: 700 });
  assert.equal(isAvailable(tr, 'carbon', { eraNum: 3 }).why, 'era_limit', 'third play in an era: no');
  assert.equal(isAvailable(tr, 'granary', { eraNum: 3, crisisActive: true }).why, 'crisis');
  assert.equal(isAvailable(tr, 'carbon', { eraNum: 4, crossingOpen: true }).why, 'crossing');
  resetEra(tr, 4);
  assert.equal(isAvailable(tr, 'carbon', { eraNum: 4 }).ok, true, 'new era: budget restored');
  // Crisis/crossing blocks even before anything was played.
  const fresh = createTracker();
  assert.equal(isAvailable(fresh, 'signal', { eraNum: 9, crisisActive: true }).ok, false);
});

test('v5 §4: ledger rows carry best scores and titles from MINIGAME_COPY', () => {
  const tr = createTracker();
  resetEra(tr, 2);
  recordResult(tr, 'granary', { eraNum: 2, score: 6 });
  recordResult(tr, 'granary', { eraNum: 9, score: 9 }); // best improves later era
  const rows = ledgerRows(tr);
  const g = rows.find((r) => r.family === 'granary');
  assert.equal(g.best, 9);
  assert.equal(g.title, MINIGAME_COPY.granary.title);
  assert.equal(rows.length, 1, 'only played families appear');
});

test('v5 §3: eras.json carries a valid minigame family for all 17 eras', async () => {
  const eras = JSON.parse(await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/data/eras.json', import.meta.url), 'utf8')));
  assert.equal(eras.eras.length, 17);
  for (const e of eras.eras) {
    const fam = e.minigame?.family;
    assert.ok(fam, `era ${e.num} has a minigame key`);
    assert.ok(FAMILIES[fam] || fam === 'crossing', `era ${e.num} family '${fam}' is known`);
  }
  assert.equal(eras.eras[16].minigame.family, 'crossing', 'era 17 (Selfhood) triggers Crossing II, not an overlay');
});

test('v5 §3: game glue — applyMinigameReward clamps pools, morale, and records the ledger', async () => {
  const { createGame } = await import('../src/core/game.js');
  const fs = await import('node:fs');
  const erasData = JSON.parse(fs.readFileSync(new URL('../src/data/eras.json', import.meta.url), 'utf8'));
  const eventsData = JSON.parse(fs.readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8'));
  const g = createGame({ erasData, eventsData });
  const before = g.state.resources.sustenance;
  g.applyMinigameReward('granary', { sustenance: 10, morale: 4 }, { score: 10 });
  assert.ok(g.state.resources.sustenance > before, 'reward lands on the pool');
  assert.equal(g.state.minigames.playedThisEra, 1, 'rate-limit slot consumed');
  assert.equal(g.state.minigames.best.granary.score, 10, 'ledger best recorded');
  // Overshoot clamps to the engine ceiling (1000), never past it.
  g.state.resources.knowledge = 997;
  g.applyMinigameReward('scribe', { knowledge: 999 }, { score: 900 });
  assert.equal(g.state.resources.knowledge, 1000, 'pool clamped to ceiling');
  // Entropy relief stays >= 0.
  g.state.resources.entropy = 2;
  g.applyMinigameReward('carbon', { entropy: -6 }, { score: 900 });
  assert.equal(g.state.resources.entropy, 0, 'entropy relief floors at 0');
  // Pre-v5 saves deserialize with a fresh tracker.
  const st = JSON.parse(g.serialize());
  delete st.minigames;
  const g2 = createGame({ erasData, eventsData });
  g2.deserialize(JSON.stringify(st));
  assert.ok(g2.state.minigames && g2.state.minigames.playedThisEra === 0, 'migration fills missing tracker');
});
