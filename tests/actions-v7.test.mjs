// tests/actions-v7.test.mjs — SPEC v7 §1: verbs + one-hand system.
// Sprint stamina math, crouch height, throw arc + fuse, one-hand swap/pickup/drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActionSystem, ensureV7State,
  SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  CROUCH_H, THROW_GRAV_MULT, FUSE_S, AIM_MIN_S, AIM_MAX_S,
  THROW_SPEED_MIN, THROW_SPEED_MAX, HELD_ITEMS,
} from '../src/engine/actions.js';
import { createPlayer } from '../src/engine/player.js';
import { MAX_RUN, PLAYER_H, GRAVITY } from '../src/engine/feel.js';

const DT = 1 / 60;
const flatColl = {
  solidAt(px, py) { return py >= 416; },
  floorJustBelow() { return 416; },
  ceilJustAbove() { return null; },
  snapDown(bx, feetY, maxDist) { return feetY <= 416 && 416 - feetY <= maxDist ? 416 : null; },
  nudgeX() { return null; },
};
const fakeGame = (over = {}) => ({ state: { resources: { sustenance: 20 }, chronicle: [], flags: [], ...over } });

function harness(over = {}) {
  const game = fakeGame(over);
  const player = createPlayer({ x: 100, y: 360, collider: flatColl });
  for (let i = 0; i < 120; i++) player.update({}, DT); // settle
  const throws = [];
  const actions = createActionSystem({ game, player, onThrow: (s) => throws.push(s) });
  return { game, player, actions, throws };
}

// ---- constants ---------------------------------------------------------------
test('v7: sprint/crouch/fuse constants match SPEC', () => {
  assert.equal(SPRINT_MULT, 1.6);
  assert.equal(STAMINA_MAX, 100);
  assert.equal(STAMINA_DRAIN, 25);
  assert.equal(STAMINA_REGEN, 18);
  assert.equal(CROUCH_H, PLAYER_H / 2);
  assert.equal(THROW_GRAV_MULT, 0.8);
  assert.equal(FUSE_S, 0.6);
});

// ---- sprint / stamina ----------------------------------------------------------
test('v7: sprint raises the speed cap to 1.6× MAX_RUN while moving with stamina', () => {
  const { actions } = harness();
  assert.equal(actions.speedCap(), MAX_RUN); // not sprinting at rest
  for (let i = 0; i < 10; i++) actions.update({ sprint: true, right: true }, DT);
  assert.ok(actions.sprinting);
  assert.ok(Math.abs(actions.speedCap() - MAX_RUN * 1.6) < 1e-9);
});

test('v7: stamina drains 25/s sprinting and regens 18/s when not', () => {
  const { game, actions } = harness();
  const st = game.state.v7;
  for (let i = 0; i < 60; i++) actions.update({ sprint: true, right: true }, DT);
  assert.ok(Math.abs(st.stamina - (STAMINA_MAX - STAMINA_DRAIN)) < 0.1, `after 1s drain: ${st.stamina}`);
  for (let i = 0; i < 60; i++) actions.update({}, DT);
  assert.ok(Math.abs(st.stamina - (STAMINA_MAX - STAMINA_DRAIN + STAMINA_REGEN)) < 0.1, `after 1s regen: ${st.stamina}`);
});

test('v7: no sprint at zero stamina (walk only), regen refills', () => {
  const { game, actions } = harness();
  game.state.v7.stamina = 0;
  actions.update({ sprint: true, right: true }, DT);
  assert.equal(actions.sprinting, false);
  assert.equal(actions.speedCap(), MAX_RUN);
  actions.update({ right: true }, DT); // walking regens
  assert.ok(game.state.v7.stamina > 0);
});

test('v7: standing still never burns stamina', () => {
  const { game, actions } = harness();
  for (let i = 0; i < 120; i++) actions.update({ sprint: true }, DT); // hold shift, don't move
  assert.equal(game.state.v7.stamina, STAMINA_MAX);
});

test('v7: sprint flows into the player body via input.maxRun', async () => {
  const { player, actions } = harness();
  // run with sprint cap until terminal horizontal speed
  for (let i = 0; i < 180; i++) {
    actions.update({ sprint: true, right: true }, DT);
    player.update({ right: true, maxRun: actions.speedCap() }, DT);
  }
  assert.ok(player.vx > MAX_RUN * 1.4, `vx=${player.vx} should exceed MAX_RUN`);
});

