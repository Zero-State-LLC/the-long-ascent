// tests/feel-v8.test.mjs — SPEC-v8 §1/§2: the game-feel layer (juice.js) + feel.js constants.
// Verification bar (SPEC §5): shake magnitudes/durations, squash scale values,
// combo multiplier progression, star thresholds — all unit-tested here.
// Reduced-motion off-switch covered per system (cross-cutting rule 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShake, SHAKE_PRESETS, createSquash, createParticles, PARTICLE_KINDS,
  createHitFeedback, createProjectileFx, createPickupFx, createMenuFx,
  createEraSequence, ERA_BEATS, createWhisper, createCombo, createMastery,
  gradeEra, createEraScoreTracker, ensureV8State, createJuice,
  easeOutBack, easeOutQuad,
} from '../src/engine/juice.js';
import {
  SQUASH_JUMP, SQUASH_LAND, SHAKE_HAZARD_MS, SHAKE_HAZARD_PX,
  SHAKE_COLLAPSE_MS, SHAKE_COLLAPSE_PX, SHAKE_HEAVY_MS, SHAKE_HEAVY_PX,
  FLASH_MS, KNOCKBACK_IMPULSE, INPUT_LOCK_MS, COMBO_WINDOW_S, COMBO_MULTS,
  COMBO_CAP, MASTERY_KILLS, MASTERY_STUN_S, WHISPER_INTERVAL_S,
  MAX_FALL, SHAKE_MAX_PX, ERA_SEQ_S, ERA_SEQ_SKIP_AFTER_S,
} from '../src/engine/feel.js';

const DT = 1 / 60;

// ---- feel.js constants match SPEC §1 + research/juice-numbers-v8.md ---------
test('v8: feel constants match SPEC §1 verbatim (shake/flash/knockback/lock)', () => {
  assert.equal(SHAKE_HAZARD_PX, 2); assert.equal(SHAKE_HAZARD_MS, 120);
  assert.equal(SHAKE_COLLAPSE_PX, 4); assert.equal(SHAKE_COLLAPSE_MS, 200);
  assert.equal(SHAKE_HEAVY_PX, 1); assert.equal(SHAKE_HEAVY_MS, 80);
  assert.equal(FLASH_MS, 80);
  assert.equal(INPUT_LOCK_MS, 200);
  assert.equal(KNOCKBACK_IMPULSE, 250); // 250 px/s ≈ 0.3 tiles (96 px) travel
  assert.equal(ERA_SEQ_S, 1.2);
  assert.equal(ERA_SEQ_SKIP_AFTER_S, 0.4);
  assert.equal(WHISPER_INTERVAL_S, 45);
  // trauma points are px / SHAKE_MAX_PX so peaks land exactly on SPEC magnitudes
  assert.equal(SHAKE_PRESETS.hazard.trauma, SHAKE_HAZARD_PX / SHAKE_MAX_PX);
  assert.equal(SHAKE_PRESETS.collapse.trauma, SHAKE_COLLAPSE_PX / SHAKE_MAX_PX);
  assert.equal(SHAKE_PRESETS.heavy.trauma, SHAKE_HEAVY_PX / SHAKE_MAX_PX);
});

test('v8: squash/stretch constants — jump (0.85, 1.12) 120ms; land gain/loss/recover', () => {
  assert.equal(SQUASH_JUMP.sx, 0.85);
  assert.equal(SQUASH_JUMP.sy, 1.12);
  assert.equal(SQUASH_JUMP.recoverMs, 120);
  assert.equal(SQUASH_LAND.sxGain, 0.25);
  assert.equal(SQUASH_LAND.syLoss, 0.15);
  assert.equal(SQUASH_LAND.recoverMs, 150);
  assert.equal(SQUASH_LAND.backK, 1.7);
});

