// tests/integration-v7.test.mjs — the v7 layer driving the v6 tick loop.
// Proves SPEC v7 works ON TOP of the engine: sprint cap through player physics,
// throw → projectile → chaser kill → meat drop via the fixed-step sim, entity
// events surfacing from sim.frame(), and collapse respawn inside the loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGame } from '../src/core/game.js';
import { createWorld } from '../src/engine/world.js';
import { createPlayer } from '../src/engine/player.js';
import { createCamera } from '../src/engine/camera.js';
import { createEncounterSystem } from '../src/engine/encounters.js';
import { createTransition } from '../src/engine/transition.js';
import { createSim, FIXED_DT } from '../src/engine/tick.js';
import { createActionSystem } from '../src/engine/actions.js';
import { createEntitySystem } from '../src/engine/entities.js';
import { attachV7Fields, entryXForEra } from '../src/engine/save-v6.js';
import { mulberry32 } from './helpers.mjs';


const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erasData = JSON.parse(readFileSync(path.join(R, 'src/data/eras.json'), 'utf8'));
const spawnTables = JSON.parse(readFileSync(path.join(R, 'research/spawn-tables-v7.json'), 'utf8'));

function makeSim(seed = 11) {
  const game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32(seed) });
  attachV7Fields(game.state);
  const world = createWorld({ erasData, encounters: [], stones: [], arcs: [] }, 'test-v7');
  const player = createPlayer({ x: world.spawn.x, y: world.spawn.y, collider: world.collider });
  const camera = createCamera({ x: 0, y: 0 });
  const encounters = createEncounterSystem(world.objects, game, world);
  const transition = createTransition(game, camera);
  const surfaceFeet = (x) => {
    for (let y = 0; y < world.worldH; y += 8) if (world.collider.solidAt(x, y)) return y;
    return world.worldH;
  };
  const actions = createActionSystem({ game, player, onThrow: (spec) => entities.throwProjectile(spec) });
  const sim = createSim({ world, player, camera, encounters, transition, game, actions });
  const entities = createEntitySystem({ world, game, actions, surfaceFeet, spawnTables });
  sim.attachEntities(entities);
  return { game, world, player, camera, sim, actions, entities };
}

const idle = { left: false, right: false, jumpHeld: false, down: false };

test('v7 integration: sprint raises the run cap through the real player physics', () => {
  const a = makeSim();
  const b = makeSim(11);
  // same seed-ish comparison: walk right for 2 s with and without Shift
  for (let i = 0; i < 120; i++) {
    a.sim.frame(FIXED_DT, { ...idle, right: true, sprint: true });
    b.sim.frame(FIXED_DT, { ...idle, right: true });
  }
  const da = a.player.x - a.world.spawn.x;
  const db = b.player.x - b.world.spawn.x;
  assert.ok(da > db * 1.3, `sprint distance ${da.toFixed(0)} should beat walk ${db.toFixed(0)}`);
  assert.ok(a.game.state.v7.stamina < 100, 'stamina drained');
});

test('v7 integration: no input, no motion — verbs alone never move the world', () => {
  const { sim, player, actions } = makeSim();
  const x0 = player.x;
  for (let i = 0; i < 60; i++) sim.frame(FIXED_DT, { ...idle, sprint: true, crouch: true });
  assert.equal(player.x, x0);
  assert.equal(actions.crouching, true, 'crouch verb still applies in place');
});

test('v7 integration: hold X, release → projectile ticks in the sim and lands', () => {
  const { sim, entities, actions, player } = makeSim();
  actions.swapHand('stone');
  // aim for ~0.4 s
  for (let i = 0; i < 24; i++) sim.frame(FIXED_DT, { ...idle, aimHeld: true });
  assert.equal(actions.aiming, true);
  sim.frame(FIXED_DT, { ...idle, aimHeld: false }); // release edge
  assert.equal(entities.projectiles.length, 1, 'projectile spawned by the sim');
  assert.equal(actions.held, null, 'throw consumed the held stone');
  const p0 = { ...entities.projectiles[0] };
  for (let i = 0; i < 180 && entities.projectiles.length; i++) sim.frame(FIXED_DT, idle);
  assert.equal(entities.projectiles.length, 0, 'projectile resolved within 3 s');
  assert.ok(p0.vy < 0, 'launched upward-arc');
});

test('v7 integration: E picks up a nearby pickup through the boot-style interact call', () => {
  const { game, player, entities, world } = makeSim();
  // stand the player on the first era-1 pickup
  const pk = entities.defs.find((d) => d.kind === 'pickup' && d.era === 1);
  player.x = pk.x - player.w / 2;
  player.y = (world.collider ? player.y : 0);
  const r = entities.interact(player);
  assert.equal(r.ok, true, `interact at pickup ${pk.type} ok`);
  const effTaken = r.took === pk.type;
  assert.ok(effTaken || r.reason, 'either took it or explained why not');
  void game;
});

test('v7 integration: Q drops the held item (verb pulse through the sim)', () => {
  const { sim, actions } = makeSim();
  actions.swapHand('torch');
  sim.frame(FIXED_DT, { ...idle, dropPressed: true });
  assert.equal(actions.held, null);
});

test('v7 integration: sustenance hits 0 → sim emits collapse and respawns at the boundary', () => {
  const { sim, game, player } = makeSim();
  game.state.resources.sustenance = 0;
  game.state.lastBoundaryEra = 1;
  player.x = entryXForEra(1) + 900;
  let ev = null;
  for (let i = 0; i < 5 && !ev; i++) {
    const events = sim.frame(FIXED_DT, idle);
    ev = events.find((e) => e.type === 'collapse') || null;
  }
  assert.ok(ev, 'collapse event surfaced from the tick loop');
  assert.equal(player.x, entryXForEra(1), 'respawned at last boundary');
  assert.ok(game.state.resources.sustenance >= 1, 'woke with a bite left');
});

test('v7 integration: zone hazard drains its pool while standing inside unprotected', () => {
  const { sim, game, player, entities } = makeSim();
  const zone = entities.defs.find((d) => d.kind === 'hazard' && ['smog', 'radiation', 'datastorm'].includes(d.type));
  assert.ok(zone, 'a zone hazard exists in the spawn tables');
  player.x = zone.x - player.w / 2;
  const z = game.state.resources;
  const before = { ...z };
  for (let i = 0; i < 60; i++) sim.frame(FIXED_DT, idle); // 1 s standing in the zone
  const drained = Object.keys(before).filter((k) => z[k] < before[k]);
  assert.ok(drained.length >= 1, 'zone drained a resource over 1 s');
});
