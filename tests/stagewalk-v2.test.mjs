// tests/stagewalk-v2.test.mjs — SPEC v5 §1: free-roam 2D movement, floor-band
// arming, idle drift-back, reduced-motion paths, and the v4-compat flag.
//
// Like the v4 suite, every controller here gets a FAKE clock (`now: c.now`):
// update()'s default dt reads real performance time, so an explicit-dt test on
// a live clock would double-count frames between assertions.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StageWalk, FLOOR_TOP, IDLE_DRIFT_DELAY, DRIFT_SPEED, WALK_SPEED,
} from '../src/ui/stageWalk.js';

const clock = () => {
  let t = 0;
  return { now: () => t, set: (v) => { t = v; }, advance: (d) => { t += d; } };
};

// ---------------------------------------------------------------- 2D movement
test('v5 §1: vertical hold moves y inside the walkable band [0, FLOOR_TOP]', () => {
  const w = new StageWalk({ count: 2, now: clock().now });
  assert.equal(w.y, FLOOR_TOP, 'starts on the floor line');
  w.hold('up');
  w.update(1);
  assert.ok(Math.abs(w.y - (FLOOR_TOP - WALK_SPEED)) < 1e-9, `up 1s ≈ ${FLOOR_TOP - WALK_SPEED}, got ${w.y}`);
  w.update(9); // long hold clamps at the stage top, never above it
  assert.equal(w.y, 0);
  w.release('up');
  w.hold('down');
  w.update(9);
  assert.equal(w.y, FLOOR_TOP, 'clamped at the floor line');
});

test('v5 §1: diagonal roam — x and y integrate together', () => {
  const w = new StageWalk({ count: 3, now: clock().now });
  w.x = 0.5; w.y = 0.4;
  w.hold('right'); w.hold('up');
  w.update(0.5);
  assert.ok(w.x > 0.5 && w.y < 0.4, 'both axes move');
  w.release('right'); w.release('up');
});

// ------------------------------------------------------------ floor-band arm
test('v5 §1: arming requires standing on the floor band; vertical never arms or disarms', () => {
  const w = new StageWalk({ count: 2, now: clock().now });
  // Stand under marker 0 (x≈0.33) on the floor line: armed.
  w.x = 1 / 3; w.y = FLOOR_TOP;
  w.update(0.016);
  assert.equal(w.armed, 0, 'on the floor under a marker: armed');
  // Walk up off the band: stays armed (going upstage to look around keeps your choice)...
  w.hold('up'); w.update(0.5); w.release('up');
  assert.ok(!w.onFloor(), 'off the floor band');
  w.update(0.016);
  assert.equal(w.armed, 0, 'vertical movement does NOT disarm');
  // ...but moving in x while OFF the band never (re-)arms any marker.
  const w2 = new StageWalk({ count: 2, now: clock().now });
  w2.setChoiceCount(0);            // drop the constructor's on-floor auto-arm
  w2.x = 0.05; w2.y = 0.3;         // off band (upstage), nowhere near a marker
  w2.hold('right'); w2.update(0.4); w2.release('right'); // crosses marker 0's x off-band
  w2.update(0.016);
  assert.equal(w2.armed, null, 'crossing a marker x while off-band never arms');
});

// --------------------------------------------------------------- drift-back
test('v5 §1: idle for IDLE_DRIFT_DELAY eases back to the floor line', () => {
  const w = new StageWalk({ count: 2, now: clock().now });
  w.hold('up'); w.update(0.4); w.release('up'); // step upstage off the floor line
  const lifted = w.y;
  assert.ok(lifted < FLOOR_TOP - 0.05, 'figure is lifted off the floor');
  w.update(IDLE_DRIFT_DELAY - 0.5);              // not yet idle enough
  assert.equal(w.y, lifted, 'no drift before the delay elapses');
  for (let i = 0; i < 60; i++) w.update(0.25);   // idle out the drift
  assert.equal(w.y, FLOOR_TOP, 'drifted back onto the floor line');
  assert.ok(DRIFT_SPEED > 0);
});

test('v5 §1: any input during the idle window resets the drift timer', () => {
  const w = new StageWalk({ count: 2, now: clock().now });
  w.hold('up'); w.update(0.4); w.release('up');
  w.update(IDLE_DRIFT_DELAY - 0.2);
  w.hold('up'); w.update(0.1); w.release('up');  // fresh input re-times the idle
  w.update(IDLE_DRIFT_DELAY - 0.2);
  assert.ok(w.y < FLOOR_TOP, 'still lifted — timer restarted by the input');
});

// ---------------------------------------------------------- reduced motion
test('v5 §1: reduced motion snaps straight back to the floor line (no easing)', () => {
  const w = new StageWalk({ count: 2, reducedMotion: true, now: clock().now });
  w.hold('up'); w.update(0.4); w.release('up'); // step upstage off the floor line
  assert.ok(w.y < FLOOR_TOP, 'lifted off the floor line first');
  w.update(2); // idle frames stay under update()'s 2s dt cap
  w.update(1.9); // idleT 3.9: not yet at the threshold
  assert.ok(w.y < FLOOR_TOP, 'still lifted before the delay elapses');
  w.update(0.2); // crosses IDLE_DRIFT_DELAY: reduced motion snaps in this frame
  assert.equal(w.y, FLOOR_TOP, 'instant snap under reduced motion');
  assert.equal(w.frame(1.0), 0, 'reduced motion pins the idle pose');
});

test('v5 §1: reduced motion ignores vertical keys but still consumes them via keyAction mapping', () => {
  const w = new StageWalk({ count: 2, reducedMotion: true, now: clock().now });
  const r = w.apply('up');
  assert.equal(r.moved, false, 'no vertical teleport under reduced motion');
  assert.equal(w.y, FLOOR_TOP, 'y untouched');
});

// -------------------------------------------------------------- v4 compat
test('v5 §1: v2:false restores the exact v4 contract (no vertical, no drift)', () => {
  const w = new StageWalk({ count: 2, v2: false, now: clock().now });
  assert.equal(w.keyAction('ArrowUp'), 'ignore');
  assert.equal(w.keyAction('w'), 'ignore');
  assert.equal(w.keyAction('ArrowDown'), 'ignore');
  assert.equal(w.keyAction('ArrowLeft'), 'left', 'horizontal keys unchanged');
  w.y = 0.5;
  w.update(IDLE_DRIFT_DELAY * 3);
  assert.equal(w.y, 0.5, 'legacy mode never drifts');
});

test('v5 §4: forfeitAction maps Escape only (walk mode keeps the v4 key contract)', () => {
  const w = new StageWalk({ count: 2, now: clock().now });
  assert.equal(w.forfeitAction('Escape'), 'forfeit');
  assert.equal(w.forfeitAction('Enter'), 'ignore');
  assert.equal(w.keyAction('Escape'), 'ignore', 'Escape is not walk input');
});