// ---- shake -------------------------------------------------------------------
test('v8: shake kicks scale with the preset and decay to zero within the duration', () => {
  const s = createShake({ rng: () => 0.5 });
  s.kick('collapse');
  assert.ok(s.trauma > 0, 'trauma rose');
  let peak = 0;
  for (let i = 0; i < 200; i++) {
    s.update(DT);
    peak = Math.max(peak, Math.abs(s.offset().x));
  }
  assert.equal(s.trauma, 0, 'settles to exactly zero (no eternal vibration)');
  assert.ok(peak <= SHAKE_COLLAPSE_PX + 0.5, `peak ${peak.toFixed(2)}px within the 4px collapse band`);
});

test('v8: shake stacking is capped at the collapse magnitude, not additive forever', () => {
  const s = createShake({ rng: () => 0.5 });
  s.kick('hazard'); s.kick('hazard'); s.kick('hazard'); s.kick('hazard');
  assert.ok(s.trauma <= SHAKE_PRESETS.collapse.trauma + 1e-9, `capped at ${SHAKE_PRESETS.collapse.trauma}, got ${s.trauma}`);
});

test('v8: shake is silent under reduced motion (zero offset, no trauma)', () => {
  const s = createShake({ reducedMotion: true, rng: () => 0.5 });
  s.kick('collapse');
  s.update(DT);
  assert.equal(s.trauma, 0);
  assert.deepEqual(s.offset(), { x: 0, y: 0 });
});

// ---- squash --------------------------------------------------------------------
test('v8: jump squash sets (0.85, 1.12) instantly and recovers over 120ms', () => {
  const sq = createSquash({});
  sq.jump();
  assert.ok(Math.abs(sq.current().sx - 0.85) < 1e-9);
  assert.ok(Math.abs(sq.current().sy - 1.12) < 1e-9);
  for (let i = 0; i < Math.ceil(0.12 / DT) + 2; i++) sq.update(DT);
  assert.ok(Math.abs(sq.current().sx - 1) < 0.01 && Math.abs(sq.current().sy - 1) < 0.01, 'back to 1 after 120ms');
});

test('v8: landing squash is velocity-scaled — soft landing barely squashes', () => {
  const sq = createSquash({});
  const soft = sq.land(MAX_FALL * 0.2);
  assert.ok(Math.abs(soft.t - 0.2) < 1e-9);
  assert.ok(Math.abs(soft.sx - 1.05) < 1e-9, `1 + 0.25*0.2, got ${soft.sx}`);
  assert.ok(Math.abs(soft.sy - 0.97) < 1e-9, `1 - 0.15*0.2, got ${soft.sy}`);
  const hard = createSquash({}).land(MAX_FALL);
  assert.ok(Math.abs(hard.sx - 1.25) < 1e-9);
  assert.ok(Math.abs(hard.sy - 0.85) < 1e-9, 'terminal fall lands at y 0.85 (SPEC value)');
});

test('v8: reduced motion skips squash entirely (static 1,1)', () => {
  const sq = createSquash({ reducedMotion: true });
  sq.jump();
  const r = sq.land(MAX_FALL);
  assert.deepEqual(sq.current(), { sx: 1, sy: 1 });
  assert.equal(r.sx, 1); // contract still returned, just not applied
});

test('v8: easeOutBack overshoots 1 mid-recovery (the juice in the landing)', () => {
  let overshot = false;
  for (let i = 1; i < 20; i++) if (easeOutBack(i / 20) > 1.001) overshot = true;
  assert.ok(overshot, 'back-ease overshoot present');
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9, 'settles exactly at 1');
  assert.ok(Math.abs(easeOutQuad(1) - 1) < 1e-9);
});

// ---- particles -----------------------------------------------------------------
test('v8: named effects emit the researched counts (jump 4, land 8, sprint 3, spark 10, sparkle 6)', () => {
  const p = createParticles({ rng: () => 0.5 });
  assert.equal(p.jumpDust(0, 0), 4);
  assert.equal(p.landDust(0, 0, MAX_FALL * 0.8), 8);
  assert.equal(p.sprintPuff(0, 0, 1), 3);
  assert.equal(p.hitSparks(0, 0), 10);
  assert.equal(p.pickupSparkle(0, 0), 6);
  assert.equal(p.liveCount(), 4 + 8 + 3 + 10 + 6);
});

