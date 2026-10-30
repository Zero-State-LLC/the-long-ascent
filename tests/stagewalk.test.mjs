// tests/stagewalk.test.mjs — SPEC v4 §2: walkable-figure controller (pure, no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StageWalk, markerPositions, DEFAULT_X, WALK_SPEED, ARM_RADIUS,
  WALK_FRAMES, IDLE_FPS, WALK_FPS, MAX_MARKERS,
} from '../src/ui/stageWalk.js';

// Deterministic clock the CONTROLLER reads too (now: c.now everywhere), so no
// test ever sees real performance.time.
const clock = () => {
  let t = 0;
  return { now: () => t, set: (v) => { t = v; }, advance: (d) => { t += d; } };
};

// ---------------------------------------------------------------- markers
test('marker positions: evenly spaced, max 4, degenerate counts safe', () => {
  assert.deepEqual(markerPositions(0), []);
  assert.deepEqual(markerPositions(1), [0.5]);
  assert.deepEqual(markerPositions(2).map((v) => Math.round(v * 100) / 100), [0.33, 0.67]);
  assert.deepEqual(markerPositions(4), [0.2, 0.4, 0.6, 0.8]);
  assert.equal(markerPositions(9).length, MAX_MARKERS, 'clamped to 4');
  for (const xs of [markerPositions(3), markerPositions(4)]) {
    const gaps = xs.slice(1).map((v, i) => v - xs[i]);
    assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-9), 'evenly spaced');
    assert.ok(xs.every((v) => v > 0 && v < 1), 'all strictly on stage');
  }
});

// ---------------------------------------------------------------- walking
test('figure idles at stage-x 25%', () => {
  const c = clock();
  const w = new StageWalk({ count: 3, now: c.now });
  assert.equal(w.x, DEFAULT_X);
  assert.equal(w.x, 0.25);
  w.update(5); // idling never moves him
  assert.equal(w.x, 0.25);
});

test('holding right walks right at WALK_SPEED and clamps at the stage edge', () => {
  const w = new StageWalk({ count: 2 });
  w.hold('right');
  w.update(1);
  assert.ok(Math.abs(w.x - (0.25 + WALK_SPEED)) < 1e-9, `x after 1s ≈ ${0.25 + WALK_SPEED}, got ${w.x}`);
  assert.equal(w.facing, 1);
  w.update(9); // long hold: clamps at 1, cannot leave the picture
  assert.equal(w.x, 1);
  w.release('right');
  assert.equal(w.dir, 0);
  w.update(1);
  assert.equal(w.x, 1, 'stays clamped after release');
});

test('holding left clamps at 0; opposite keys cancel; release stops motion', () => {
  const w = new StageWalk({ count: 4 });
  w.hold('left');
  w.update(2);
  assert.equal(w.x, 0, 'clamped at left edge');
  w.release('left');
  w.hold('left'); w.hold('right');
  assert.equal(w.dir, 0, 'both keys held = no drift');
  w.update(1);
  assert.equal(w.x, 0);
});

test('time stalls cannot teleport the figure: dt is capped at 2s per update', () => {
  const w = new StageWalk({ count: 2 });
  w.hold('right');
  w.update(1000); // huge gap: at most one capped (2s) step
  assert.ok(w.x <= 0.25 + WALK_SPEED * 2 + 1e-9, `capped step (${w.x})`);
});

// ---------------------------------------------------------------- arm/disarm
test('walking onto a marker arms it; walking away disarms', () => {
  const w = new StageWalk({ count: 4 }); // markers .2 .4 .6 .8
  // Idle at .25 sits within ARM_RADIUS (.06) of marker .2 — by design the start
  // spot touches the first marker; card swap re-derives it.
  assert.equal(w.armed, 0);
  w.setChoiceCount(3); // markers .25 .5 .75; idle .25 still touches marker 0 — instead pick count where idle is clear:
  w.x = 0.1;
  w.setChoiceCount(2); // markers .33 .67; x=.1 far from both
  assert.equal(w.armed, null);  w.hold('right');
  let armedAt = null;
  for (let t = 0; t < 3 && armedAt == null; t += 0.05) {
    w.update(0.05);
    if (w.armed != null) armedAt = t;
  }
  assert.ok(armedAt != null, 'reaching marker arms a choice');
  assert.equal(w.armed, 0);
  w.release('right');
  w.hold('left');
  let disarmed = false;
  for (let t = armedAt + 0.05; t < 5 && !disarmed; t += 0.05) {
    w.update(0.05);
    if (w.armed === null) disarmed = true;
  }
  assert.ok(disarmed, 'walking away disarms');
});

test('arm hysteresis: standing just inside radius does not flicker between frames', () => {
  const w = new StageWalk({ count: 1 }); // marker at .5
  w.x = 0.5 + ARM_RADIUS * 1.2; // outside arm, inside disarm bound
  w.armed = null;
  for (let t = 0; t < 1; t += 0.016) w.update(0.016);
  assert.equal(w.armed, null, 'not armed while parked outside arm radius');
  w.x = 0.5;
  w.update(0.016);
  assert.equal(w.armed, 0);
  for (let t = 1.2; t < 2; t += 0.016) w.update(0.016);
  assert.equal(w.armed, 0, 'stays armed while standing on it');
});

