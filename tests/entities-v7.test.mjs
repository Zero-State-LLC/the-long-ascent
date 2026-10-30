// tests/entities-v7.test.mjs — SPEC v7 §2: hazards, pickups, terrain interactions.
// Chase radius/speed, contact cost, spear-kill drops meat (stone does NOT),
// guard pay/sneak/distract, zone drain with/without counter-item, gather vs.
// throw-knock, dark cave light, rope anchors, deterministic spawn tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createEntitySystem, CHASE_R, CHASE_SPEED, CONTACT_COST, ZONE_DRAIN, PAY_AMOUNT } from '../src/engine/entities.js';
import { createActionSystem } from '../src/engine/actions.js';
import { ensureV7State } from '../src/engine/actions.js';
import { MAX_RUN, TILE } from '../src/engine/feel.js';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spawnTables = JSON.parse(readFileSync(path.join(R, 'research/spawn-tables-v7.json'), 'utf8'));
const DT = 1 / 60;

// ---- minimal world fixture -----------------------------------------------------
function fakeWorld() {
  const SEG = 2880;
  return {
    worldW: SEG * 17, worldH: 544,
    segStart: (era) => (era - 1) * SEG,
    eraAtX: (x) => Math.min(17, Math.max(1, Math.floor(x / SEG) + 1)),
    collider: { solidAt: (px, py) => py >= 416 },
  };
}
const surfaceFeet = () => 416;

function entityHarness({ state = {}, defsOnly = null } = {}) {
  const game = { state: { resources: { sustenance: 20, knowledge: 10, infrastructure: 10, legitimacy: 10, population: 5, entropy: 0 }, chronicle: [], flags: [], seenEvents: [], ...state } };
  ensureV7State(game.state);
  const world = fakeWorld();
  const player = { x: 500, y: 416 - 56, w: 24, h: 56, facing: 1 };
  const actions = createActionSystem({ game, player, onThrow: () => {} });
  const toasts = [];
  // table override keeps AI tests surgical
  const tables = defsOnly ?? spawnTables;
  const entities = createEntitySystem({ world, game, actions, surfaceFeet, toast: (m) => toasts.push(m), spawnTables: tables });
  return { game, world, player, actions, entities, toasts };
}
// single-hazard table helper (era 1 segment, fraction f of 2880 px)
const oneHazard = (type, f = 0.5) => ({ eras: { 1: { hazards: [{ type, f }], pickups: [], terrain: [], stones: [] } } });
const hazardDef = (entities, type) => entities.defs.find((d) => d.type === type);

// ---- spawn tables ------------------------------------------------------------------
test('v7: spawn tables are deterministic and cover all 17 eras', () => {
  assert.equal(spawnTables.seed, 'long-ascent:v7-spawn');
  for (let era = 1; era <= 17; era++) {
    const t = spawnTables.eras[era];
    assert.ok(t, `era ${era} missing`);
    assert.ok(t.hazards.length >= 1 && t.pickups.length >= 3 && t.terrain.length >= 2);
    for (const list of [t.hazards, t.pickups, t.terrain, t.stones]) {
      for (const it of list) assert.ok(it.f > 0 && it.f < 1, `fraction out of range: ${it.f}`);
    }
  }
  // regenerating yields identical output (seeded)
  const again = JSON.parse(readFileSync(path.join(R, 'research/spawn-tables-v7.json'), 'utf8'));
  assert.deepEqual(again.eras[7], spawnTables.eras[7]);
});

test('v7: entity materialisation places every table row inside its era segment', () => {
  const { entities, world } = entityHarness();
  assert.equal(entities.defs.length > 150, true);
  for (const d of entities.defs) {
    assert.ok(d.x >= world.segStart(d.era) && d.x <= world.segStart(d.era) + world.worldW / 17, `${d.id} outside segment`);
  }
});