test('v8: land dust only when fallVy exceeds 50% of MAX_FALL (soft landings stay quiet)', () => {
  const p = createParticles({ rng: () => 0.5 });
  assert.equal(p.landDust(0, 0, MAX_FALL * 0.3), 0);
  assert.equal(p.landDust(0, 0, MAX_FALL * 0.51), 8);
});

test('v8: particle pool is fixed-size — full pool drops spawns instead of growing', () => {
  const p = createParticles({ capacity: 8, rng: () => 0.5 });
  p.burst('dust', 0, 0, 8);
  assert.equal(p.liveCount(), 8, 'pool fills to capacity');
  assert.equal(p.burst('dust', 0, 0, 8), 0, 'further spawns are dropped, never evict live slots');
  assert.equal(p.liveCount(), 8);
  p.update(1); // all die of old age
  assert.equal(p.liveCount(), 0);
  assert.equal(p.burst('dust', 0, 0, 4), 4, 'dead slots are recycled');
});

test('v8: reduced motion spawns no particles', () => {
  const p = createParticles({ reducedMotion: true, rng: () => 0.5 });
  assert.equal(p.jumpDust(0, 0), 0);
  assert.equal(p.sprintPuff(0, 0, 1), 0);
  assert.equal(p.liveCount(), 0);
  assert.deepEqual([...PARTICLE_KINDS], ['dust', 'spark', 'sparkle']);
});

// ---- hit feedback -----------------------------------------------------------------
test('v8: hit feedback — 80ms white flash, 200ms input lock, knockback impulse away from source', () => {
  const h = createHitFeedback({});
  const imp = h.hit(50); // source to the right
  assert.equal(h.flashing, true);
  assert.equal(h.locked, true);
  assert.ok(imp.vx < 0, 'knocked AWAY from a right-side source');
  assert.ok(imp.vy < 0, 'lifted off the ground');
  assert.equal(Math.abs(imp.vx), KNOCKBACK_IMPULSE);
  for (let i = 0; i < Math.ceil(0.08 / DT); i++) h.update(DT);
  assert.equal(h.flashing, false, 'flash ends at 80ms');
  assert.equal(h.locked, true, 'control not yet returned at 80ms');
  for (let i = 0; i < Math.ceil((0.2 - 0.08) / DT) + 2; i++) h.update(DT);
  assert.equal(h.locked, false, 'lock ends at 200ms (HK base recoil)');
  // blink is ~8Hz
  assert.equal(typeof h.blinkVisible(8), 'boolean');
});

test('v8: input lock is a gameplay contract — it survives reduced motion; flash stays color-only', () => {
  const h = createHitFeedback({ reducedMotion: true });
  h.hit(0);
  assert.equal(h.locked, true, '200ms lock still applies (control contract)');
  assert.equal(h.flashing, true, 'color-only flash kept (juice cross-rule 6)');
  for (let i = 0; i < Math.ceil(0.2 / DT) + 2; i++) h.update(DT);
  assert.equal(h.locked, false, 'lock still expires on the same clock');
});

// ---- projectile fx -----------------------------------------------------------------
test('v8: projectile trail holds 8 points and the spin advances with dt', () => {
  const fx = createProjectileFx({});
  for (let i = 0; i < 20; i++) fx.track('p1', i, -i);
  assert.equal(fx.fx('p1').trail.length, 8, 'trail capped at 8 (SPEC ribbon)');
  assert.equal(fx.fx('p1').trail.at(-1).x, 19, 'newest point kept');
  fx.advance('p1', 0.5);
  assert.ok(Math.abs(fx.fx('p1').spin - 6) < 1e-9, '12 rad/s × 0.5s');
  fx.release('p1');
  assert.equal(fx.fx('p1'), null);
});