// ---------------------------------------------------------------- confirm
test('confirm reports the armed index; nothing armed = nothing confirmed', () => {
  const w = new StageWalk({ count: 3, now: () => 0 }); // markers .25 .5 .75
  w.x = 0.05; w.setChoiceCount(3); // stand clear of every marker
  assert.equal(w.armed, null);
  assert.deepEqual(w.apply('confirm'), {}, 'no arm, no confirm');
  w.apply('select:2');
  assert.equal(w.armed, 1, 'direct select arms marker 1');
  assert.deepEqual(w.apply('confirm'), { confirm: 1 });
});

test('keys 1-4 select choices directly even without walking', () => {
  const w = new StageWalk({ count: 4, now: () => 0 });
  for (const [key, idx] of [['1', 0], ['2', 1], ['3', 2], ['4', 3]]) {
    const r = w.apply(w.keyAction(key));
    assert.deepEqual(r, { selected: idx }, `key ${key}`);
    assert.equal(w.armed, idx);
    assert.equal(w.x, w.markers[idx], 'figure jumps to the marker');
  }
  assert.deepEqual(w.apply(w.keyAction('5')), {}, 'key 5 ignored (max 4)');
});

test('keyAction maps arrows, WASD, Enter/Space, digits; ignores the rest', () => {
  const w = new StageWalk({ count: 2 });
  assert.equal(w.keyAction('ArrowLeft'), 'left');
  assert.equal(w.keyAction('a'), 'left');
  assert.equal(w.keyAction('D'), 'right');
  assert.equal(w.keyAction('ArrowRight'), 'right');
  assert.equal(w.keyAction('Enter'), 'confirm');
  assert.equal(w.keyAction(' '), 'confirm');
  assert.equal(w.keyAction('3'), 'select:3');
  assert.equal(w.keyAction('Escape'), 'ignore');
  // SPEC v5 §1 supersedes the v4 line below: with roam ON (default), vertical
  // keys ARE walk input. The v4 contract is pinned separately on a v2:false rig.
  assert.equal(w.keyAction('ArrowUp'), 'up', 'v5 free-roam: ArrowUp walks up');
  assert.equal(w.keyAction('ArrowDown'), 'down');
  const legacy = new StageWalk({ count: 2, v2: false });
  assert.equal(legacy.keyAction('ArrowUp'), 'ignore', 'v4 mode: vertical keys are not walk input');
  assert.equal(legacy.keyAction('w'), 'ignore');
});

// ---------------------------------------------------------------- reduced motion
test('reduced motion: arrows teleport to markers, walk animation never shows', () => {
  const w = new StageWalk({ count: 4, reducedMotion: true }); // markers .2 .4 .6 .8
  w.x = 0.05; w.setChoiceCount(4); // stand clear of every marker
  assert.equal(w.armed, null);
  const r = w.apply('right');
  assert.equal(r.teleported, true);
  assert.equal(w.dir, 0, 'no continuous walk under reduced motion');
  for (let t = 0; t < 3; t += 0.05) w.update(0.05);
  assert.ok(Math.abs(w.x - w.markers[0]) < 1e-9, `glided to marker 0 (.2), got ${w.x}`);
  assert.equal(w.armed, 0);
  assert.ok(!WALK_FRAMES.includes(w.frame(0)), 'frame stays on the idle pose, never a gait frame');
  assert.equal(w.frame(0.3), 0);
});

// ---------------------------------------------------------------- frames
test('walk cycle alternates costume frames 3-4 (0-based 2,3) at 10fps; idle cycles all 4 at 6fps', () => {
  const w = new StageWalk({ count: 1 });
  assert.equal(w.frame(0), 0, 'idle starts at frame 0');
  assert.equal(w.frame(1 / IDLE_FPS), 1, 'idle advances at 6fps');
  w.hold('right');
  const seen = new Set();
  for (let t = 0; t < 0.5; t += 0.01) seen.add(w.frame(t));
  assert.deepEqual([...seen].sort(), [...WALK_FRAMES].sort(), 'walk shows exactly the two gait frames');
  assert.equal(w.frame(0), WALK_FRAMES[0]);
  assert.equal(w.frame(1 / WALK_FPS), WALK_FRAMES[1], 'gait swaps at 10fps');
  w.release('right');
  assert.ok([0, 1, 2, 3].includes(w.frame(1)), 'back to idle row');
});

// ---------------------------------------------------------------- card swap
test('setChoiceCount re-derives markers and drops a stale arm on card swap', () => {
  const w = new StageWalk({ count: 1, now: () => 0 }); // marker .5
  w.x = 0.5; w.update(0);
  assert.equal(w.armed, 0);
  w.setChoiceCount(3); // markers .25 .5 .75 — x .5 legitimately arms the new middle
  assert.equal(w.armed, 1);
  w.x = 0.05;
  w.setChoiceCount(2); // far from every marker -> no ghost arm
  assert.equal(w.armed, null);
});