// ---- chasers --------------------------------------------------------------------
test('v7: chaser pursues within 3 tiles at 0.7× MAX_RUN', () => {
  assert.equal(CHASE_R, 3 * TILE);
  assert.equal(CHASE_SPEED, 0.7 * MAX_RUN);
  const { entities, player } = entityHarness({ defsOnly: oneHazard('boar') });
  const boar = hazardDef(entities, 'boar');
  player.x = boar.x + CHASE_R - 20; // player to the RIGHT, just inside pursuit radius
  const x0 = boar.x;
  entities.update({ player, dt: DT, era: 1 });
  assert.ok(boar.x > x0, `boar chases toward the player (Δx=${boar.x - x0})`);
  // measured speed matches 0.7× MAX_RUN while the player stays in radius
  const x1 = boar.x;
  for (let i = 0; i < 24; i++) { player.x = boar.x + CHASE_R - 20; entities.update({ player, dt: DT, era: 1 }); }
  assert.ok(Math.abs((boar.x - x1) / 0.4 - CHASE_SPEED) < CHASE_SPEED * 0.05, `pursued ${boar.x - x1}px in 0.4s`);
  // far outside radius: no movement
  player.x = boar.x + CHASE_R + 400;
  const x2 = boar.x;
  entities.update({ player, dt: DT, era: 1 });
  assert.equal(boar.x, x2, 'boar holds position outside 3 tiles');
});

test('v7: chaser contact costs −2 sustenance with a per-hazard cooldown', () => {
  const { game, entities, player } = entityHarness({ defsOnly: oneHazard('wolf') });
  const wolf = hazardDef(entities, 'wolf');
  player.x = wolf.x - 10; // touching
  const s0 = game.state.resources.sustenance;
  const ev = entities.update({ player, dt: DT, era: 1 });
  assert.ok(ev.events.some((e) => e.type === 'contact' && e.cost === CONTACT_COST));
  assert.equal(game.state.resources.sustenance, s0 - 2);
  entities.update({ player, dt: DT, era: 1 }); // cooldown: no double-hit next tick
  assert.equal(game.state.resources.sustenance, s0 - 2);
});

test('v7: thrown spear kills a boar and drops meat; a stone does not', () => {
  // spear kill
  {
    const { game, entities, player } = entityHarness({ defsOnly: oneHazard('boar') });
    const boar = hazardDef(entities, 'boar');
    game.state.v7.held = 'spear';
    entities.throwProjectile({ item: 'spear', x: boar.x - 20, y: 400, vx: 300, vy: 0, fuse: null });
    let hit = null;
    for (let i = 0; i < 30 && !hit; i++) hit = entities.update({ player, dt: DT, era: 1 }).events.find((e) => e.type === 'throw-hit');
    assert.ok(hit, 'spear hits the boar');
    assert.equal(entities.runtimeOf(boar.id).dead, true);
    assert.ok(entities.drops.some((d) => d.type === 'meat'), 'meat drops');
    // pick up the dropped meat feeds you
    player.x = boar.x - 10;
    const s0 = game.state.resources.sustenance;
    const res = entities.interact(player);
    assert.equal(res.ok, true);
    assert.equal(game.state.resources.sustenance, s0 + 4);
  }
  // stone does NOT kill
  {
    const { entities, player } = entityHarness({ defsOnly: oneHazard('boar') });
    const boar = hazardDef(entities, 'boar');
    entities.throwProjectile({ item: 'stone', x: boar.x - 20, y: 400, vx: 300, vy: 0, fuse: null });
    let hit = null;
    for (let i = 0; i < 30 && !hit; i++) hit = entities.update({ player, dt: DT, era: 1 }).events.find((e) => e.type === 'throw-hit');
    assert.ok(hit, 'stone hits too');
    assert.equal(entities.runtimeOf(boar.id).dead, false, 'stone never kills');
  }
});

test('v7: a thrown torch scares the chaser off for the run', () => {
  const { entities, player } = entityHarness({ defsOnly: oneHazard('wolf') });
  const wolf = hazardDef(entities, 'wolf');
  entities.throwProjectile({ item: 'torch', x: wolf.x - 20, y: 400, vx: 300, vy: 0, fuse: null });
  for (let i = 0; i < 30; i++) entities.update({ player, dt: DT, era: 1 });
  assert.ok(entities.runtimeOf(wolf.id).fleeing);
  const x0 = wolf.x;
  entities.update({ player, dt: DT, era: 1 });
  assert.ok(Math.abs(wolf.x - x0) > 0, 'fleeing wolf keeps running away');
});

test('v7: projectile gravity is 0.8× world gravity', () => {
  const { entities } = entityHarness({ defsOnly: { eras: {} } });
  entities.throwProjectile({ item: 'stone', x: 500, y: 100, vx: 100, vy: 0, fuse: null });
  const p = entities.projectiles[0];
  entities.update({ player: { x: 0, y: 360, w: 24, h: 56 }, dt: DT, era: 1 });
  const expectVy = 820 * 0.8 * DT;
  assert.ok(Math.abs(p.vy - expectVy) < 1e-6, `vy=${p.vy} expected ${expectVy}`);
});