// ---- pickup fx ---------------------------------------------------------------------
test('v8: pickup text rises exactly 24px over its 0.8s life with delayed fade', () => {
  const pk = createPickupFx({});
  pk.pickupTaken({ took: 'berry', amount: 2, pool: 'sustenance', x: 100, y: 100 });
  assert.equal(pk.texts.length, 1, 'floating text spawned');
  assert.equal(pk.flights.length, 1, 'item flies to the HUD slot');
  const at0 = pk.viewModel()[0];
  assert.ok(at0.text.startsWith('+2'), `label reads +2 … (got "${at0.text}")`);
  pk.update(0.4); // halfway
  const mid = pk.viewModel()[0];
  assert.equal(mid.alpha, 1, 'alpha holds for the first half (juice §6)');
  pk.update(0.395);
  const late = pk.viewModel()[0]; // one tick before retirement: full rise + mostly faded
  assert.ok(late.alpha < 0.1, 'fades out over the second half');
  assert.ok(late.y <= at0.y - 23, `risen the full 24px by end of life (end y ${late.y})`);
  pk.update(0.01);
  assert.equal(pk.viewModel().length, 0, 'text retired at 0.8s total');
});

test('v8: pickup flight resolves in 200ms (ease-in)', () => {
  const pk = createPickupFx({});
  pk.flyToHud('coin', 0, 0);
  pk.update(0.1);
  assert.equal(pk.flights.length, 1);
  const half = pk.flights[0];
  assert.ok(half.y < 0 && half.y > -110, `ease-in is slower early: y=${half.y}`);
  pk.update(0.1);
  assert.equal(pk.flights.length, 0, 'arrives at 200ms');
});

test('v8: reduced motion skips floating text and flights but still records the pickup', () => {
  const pk = createPickupFx({ reducedMotion: true });
  pk.pickupTaken({ took: 'coin', amount: 2, pool: 'coin', x: 0, y: 0 });
  assert.equal(pk.texts.length, 0);
  assert.equal(pk.flights.length, 0);
});

// ---- menu fx -----------------------------------------------------------------------
test('v8: menu opens with a 120ms scale-in (0.85 → 1.0) and settles at 1', () => {
  const m = createMenuFx({});
  m.opened();
  assert.ok(m.scale() < 1, 'starts small');
  m.update(0.12);
  assert.ok(Math.abs(m.scale() - 1) < 1e-9, 'settles at exactly 1 after 120ms');
  assert.equal(createMenuFx({ reducedMotion: true }).scale(), 1, 'reduced motion: no scale-in');
});

test('v8: denied greyed-choice wiggle decays to zero within 250ms', () => {
  const m = createMenuFx({});
  m.denied();
  m.update(1 / 60); // one frame in: the wiggle is live
  assert.ok(Math.abs(m.deniedOffset()) > 0, 'wiggles after one frame of decay');
  m.update(0.3);
  assert.equal(m.deniedOffset(), 0, 'settles');
  const mr = createMenuFx({ reducedMotion: true });
  mr.denied();
  assert.equal(mr.deniedOffset(), 0, 'no shake under reduced motion');
});

// ---- era sequence ---------------------------------------------------------------------
test('v8: era sequence runs the SPEC beat table in a 1.2s envelope', () => {
  const seq = createEraSequence({});
  assert.equal(seq.begin(7, { fromEra: 6, name: 'THE INDUSTRIAL AGE' }), true);
  assert.equal(seq.begin(8), false, 'no double-begin');
  const early = seq.sample(0.1);
  assert.ok(early.push > 1 && early.push < 1.08, 'push-in building toward 8%');
  const mid = seq.sample(0.45);
  assert.equal(mid.push, 1.08, 'camera push-in reaches exactly 8% by 350ms');
  assert.ok(mid.column > 0, 'light column burning at 450ms');
  const flash = seq.sample(ERA_BEATS.COLUMN_START);
  assert.ok(flash.flash, 're-equip white flash fires at the column start beat');
  const cardIn = seq.sample(0.8);
  assert.ok(cardIn.cardAlpha > 0 && cardIn.cardAlpha < 1, 'title card sliding in');
  const held = seq.sample(1.0);
  assert.equal(held.cardAlpha, 1, 'card fully visible during the hold');
  const out = seq.sample(1.19);
  assert.ok(out.cardAlpha < 1 && out.cardAlpha > 0, 'sliding back out at the end');
  assert.equal(seq.sample(1.2).finished, true);
});

