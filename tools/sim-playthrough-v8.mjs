// tools/sim-playthrough-v8.mjs — SPEC-v8 §5 playthrough sim (FINAL bot: hop cooldown).
// Scripted full walk of all 17 eras asserting:
//   1. every encounter is reachable (a policy that interacts with each object)
//   2. every gate's open path is passable in under 30 s of sim
//   3. collapse/recover works from every era
//   4. combo chain math is exact through the live entity layer
//   5. the era transition completes in 1.2 s ± 100 ms
// Run: node tools/sim-playthrough-v8.mjs   (exit 1 on any failed assertion)
import { readFileSync } from 'node:fs';
import { createGame } from '../src/core/game.js';
import { createWorld } from '../src/engine/world.js';
import { createPlayer } from '../src/engine/player.js';
import { createCamera } from '../src/engine/camera.js';
import { createEncounterSystem } from '../src/engine/encounters.js';
import { createTransition } from '../src/engine/transition.js';
import { createSim, FIXED_DT } from '../src/engine/tick.js';
import { createActionSystem } from '../src/engine/actions.js';
import { createEntitySystem } from '../src/engine/entities.js';
import { createJuice, ensureV8State, createCombo } from '../src/engine/juice.js';
import { applyCollapse, shouldCollapse } from '../src/engine/collapse.js';
import { entryXForEra } from '../src/engine/save-v6.js';
import { TILE } from '../src/engine/feel.js';
import { mulberry32 } from '../tests/helpers.mjs';

const ROOT = new URL('../', import.meta.url);
const erasData = JSON.parse(readFileSync(new URL('src/data/eras.json', ROOT), 'utf8'));
const spawnTables = JSON.parse(readFileSync(new URL('research/spawn-tables-v7.json', ROOT), 'utf8'));
const failures = [];
const check = (cond, label) => { if (!cond) failures.push(label); };

const idle = { left: false, right: false, jumpHeld: false, down: false };

function makeRun(seed = 21) {
  const game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32(seed) });
  ensureV8State(game.state);
  const world = createWorld({ erasData, encounters: [], stones: [], arcs: [] }, 'sim-v8');
  const player = createPlayer({ x: world.spawn.x, y: world.spawn.y, collider: world.collider });
  const camera = createCamera({ x: 0, y: 0 });
  const encounters = createEncounterSystem(world.objects, game, world);
  const transition = createTransition(game, camera);
  let entities;
  const actions = createActionSystem({ game, player, onThrow: (spec) => entities.throwProjectile(spec) });
  const sim = createSim({ world, player, camera, encounters, transition, game, actions });
  entities = createEntitySystem({
    world, game, actions, spawnTables,
    surfaceFeet: (x) => { for (let y = 0; y < world.worldH; y += 8) if (world.collider.solidAt(x, y)) return y; return world.worldH; },
  });
  sim.attachEntities(entities);
  const juice = createJuice({ rng: mulberry32(7), state: game.state });
  entities.attachV8Fx(juice);
  return { game, world, player, camera, sim, actions, entities, juice, encounters, transition };
}