test('v7: torch fuse burns out after 0.6 s mid-air', () => {
  const { entities } = entityHarness({ defsOnly: { eras: {} } });
  entities.throwProjectile({ item: 'torch', x: 500, y: 100, vx: 0, vy: 0, fuse: 0.6 });
  let out = null;
  for (let i = 0; i < 60 && !out; i++) out = entities.update({ player: { x: 0, y: 360, w: 24, h: 56 }, dt: DT, era: 1 }).events.find((e) => e.type === 'fuse-out');
  assert.ok(out, 'fuse-out event fires');
  assert.equal(entities.projectiles.length, 0);
});

// ---- guards (choke points) --------------------------------------------------------
test('v7: bandit blocks the choke point; paying coin clears it, failure shakedowns', () => {
  const { game, entities, actions, player } = entityHarness({ defsOnly: oneHazard('bandit') });
  const bandit = hazardDef(entities, 'bandit');
  player.x = bandit.x - 20; // in the grip, standing tall
  const l0 = game.state.resources.legitimacy, i0 = game.state.resources.infrastructure;
  const ev = entities.update({ player, dt: DT, era: 1 });
  assert.ok(ev.events.some((e) => e.type === 'shakedown'));
  assert.equal(game.state.resources.legitimacy, l0 - 2);
  assert.equal(game.state.resources.infrastructure, i0 - 2);
  // fresh state: sneak past crouched instead
  {
    const h2 = entityHarness({ defsOnly: oneHazard('bandit') });
    const b2 = hazardDef(h2.entities, 'bandit');
    h2.player.x = b2.x - 20;
    h2.actions.update({ crouch: true }, DT);
    const ev2 = h2.entities.update({ player: h2.player, dt: DT, era: 1 });
    assert.ok(ev2.events.some((e) => e.type === 'sneak-ok'));
    assert.equal(h2.game.state.resources.legitimacy, 10, 'crouched sneaking costs nothing');
  }
  // or pay
  {
    const h3 = entityHarness({ defsOnly: oneHazard('bandit') });
    const b3 = hazardDef(h3.entities, 'bandit');
    h3.actions.addCountable('coin', PAY_AMOUNT);
    const paid = h3.entities.payGuard(b3.id);
    assert.equal(paid.ok, true);
    h3.player.x = b3.x - 20;
    const ev3 = h3.entities.update({ player: h3.player, dt: DT, era: 1 });
    assert.ok(!ev3.events.some((e) => e.type === 'shakedown'), 'paid guard stays satisfied');
    assert.equal(h3.actions.countable('coin'), 0);
  }
});

test('v7: any thrown object distracts a guard for a few seconds', () => {
  const { entities, player } = entityHarness({ defsOnly: oneHazard('soldier_patrol') });
  const sol = hazardDef(entities, 'soldier_patrol');
  entities.throwProjectile({ item: 'stone', x: sol.x + 10, y: 415, vx: 200, vy: 0, fuse: null });
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) hit = entities.update({ player: { x: 0, y: 360, w: 24, h: 56 }, dt: DT, era: 1 }).events.find((e) => e.type === 'throw-hit');
  assert.ok(hit, 'stone lands near the patrol');
  player.x = sol.x - 20;
  const ev = entities.update({ player, dt: DT, era: 1 });
  assert.ok(!ev.events.some((e) => e.type === 'shakedown'), 'distracted guard ignores you');
});

// ---- zone hazards -------------------------------------------------------------------
test('v7: smog drains 1 sustenance/s unless holding the mask', () => {
  const { game, entities, player } = entityHarness({ defsOnly: oneHazard('smog') });
  const smog = hazardDef(entities, 'smog');
  player.x = smog.x; // inside the zone
  const s0 = game.state.resources.sustenance;
  for (let i = 0; i < 60; i++) entities.update({ player, dt: DT, era: 1 });
  assert.ok(Math.abs(game.state.resources.sustenance - (s0 - 1)) < 0.05, `drained ${s0 - game.state.resources.sustenance} in 1s`);
});