test('v8: era sequence is skippable only after 400ms, jumping straight to card-out', () => {
  const seq = createEraSequence({});
  seq.begin(2);
  assert.equal(seq.skip(), false, 'cannot skip before 400ms');
  seq.update(0.5);
  assert.equal(seq.skip(), true, 'skip lands after 400ms');
  assert.equal(seq.elapsed, ERA_BEATS.CARD_OUT_START, 'jumps to the card-out beat');
  // completes inside the 1.2s ± 0.1 sim tolerance after a skip
  let guard = 0;
  while (seq.active && guard++ < 200) seq.update(DT);
  assert.ok(!seq.active && seq.elapsed <= 1.2, `sequence ended at ${seq.elapsed}s`);
});

test('v8: reduced motion plays the era sequence as a static pass-through (fade instant)', () => {
  const seq = createEraSequence({ reducedMotion: true });
  seq.begin(3);
  const s = seq.sample(0.1);
  assert.equal(s.desat, 0);
  assert.equal(s.push, 1, 'no camera push');
  assert.equal(s.fade, 1, 'palette crossfade is instant');
});

// ---- whisper ------------------------------------------------------------------------------
test('v8: whisper fires a fresh line every ~45s of WALKING and cycles without repeats', () => {
  const w = createWhisper({ intervalS: 2 });
  const lines = ['a', 'b', 'c'];
  let got = null;
  for (let i = 0; i < 2 * 60 + 4 && !got; i++) got = w.update(DT, true, 1, lines);
  assert.ok(lines.includes(got), `a line fired at the cadence: ${got}`);
  assert.equal(w.bubbleText, got);
  // standing still never fires
  const w2 = createWhisper({ intervalS: 1 });
  let none = null;
  for (let i = 0; i < 120; i++) none = w2.update(DT, false, 1, lines);
  assert.equal(none, null);
  // idle time does not count toward the walk clock: 1 s of IDLE + 0.5 s of
  // walking must NOT fire (interval is walking time only).
  const w3 = createWhisper({ intervalS: 1 });
  for (let i = 0; i < 90; i++) w3.update(DT, false, 1, lines);
  for (let i = 0; i < 29; i++) w3.update(DT, true, 1, lines); // 0.483s of walking
  const notYet = w3.update(DT, true, 1, lines); // walk clock 0.5s < 1s
  assert.equal(notYet, null, 'idle seconds are not walk seconds — 0.5s of moving does not fire a 1s cadence');
  for (let i = 0; i < 30; i++) var fired = w3.update(DT, true, 1, lines); // crosses 1.0s of walking
  assert.ok(lines.includes(fired), `fires once 1s of WALKING accrues: ${fired}`);
});

// ---- combo ----------------------------------------------------------------------------------
test('v8: combo multiplier ladder is exactly ×1.2/×1.4/×1.6 capped ×2.0 (SPEC §2)', () => {
  assert.deepEqual([...COMBO_MULTS], [1.2, 1.4, 1.6]);
  assert.equal(COMBO_CAP, 2.0);
  const c = createCombo();
  const seen = [];
  for (let i = 0; i < 6; i++) { c.gather(); seen.push(c.mult()); }
  assert.deepEqual(seen, [1.2, 1.4, 1.6, 1.8, 2, 2], `progression: ${seen.join(',')}`);
  assert.equal(c.apply(10), Math.round(10 * 2), 'cap applies to yields');
  const fresh = createCombo();
  assert.equal(fresh.apply(10), 10, 'no chain → no multiplier');
});

test('v8: combo chain breaks after 3s idle and on damage', () => {
  const c = createCombo();
  c.gather(); c.gather();
  assert.equal(c.count, 2);
  for (let i = 0; i < Math.ceil((COMBO_WINDOW_S + 0.05) / DT); i++) c.update(DT);
  assert.equal(c.count, 0, 'idle past the 3s window breaks the chain');
  const d = createCombo();
  d.gather(); d.gather();
  d.damage();
  assert.equal(d.count, 0, 'damage breaks the chain instantly');
  assert.ok(d.broken >= 1);
});