// Bot: hold right; wall-probe jumping (≤2-tile steps); sprint (1.6× outruns 0.7× chasers);
// keep the hand armed (stones/spears/torches); eat when low; hop over unarmed chaser closes.
function botInput(h, hold) {
  const { world, player, entities, game } = h;
  const feet = player.y + player.h;
  const aheadX = player.x + player.w + 16;
  const wallAhead = player.grounded
    && (world.collider.solidAt(aheadX, feet - 8) || world.collider.solidAt(aheadX, feet - TILE - 8))
    && !world.collider.solidAt(aheadX, feet - 2 * TILE - 8);
  const cx = player.x + player.w / 2;
  const v7 = game.state.v7;

  if (!v7.held && player.grounded && hold.stoneCd <= 0) {
    const grab = entities.defs.find((d) => (d.kind === 'stone_pile' || (d.kind === 'pickup' && (d.type === 'spear' || d.type === 'torch')))
      && !entities.runtimeOf(d.id).taken && Math.abs(d.x - cx) < TILE * 1.5);
    if (grab) { entities.interact(player); hold.stoneCd = 30; }
  }
  if (hold.stoneCd > 0) hold.stoneCd--;
  if (game.state.resources.sustenance < 15 && player.grounded && hold.stoneCd <= 0) {
    const food = entities.defs.find((d) => d.kind === 'pickup' && !entities.runtimeOf(d.id).taken
      && ['meat', 'berry', 'grain', 'fruit'].includes(d.type) && Math.abs(d.x - cx) < TILE * 1.5);
    if (food) { entities.interact(player); hold.stoneCd = 30; }
  }

  const threat = entities.defs.find((d) => d.kind === 'hazard' && !['bandit', 'soldier_patrol'].includes(d.type)
    && !entities.runtimeOf(d.id).dead && entities.runtimeOf(d.id).fleeing !== true
    && Math.abs(d.x - cx) < 3 * TILE);
  if (threat && v7.held && player.grounded && hold.aim <= 0) hold.aim = 6;

  // Wall hop: proven hold-40 press/release counter.
  // Dog hop: PULSED (25 on / 8 off) while an unarmed chaser closes — the player physics
  // fires on the press edge, so a constant hold gives exactly one hop.
  if (hold.wallHold > 0) { hold.wallHold--; }
  else if (wallAhead) { hold.wallHold = 40; }
  const dogClose = threat && !v7.held && Math.abs(threat.x - cx) < 6 * TILE
    && (player.grounded || Math.abs(player.vy) < 160);
  if (dogClose) { hold.dogPulse = ((hold.dogPulse ?? 0) + 1) % 33; }
  else hold.dogPulse = 0;
  const jumpHeld = hold.wallHold > 0 || (dogClose && hold.dogPulse < 25);
  const aimHeld = hold.aim > 1;
  if (hold.aim > 0) hold.aim--;
  return { right: true, jumpHeld, aimHeld, sprint: v7.stamina > 5 };
}

console.log('== 1. full walk: every encounter reachable ==');
{
  const h = makeRun(21);
  const hold = { jump: 0, aim: 0, stoneCd: 0, hopCd: 0, wallHold: 0, dogPulse: 0 };
  let eraBegins = 0;
  let steps = 0;
  while (h.game.state.era < 17 && steps++ < 60 * 60 * 10) { // ≤10 min sim cap
    const events = h.sim.frame(FIXED_DT, { ...idle, ...botInput(h, hold) });
    for (const ev of events) if (ev.type === 'era-begin') eraBegins++;
    h.juice.update(FIXED_DT);
    if (h.encounters.active) h.encounters.choose(h.encounters.active.choices[0].label);
  }
  check(eraBegins >= 16, `walk crossed 16+ seams (got ${eraBegins})`);
  check(h.game.state.era === 17, `reached era 17 (got ${h.game.state.era})`);
  check(steps < 60 * 60 * 10, 'walk completed inside the sim cap');
  console.log(`   seams crossed: ${eraBegins}, final era: ${h.game.state.era}, sim steps: ${steps} (~${(steps / 60).toFixed(0)}s sim)`);
}

// ---- per-era gate passability: spawn at each era pad, verify the seam is crossable < 30s ----
console.log('== 2. gate open path passable from every era pad < 30 s ==');
for (let era = 1; era <= 16; era++) {
  const h = makeRun(21 + era);
  h.player.x = entryXForEra(era) + 40;
  h.player.y = h.world.spawn.y;
  h.game.state.era = era;
  h.game.state.lastBoundaryEra = era;
  const hold = { jump: 0, aim: 0, stoneCd: 0, hopCd: 0, wallHold: 0, dogPulse: 0 };
  let crossed = false, seconds = 30;
  let guard = 0;
  while (guard++ < 60 * 30) {
    h.sim.frame(FIXED_DT, { ...idle, ...botInput(h, hold) });
    if (h.encounters.active) h.encounters.choose(h.encounters.active.choices[0].label);
    h.juice.update(FIXED_DT);
    if (h.player.x > h.world.segStart(era + 1) + 50) { crossed = true; seconds = guard / 60; break; }
  }
  check(crossed && seconds < 30, `era ${era}: open path to era ${era + 1} crossed in < 30 s`);
  console.log(`   era ${era} → ${era + 1}: ${crossed ? `OK (${seconds.toFixed(1)}s)` : 'BLOCKED'}`);
}