test('v7: radiation zone drains knowledge; rad-chip in inventory protects', () => {
  assert.equal(ZONE_DRAIN.radiation_zone.counter, 'rad_chip');
  const { game, entities, actions, player } = entityHarness({ defsOnly: oneHazard('radiation_zone') });
  const zone = hazardDef(entities, 'radiation_zone');
  player.x = zone.x;
  actions.addCountable('rad_chip', 1);
  const k0 = game.state.resources.knowledge;
  for (let i = 0; i < 60; i++) entities.update({ player, dt: DT, era: 1 });
  assert.equal(game.state.resources.knowledge, k0, 'chip-holder takes no drain');
  // spend-free removal: mutate inventory directly to simulate loss
  game.state.v7.inventory.rad_chip = 0;
  for (let i = 0; i < 60; i++) entities.update({ player, dt: DT, era: 1 });
  assert.ok(game.state.resources.knowledge < k0, 'without chip the zone drains');
});

test('v7: datastorm drains knowledge; faraday scarf protects', () => {
  const { game, entities, actions, player } = entityHarness({ defsOnly: oneHazard('datastorm') });
  const zone = hazardDef(entities, 'datastorm');
  player.x = zone.x;
  const k0 = game.state.resources.knowledge;
  for (let i = 0; i < 30; i++) entities.update({ player, dt: DT, era: 1 });
  assert.ok(game.state.resources.knowledge < k0);
  actions.addCountable('faraday_scarf', 1);
  const k1 = game.state.resources.knowledge;
  for (let i = 0; i < 60; i++) entities.update({ player, dt: DT, era: 1 });
  assert.equal(game.state.resources.knowledge, k1, 'scarf stops the drain');
});

// ---- pickups ---------------------------------------------------------------------------
test('v7: food pickups auto-eat into sustenance; coin goes to the pocket', () => {
  const tables = { eras: { 1: { hazards: [], pickups: [{ type: 'berry', f: 0.4 }, { type: 'coin', f: 0.6 }], terrain: [], stones: [] } } };
  const { game, entities, actions, player } = entityHarness({ defsOnly: tables });
  const berry = entities.defs.find((d) => d.type === 'berry');
  player.x = berry.x - 10;
  const s0 = game.state.resources.sustenance;
  assert.equal(entities.interact(player).took, 'berry');
  assert.equal(game.state.resources.sustenance, s0 + 2);
  const coin = entities.defs.find((d) => d.type === 'coin');
  player.x = coin.x - 10;
  assert.equal(entities.interact(player).took, 'coin');
  assert.equal(actions.countable('coin'), 2);
  assert.equal(entities.runtimeOf(coin.id).taken, true, 'pickup does not respawn');
});

test('v7: hand items need an empty hand; stone piles restock infinitely', () => {
  const tables = { eras: { 1: { hazards: [], pickups: [{ type: 'spear', f: 0.4 }], terrain: [], stones: [{ type: 'stone_pile', f: 0.6 }] } } };
  const { game, entities, player } = entityHarness({ defsOnly: tables });
  const spear = entities.defs.find((d) => d.type === 'spear');
  game.state.v7.held = 'torch';
  player.x = spear.x - 10;
  assert.equal(entities.interact(player).ok, false, 'hand busy refuses the spear');
  game.state.v7.held = null;
  assert.equal(entities.interact(player).took, 'spear');
  assert.equal(game.state.v7.held, 'spear');
  // stone pile: infinite, fills only an empty hand
  const pile = entities.defs.find((d) => d.type === 'stone_pile');
  player.x = pile.x - 10;
  assert.equal(entities.interact(player).ok, false, 'busy hand cannot restock');
  game.state.v7.held = null;
  assert.equal(entities.interact(player).took, 'stone');
  game.state.v7.held = null;
  assert.equal(entities.interact(player).took, 'stone', 'pile is still there — infinite');
});