// ---- mastery + era scores --------------------------------------------------------------------
test('v8: hazard mastery arms throw-stuns after the 5th kill of a family (SPEC §2)', () => {
  const save = {};
  const m = createMastery(save);
  assert.equal(m.armed('boar'), false);
  assert.equal(m.stunFor('boar'), 0);
  for (let i = 1; i <= MASTERY_KILLS; i++) m.recordKill('boar');
  assert.equal(m.kills('boar'), MASTERY_KILLS);
  assert.equal(m.armed('boar'), true);
  assert.equal(m.stunFor('boar'), MASTERY_STUN_S, 'stuns 1s once mastered');
  assert.equal(m.stunFor('wolf'), 0, 'other families unaffected');
  assert.equal(save.boar, MASTERY_KILLS, 'counter rides the save object');
});

test('v8: era stars — thoroughness + survival + style, 3 max (SPEC §2 thresholds)', () => {
  assert.equal(gradeEra({ encountersResolved: 5, encountersTotal: 5, collapsed: false, comboAvg: 1.4 }), 3);
  assert.equal(gradeEra({ encountersResolved: 4, encountersTotal: 5, collapsed: false, comboAvg: 1.4 }), 2, 'missing an encounter costs a star');
  assert.equal(gradeEra({ encountersResolved: 5, encountersTotal: 5, collapsed: true, comboAvg: 1.4 }), 2, 'collapse costs a star');
  assert.equal(gradeEra({ encountersResolved: 5, encountersTotal: 5, collapsed: false, comboAvg: 1.29 }), 2, 'combo avg below ×1.3 costs a star');
  assert.equal(gradeEra({ encountersResolved: 0, encountersTotal: 0, collapsed: false, comboAvg: 1.3 }), 3, 'no encounters: thoroughness passes by default; ×1.3 avg is met');
  assert.equal(gradeEra({ encountersResolved: 0, encountersTotal: 3, collapsed: true, comboAvg: 1.0 }), 0);
});

test('v8: era report cards persist through state.v8.eraScores (run summary total)', () => {
  const st = {};
  const tracker = createEraScoreTracker(st);
  tracker.record(1, { era: 1, stars: 3 });
  tracker.record(2, { era: 2, stars: 1 });
  assert.equal(tracker.get(2).stars, 1);
  assert.equal(tracker.totalStars(), 4);
});

test('v8: ensureV8State attaches idempotent defaults (pre-v8 saves)', () => {
  const st = {};
  const v = ensureV8State(st);
  assert.deepEqual(Object.keys(v).sort(), ['echoSeen', 'eraScores', 'mastery', 'runTimeS']);
  ensureV8State(st);
  v.echoSeen.push('E1-01');
  v.mastery.boar = 2;
  ensureV8State(st);
  assert.deepEqual(v.echoSeen, ['E1-01'], 'idempotent: existing data untouched');
  assert.equal(v.mastery.boar, 2);
  assert.equal(st.v8, v);
});

// ---- master factory --------------------------------------------------------------------------
test('v8: createJuice bundles every subsystem and renderOffset is additive to the camera', () => {
  const j = createJuice({ rng: () => 0.5, state: {} });
  for (const k of ['shake', 'squash', 'particles', 'hit', 'projFx', 'pickup', 'menu', 'eraSeq', 'whisper', 'combo', 'mastery', 'scores']) {
    assert.ok(j[k], `factory exposes ${k}`);
  }
  j.shake.kick('hazard');
  j.shake.update(DT);
  const cam = { x: 100, y: 50 };
  const off = j.renderOffset({ ...cam });
  assert.equal(off.x, cam.x + j.shake.offset().x);
  assert.equal(off.y, cam.y + j.shake.offset().y);
  j.update(DT); // master update drives every subsystem without throwing
  assert.ok(j.reducedMotion === false);
});

test('v8: createJuice honors a reducedMotion() predicate (settings + matchMedia)', () => {
  let flag = false;
  const j = createJuice({ reducedMotion: () => flag, rng: () => 0.5 });
  assert.equal(j.reducedMotion, false);
  const j2 = createJuice({ reducedMotion: true, rng: () => 0.5 });
  j2.shake.kick('collapse');
  j2.update(DT);
  assert.deepEqual(j2.shake.offset(), { x: 0, y: 0 });
});
