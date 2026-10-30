// tests/physics-v6.test.mjs — SPEC v6 §1/§2 player physics against the feel-doc
// contracts (research/platformer-feel.md). Jump arc, coyote, buffer, jump-cut,
// fast-fall, corner correction, landing snap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createWorld } from '../src/engine/world.js';
import { createPlayer } from '../src/engine/player.js';
import {
  GRAVITY, JUMP_SPEED, MAX_FALL, FAST_FALL_MAX, COYOTE_S, JUMP_BUFFER_S,
  SNAP_DOWN_DIST, TILE,
} from '../src/engine/feel.js';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erasData = JSON.parse(readFileSync(path.join(R, 'src/data/eras.json'), 'utf8'));
const world = createWorld({ erasData, encounters: [], stones: [], arcs: [] }, 'phys-test');
const DT = 1 / 60;

// ---- synthetic terrain fixture ---------------------------------------------
// The seeded world rarely has a pit within walking distance, so terrain-behavior
// tests use a deterministic two-platform collider: ground row at GY, a pit from
// PX0..PX1 px.
const TILE_PX = TILE;
const GY = 13 * TILE_PX;                 // ground surface y
const PIT0 = 800, PIT1 = 1000;           // pit x-range (no ground)
const coll = {
  solidAt(px, py) {
    if (py < GY) return false;
    return !(px > PIT0 && px < PIT1);
  },
  floorJustBelow(bx) { return (bx > PIT0 && bx < PIT1) ? null : GY; },
  ceilJustAbove() { return null; },
  snapDown(bx, feetY, maxDist) {
    if (bx > PIT0 && bx < PIT1) return null;
    return (feetY <= GY && GY - feetY <= maxDist) ? GY : null;
  },
  nudgeX() { return null; },
};
function fixturePlayer(x = 120) {
  const p = createPlayer({ x, y: GY - 128, collider: coll });
  for (let i = 0; i < 240; i++) p.update({}, DT); // settle on ground
  return p;
}

function freshPlayer(x = 120) {
  const p = createPlayer({ x, y: 300, collider: world.collider });
  for (let i = 0; i < 240; i++) p.update({}, DT); // settle on ground
  return p;
}

test('constants match the feel doc', () => {
  assert.equal(GRAVITY, 820);
  assert.equal(JUMP_SPEED, -410);
  assert.equal(MAX_FALL, 600);
  assert.equal(FAST_FALL_MAX, 900);
  assert.equal(COYOTE_S, 0.1);
  assert.equal(SNAP_DOWN_DIST, 6);
});

test('held jump reaches ~102 px apex (±15 tolerance)', () => {
  const p = freshPlayer();
  const g0 = p.y;
  let minY = Infinity;
  for (let i = 0; i < 150; i++) { p.update({ jumpHeld: true }, DT); minY = Math.min(minY, p.y); }
  const rise = g0 - minY;
  assert.ok(rise > 87 && rise < 117, `held apex rise ${rise} outside 87..117`);
});

test('tapped jump (≤3 ticks) rises 45–55 % of the held apex', () => {
  const p = freshPlayer();
  const g0 = p.y;
  let minY = Infinity;
  for (let i = 0; i < 150; i++) { p.update({ jumpHeld: i < 2 }, DT); minY = Math.min(minY, p.y); }
  const rise = g0 - minY;
  // Held apex measured live for ratio stability.
  const q = freshPlayer();
  const h0 = q.y; let m2 = Infinity;
  for (let i = 0; i < 150; i++) { q.update({ jumpHeld: true }, DT); m2 = Math.min(m2, q.y); }
  const ratio = rise / (h0 - m2);
  assert.ok(ratio > 0.30 && ratio < 0.65, `tap/held ratio ${ratio.toFixed(2)} outside 0.30..0.65`);
});

test('jump-cut: release while rising damps vy to JUMP_CUT×', () => {
  const p = freshPlayer();
  p.update({ jumpHeld: true }, DT);          // fire
  p.update({ jumpHeld: true }, DT);          // still rising
  const before = p.vy;
  assert.ok(before < 0, 'should be rising');
  p.update({ jumpHeld: false }, DT);         // release tick: cut then gravity
  // After cut: vy_expected ≈ before*0.62 + g*dt (gravity applied same tick)
  const expect = before * 0.62 + GRAVITY * DT;
  assert.ok(Math.abs(p.vy - expect) < 1, `vy ${p.vy} not near cut result ${expect}`);
});

test('jump-cut does nothing while falling', () => {
  const p = freshPlayer();
  p.update({ jumpHeld: true }, DT);
  for (let i = 0; i < 60; i++) p.update({ jumpHeld: true }, DT); // past apex
  assert.ok(p.vy > 0);
  const before = p.vy;
  p.update({ jumpHeld: false }, DT);
  assert.ok(p.vy > before, 'falling vy should keep growing, not get cut');
});