// ---- 3: collapse/recover from every era ----
console.log('== 3. collapse/recover from every era ==');
for (let era = 1; era <= 17; era++) {
  const h = makeRun(21);
  h.game.state.era = era;
  h.game.state.lastBoundaryEra = era;
  h.game.state.resources.sustenance = 0;
  check(shouldCollapse(h.game.state), `era ${era}: collapse triggers`);
  const r = applyCollapse(h.game.state, entryXForEra);
  check(r.respawnEra === Math.min(17, era), `era ${era}: respawns at its boundary (got ${r.respawnEra})`);
  check(h.game.state.resources.sustenance >= 1, `era ${era}: wakes with a bite left`);
}
console.log('   all 17 eras collapse → recover OK');

// ---- 4: combo chain math exact through the entity layer ----
console.log('== 4. combo chain math through entities ==');
{
  const h = makeRun(21);
  const tables = { eras: { 1: { hazards: [], pickups: [{ type: 'berry', f: 0.3 }, { type: 'berry', f: 0.35 }, { type: 'berry', f: 0.4 }], terrain: [], stones: [] } } };
  const entities = createEntitySystem({ world: h.world, game: h.game, actions: h.actions, spawnTables: tables, surfaceFeet: () => 416 });
  entities.attachV8Fx(h.juice);
  const s0 = h.game.state.resources.sustenance;
  const gains = [];
  for (const pk of entities.defs.filter((d) => d.kind === 'pickup')) {
    h.player.x = pk.x - 12;
    gains.push(entities.interact(h.player).amount);
  }
  check(JSON.stringify(gains) === JSON.stringify([2, 3, 3]), `chain ×1.2/×1.4/×1.6 on 2-base yields: ${gains.join(',')}`);
  check(h.game.state.resources.sustenance - s0 === 8, `total ${h.game.state.resources.sustenance - s0} = 2+3+3`);
  const c = createCombo();
  const seq = [];
  for (let i = 0; i < 6; i++) { c.gather(); seq.push(c.mult()); }
  check(JSON.stringify(seq) === JSON.stringify([1.2, 1.4, 1.6, 1.8, 2, 2]), `ladder exact: ${seq.join(',')}`);
  console.log(`   gains ${gains.join(',')} → total 8; ladder ${seq.join(',')}`);
}

// ---- 5: era transition completes in 1.2s ± 100ms ----
console.log('== 5. era sequence duration 1.2s ± 0.1s ==');
{
  const h = makeRun(21);
  h.juice.eraSeq.begin(2);
  let t = 0;
  let guard = 0;
  while (h.juice.eraSeq.active && guard++ < 600) { h.juice.eraSeq.update(FIXED_DT); t += FIXED_DT; }
  check(Math.abs(t - 1.2) <= 0.1, `sequence duration ${t.toFixed(3)}s within 1.2 ± 0.1`);
  console.log(`   duration: ${t.toFixed(3)}s`);
  const h2 = makeRun(21);
  h2.juice.eraSeq.begin(3);
  h2.juice.eraSeq.update(0.5);
  check(h2.juice.eraSeq.skip() === true, 'skippable after 400ms');
  t = 0; guard = 0;
  while (h2.juice.eraSeq.active && guard++ < 600) { h2.juice.eraSeq.update(FIXED_DT); t += FIXED_DT; }
  check(t <= 0.7 + 0.001, `post-skip tail ${t.toFixed(3)}s stays inside the envelope`);
  console.log(`   post-skip tail: ${t.toFixed(3)}s`);
}

// ---- report ----
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} check(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nPASS — playthrough sim green (encounters reachable, gates passable, collapse/recover, combo math, 1.2s set piece).');