// ---- crouch --------------------------------------------------------------------
test('v7: crouch halves the collision box, stand restores it', () => {
  const { player, actions } = harness();
  const feet = player.y + player.h;
  actions.update({ crouch: true }, DT);
  assert.equal(player.h, CROUCH_H);
  assert.equal(player.y + player.h, feet); // feet stay planted
  actions.update({ crouch: false }, DT);
  assert.equal(player.h, PLAYER_H);
});

// ---- throw -----------------------------------------------------------------------
test('v7: hold X to aim, release throws an arc projectile consuming the held item', () => {
  const { game, actions, throws } = harness({ v7: { held: 'stone' } });
  actions.update({ aimHeld: true }, DT);
  actions.update({ aimHeld: true }, DT);
  assert.equal(game.state.v7.held, 'stone'); // aiming does not consume
  const ev = actions.update({ aimHeld: false }, DT);
  assert.equal(ev.thrown.item, 'stone');
  assert.equal(game.state.v7.held, null);   // consumed at launch
  assert.equal(throws.length, 1);
  const t = throws[0];
  assert.ok(t.vy < 0, 'arc launches upward');
  assert.equal(t.fuse, null); // stone has no fuse
});

test('v7: longer aim holds throw faster between MIN and MAX speed', () => {
  const tap = harness({ v7: { held: 'stone' } });
  tap.actions.update({ aimHeld: true }, DT);
  tap.actions.update({}, DT);
  const full = harness({ v7: { held: 'stone' } });
  for (let i = 0; i < 90; i++) full.actions.update({ aimHeld: true }, DT); // 1.5 s hold
  full.actions.update({}, DT);
  const tapSpeed = Math.hypot(tap.throws[0].vx, tap.throws[0].vy);
  const fullSpeed = Math.hypot(full.throws[0].vx, full.throws[0].vy);
  assert.ok(Math.abs(tapSpeed - THROW_SPEED_MIN) < 5, `tap=${tapSpeed}`);
  assert.ok(Math.abs(fullSpeed - THROW_SPEED_MAX) < 5, `full=${fullSpeed}`);
});

test('v7: torch throws carry a 0.6 s fuse; direction follows facing', () => {
  const { player, actions, throws } = harness({ v7: { held: 'torch' } });
  player.facing = -1; // body faces left (walked there)
  actions.update({ aimHeld: true }, DT);
  actions.update({}, DT);
  assert.equal(throws[0].fuse, FUSE_S);
  assert.ok(throws[0].vx < 0, 'facing left → thrown left');
});

test('v7: empty-hand throw produces nothing', () => {
  const { actions, throws } = harness();
  actions.update({ aimHeld: true }, DT);
  const ev = actions.update({}, DT);
  assert.ok(!ev || !ev.thrown);
  assert.equal(throws.length, 0);
  assert.equal(actions.lastThrowReason, 'empty hand');
});

// ---- one-hand system -------------------------------------------------------------
test('v7: one hand — second pickup refused, drop frees, swap replaces', () => {
  const { game, actions } = harness();
  assert.ok(actions.pickup('stone'));
  assert.equal(actions.pickup('torch'), false);        // hand busy
  assert.equal(game.state.v7.held, 'stone');
  assert.equal(actions.drop(), 'stone');
  assert.equal(game.state.v7.held, null);
  actions.pickup('torch');
  assert.equal(actions.swapHand('spear'), 'torch');    // swap returns the old item
  assert.equal(game.state.v7.held, 'spear');
});

test('v7: held stays within the legal item set through save round-trip', () => {
  const { game } = harness({ v7: { held: 'glowball' } }); // illegal value in a corrupt save
  ensureV7State(game.state);
  assert.equal(game.state.v7.held, null);
  assert.deepEqual([...HELD_ITEMS], ['stone', 'torch', 'spear', 'fruit', 'tool']);
});

test('v7: countable pocket tracks coin/credit with spend guard', () => {
  const { actions } = harness();
  actions.addCountable('coin', 7);
  assert.equal(actions.countable('coin'), 7);
  assert.ok(actions.spendCountable('coin', 5));
  assert.equal(actions.countable('coin'), 2);
  assert.equal(actions.spendCountable('coin', 5), false);
  assert.equal(actions.countable('coin'), 2);
});