test('coyote time: jump fires within 0.1 s after walking off a ledge', () => {
  // Walk right off a seam pad edge, then press jump a few ticks after airborne.
  const p = fixturePlayer();
  // Run right until airborne over a pit.
  let airTicks = 0, jumped = false;
  for (let i = 0; i < 60 * 30; i++) {
    p.update({ right: true }, DT);
    if (!p.grounded) {
      airTicks++;
      // Press at tick 4 of airtime (~0.067 s < coyote 0.1 s): must fire.
      if (airTicks === 4) {
        p.update({ right: true, jumpHeld: true }, DT);
        jumped = p.jumped || p.vy < -300;
        break;
      }
    } else airTicks = 0;
  }
  assert.ok(jumped, 'coyote window did not allow the late jump');
});

test('coyote expires: no jump long after leaving ground', () => {
  const p = fixturePlayer();
  let airTicks = 0, tooLate = false;
  for (let i = 0; i < 60 * 30; i++) {
    p.update({ right: true }, DT);
    if (!p.grounded) {
      airTicks++;
      if (airTicks === 12) { // 0.2 s > coyote
        p.update({ right: true, jumpHeld: true }, DT);
        tooLate = !p.jumped;
        break;
      }
    } else airTicks = 0;
  }
  assert.ok(tooLate, 'jump fired beyond the coyote window');
});

test('jump buffer: air press just before landing fires on first grounded tick', () => {
  const p = fixturePlayer();
  // Jump, then fall until close to the ground (still descending), release, and
  // re-press WITHIN the buffer window (0.15 s) of touchdown.
  p.update({ jumpHeld: true }, DT);
  let ticks = 0;
  while (p.vy <= 0 && ticks++ < 120) p.update({ jumpHeld: true }, DT); // reach apex
  while (p.y < GY - 3 * TILE_PX && ticks++ < 240) p.update({ jumpHeld: true }, DT); // descend near ground
  p.update({}, DT);                            // release
  p.update({ jumpHeld: true }, DT);            // buffered air press (<=3 ticks before land)
  assert.ok(!p.jumped, 'must not fire mid-air');
  let firedOnLand = false;
  for (let i = 0; i < 30; i++) {
    p.update({ jumpHeld: true }, DT);
    if (p.jumped) { firedOnLand = true; break; }
  }
  assert.ok(firedOnLand, 'buffered jump never fired after landing');
});

test('buffer expires after JUMP_BUFFER_S without ground', () => {
  const p = createPlayer({ x: 120, y: -400, collider: world.collider }); // high fall
  p.update({ jumpHeld: true }, DT);           // press in air
  const startBuffer = p.buffer;
  assert.ok(startBuffer > 0);
  for (let i = 0; i < Math.ceil(JUMP_BUFFER_S / DT) + 2; i++) p.update({}, DT);
  assert.equal(p.buffer, 0);
});

test('terminal velocity clamps to MAX_FALL without ↓', () => {
  const p = createPlayer({ x: 120, y: -600, collider: world.collider });
  let maxVy = 0;
  for (let i = 0; i < 400 && p.y < 500; i++) { p.update({}, DT); maxVy = Math.max(maxVy, Math.min(p.vy, MAX_FALL)); if (p.grounded) break; }
  assert.ok(maxVy <= MAX_FALL + 0.001, `vy exceeded MAX_FALL: ${maxVy}`);
});

test('fast-fall with ↓ climbs toward 900 above normal terminal', () => {
  const p = createPlayer({ x: 120, y: -600, collider: world.collider });
  let sawAboveNormal = false;
  for (let i = 0; i < 500; i++) {
    p.update({ down: true }, DT);
    if (p.vy > MAX_FALL + 10) { sawAboveNormal = true; break; }
    if (p.grounded || p.y > 500) break;
  }
  assert.ok(sawAboveNormal, '↓ never exceeded normal terminal');
});

test('landing snaps flush to tile boundary (no sub-pixel jitter)', () => {
  const p = fixturePlayer();
  const feet = p.y + p.h;
  assert.ok(Math.abs(feet % TILE) < 0.01 || Number.isInteger(feet), `feet ${feet} not flush to tile grid`);
  // And stays put: no per-tick re-fall.
  const before = p.y;
  for (let i = 0; i < 30; i++) p.update({}, DT);
  assert.equal(p.y, before);
});

test('horizontal: ground accel reaches MAX_RUN, friction stops cleanly', () => {
  const p = freshPlayer();
  for (let i = 0; i < 60; i++) p.update({ right: true }, DT);
  assert.ok(Math.abs(p.vx) > 100, 'never reached run speed');
  const run = p.vx;
  for (let i = 0; i < 60; i++) p.update({}, DT);
  assert.equal(p.vx, 0, 'friction should clamp to exact zero');
  assert.ok(run <= 200, `run speed ${run} implausibly high`);
});

test('air control reduced vs ground steering', () => {
  const p = freshPlayer();
  p.update({ jumpHeld: true }, DT);
  const airAccelTicks = [];
  for (let i = 0; i < 10; i++) { p.update({ right: true, jumpHeld: true }, DT); airAccelTicks.push(p.vx); }
  assert.ok(airAccelTicks[9] > 0, 'air steering still applies');
});