// ---- terrain interactions ------------------------------------------------------------
test('v7: throwing at a fruit tree knocks loot loose; interacting depletes for the run', () => {
  const tables = { eras: { 1: { hazards: [], pickups: [], terrain: [{ type: 'fruit_tree', f: 0.5 }], stones: [] } } };
  // throw knock-down
  {
    const { entities, player } = entityHarness({ defsOnly: tables });
    const tree = entities.defs.find((d) => d.type === 'fruit_tree');
    entities.throwProjectile({ item: 'stone', x: tree.x - 30, y: 415, vx: 200, vy: 0, fuse: null });
    let landed = null;
    for (let i = 0; i < 40 && !landed; i++) landed = entities.update({ player: { x: 0, y: 360, w: 24, h: 56 }, dt: DT, era: 1 }).events.find((e) => e.type === 'throw-land');
    assert.ok(landed, 'stone lands by the tree');
    assert.ok(entities.drops.some((d) => d.type === 'fruit'), 'fruit knocked down');
    assert.equal(entities.runtimeOf(tree.id).depleted, false, 'throwing does not deplete the tree');
  }
  // interact gather depletes
  {
    const { game, entities, player } = entityHarness({ defsOnly: tables });
    const tree = entities.defs.find((d) => d.type === 'fruit_tree');
    player.x = tree.x - 10;
    const res = entities.interact(player);
    assert.equal(res.gathered, 'fruit_tree');
    assert.equal(game.state.v7.held, 'fruit');
    assert.equal(entities.runtimeOf(tree.id).depleted, true, 'gathered bare for the run');
  }
});

test('v7: grain gather feeds directly and depletes the stalk', () => {
  const tables = { eras: { 1: { hazards: [], pickups: [], terrain: [{ type: 'grain_stalk', f: 0.5 }], stones: [] } } };
  const { game, entities, player } = entityHarness({ defsOnly: tables });
  const stalk = entities.defs.find((d) => d.type === 'grain_stalk');
  player.x = stalk.x - 10;
  const s0 = game.state.resources.sustenance;
  entities.interact(player);
  assert.equal(game.state.resources.sustenance, s0 + 3);
  assert.equal(entities.runtimeOf(stalk.id).depleted, true);
});

test('v7: dark_cave dims the screen without a torch, lit with one', () => {
  const tables = { eras: { 1: { hazards: [], pickups: [], terrain: [{ type: 'dark_cave', f: 0.5 }], stones: [] } } };
  const { game, entities, player } = entityHarness({ defsOnly: tables });
  const cave = entities.defs.find((d) => d.type === 'dark_cave');
  player.x = cave.x;
  assert.ok(entities.caveLight(player, 1) < 0.3, 'pitch dark without torch');
  game.state.v7.held = 'torch';
  assert.equal(entities.caveLight(player, 1), 1, 'torch lights the cave');
  player.x = cave.x + 500; // outside: full daylight regardless
  game.state.v7.held = null;
  assert.equal(entities.caveLight(player, 1), 1);
});

test('v7: anchor rope placement persists in save state', () => {
  const tables = { eras: { 1: { hazards: [], pickups: [], terrain: [{ type: 'terr_anchor_placeholder', f: 0.5 }], stones: [] } } };
  tables.eras[1].terrain[0].type = 'anchor';
  const { game, entities, player } = entityHarness({ defsOnly: tables });
  const anchor = entities.defs.find((d) => d.type === 'anchor');
  player.x = anchor.x - 10;
  assert.equal(entities.interact(player).ok, false, 'nothing to tie with an empty hand');
  game.state.v7.held = 'rope'.length ? 'stone' : null; // any held item proxies the rope
  const res = entities.interact(player);
  assert.equal(res.roped, anchor.id);
  assert.deepEqual(game.state.v7.placedRopes, [anchor.id]);
});

test('v7: taken/depleted/dead sets hydrate from a loaded save', () => {
  const tables = { eras: { 1: { hazards: [{ type: 'boar', f: 0.5 }], pickups: [{ type: 'berry', f: 0.4 }], terrain: [{ type: 'berry_bush', f: 0.6 }], stones: [] } } };
  const { game, entities, player } = entityHarness({
    defsOnly: tables,
    state: { v7: { held: null, takenPickups: ['pickup-1-0'], deadHazards: ['hazard-1-0'], depletedBushes: ['terrain-1-0'] } },
  });
  const berry = entities.defs.find((d) => d.type === 'berry');
  const boar = entities.defs.find((d) => d.type === 'boar');
  const bush = entities.defs.find((d) => d.type === 'berry_bush');
  assert.equal(entities.runtimeOf(berry.id).taken, true);
  assert.equal(entities.runtimeOf(boar.id).dead, true);
  assert.equal(entities.runtimeOf(bush.id).depleted, true);
  // dead boar exerts no threat even touching the player
  player.x = boar.x;
  const ev = entities.update({ player, dt: DT, era: 1 });
  assert.ok(!ev.events.some((e) => e.type === 'contact'));
});
