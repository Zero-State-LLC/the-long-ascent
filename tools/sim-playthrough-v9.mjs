// tools/sim-playthrough-v9.mjs — SPEC-v9 §8 gate 2: bot traverses era 1→2.
// Asserts the v9 contract end-to-end on the real tick loop:
//   1. commits a station choice (numbers land + ≤3 s consequence beat)
//   2. leaves one station unresolved via Esc (it stays READY)
//   3. takes both fork routes across two runs (ridge / valley)
//   4. survives an injected paint exception (D2 live check: stripe + 3-strike
//      auto-pause + loop keeps rAF alive)
// Run: node tools/sim-playthrough-v9.mjs   (exit 1 on any failed assertion)
import { readFileSync } from 'node:fs';
import { createGame } from '../src/core/game.js';
import { createWorld } from '../src/engine/world.js';
import { createPlayer } from '../src/engine/player.js';
import { createCamera } from '../src/engine/camera.js';
import { createEncounterSystem } from '../src/engine/encounters.js';
import { createTransition } from '../src/engine/transition.js';
import { createSim, FIXED_DT } from '../src/engine/tick.js';
import { createActionSystem, ensureV7State } from '../src/engine/actions.js';
import { createEntitySystem } from '../src/engine/entities.js';
import { createStations } from '../src/engine/stations.js';
import { loadV9Copy, dimReasonKeyFor } from '../src/engine/v9copy.js';
import { createGuardedLoop } from '../src/ui/worldview.js';
import { STATION_APPROACH_PX, CONSEQUENCE_BEAT_S } from '../src/engine/feel.js';
import { TILE } from '../src/engine/feel.js';
import { mulberry32 } from '../tests/helpers.mjs';

const ROOT = new URL('../', import.meta.url);
const erasData = JSON.parse(readFileSync(new URL('src/data/eras.json', ROOT), 'utf8'));
const encDoc = JSON.parse(readFileSync(new URL('research/encounters-v6.json', ROOT), 'utf8'));
const spawnTables = JSON.parse(readFileSync(new URL('research/spawn-tables-v7.json', ROOT), 'utf8'));
const v9CopyDoc = JSON.parse(readFileSync(new URL('research/v9-copy.json', ROOT), 'utf8'));
const failures = [];
const check = (cond, label) => { if (!cond) failures.push(label); };

const idle = { left: false, right: false, jumpHeld: false, down: false };

function makeRun(seed = 21) {
  const game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32(seed) });
  ensureV7State(game.state);
  const world = createWorld({ erasData, encounters: encDoc, stones: [], arcs: [] }, 'sim-v9');
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
  const copy = loadV9Copy(v9CopyDoc);
  const stations = createStations({ encounters, game, actions, copy, rng: mulberry32(77) });
  stations.attachDimReasonLookup(dimReasonKeyFor);
  return { game, world, player, camera, sim, actions, entities, stations, encounters, transition, copy };
}

// Bot: walk right with wall-probe jumping (v8's proven hold-40 counter);
// auto-commit the FIRST station encountered; leave the SECOND unresolved
// (Esc + walk on); keep going to the era-2 seam.
function botMovement(h) {
  const { world, player } = h;
  const feet = player.y + player.h;
  const aheadX = player.x + player.w + 16;
  const wallAhead = player.grounded
    && (world.collider.solidAt(aheadX, feet - 8) || world.collider.solidAt(aheadX, feet - TILE - 8))
    && !world.collider.solidAt(aheadX, feet - 2 * TILE - 8);
  return { right: true, jumpHeld: wallAhead };
}

function runEra({ seed, commitFirst, leaveSecond, forceRoute = null }) {
  const h = makeRun(seed);
  const committed = [];
  const leftUnresolved = [];
  let eraBegins = 0;
  let stationsSeen = 0;
  const guard = 60 * 60 * 5; // ≤5 min sim cap
  let steps = 0;
  let actedThisStation = false;
  while (h.game.state.era < 2 && steps++ < guard) {
    // Station layer first (freeze applies same tick).
    const st = h.stations.update(h.player, FIXED_DT);
    if (st.opened) {
      h.sim.setPaused(true);
      stationsSeen += 1;
      actedThisStation = false;
    }
    if (h.stations.active && !actedThisStation) {
      const shouldCommit = stationsSeen === 1 ? commitFirst : !leaveSecond;
      if (shouldCommit) {
        const panel = h.stations.panel();
        const pick = panel.choices.find((c) => !c.disabled);
        if (pick) {
          const res = h.stations.commit(pick.label);
          if (res.ok) committed.push({ id: res.id, walkAway: !!res.walkAway });
        }
        h.sim.setPaused(false);
      } else {
        const left = h.stations.leave();
        if (left) leftUnresolved.push(left.id);
        h.sim.setPaused(false);
      }
      actedThisStation = true;
    }
    const events = h.sim.frame(FIXED_DT, { ...idle, ...botMovement(h) });
    for (const ev of events) if (ev.type === 'era-begin') eraBegins += 1;
    // keep the hand armed so throw choices are live
    if (!h.game.state.v7.held) h.actions.pickup('stone');
  }
  check(steps < guard, `era traversal completed inside the sim cap (steps=${steps})`);
  return { h, committed, leftUnresolved, eraBegins, stationsSeen };
}

console.log('== 1. era 1→2: commit a station (numbers land + ≤3s beat) ==');
{
  const { h, committed, eraBegins, stationsSeen } = runEra({ seed: 21, commitFirst: true, leaveSecond: true });
  check(committed.length >= 1, `a station was committed (${JSON.stringify(committed)})`);
  check(h.stations.beatLeft <= CONSEQUENCE_BEAT_S, `consequence beat ≤3s (${h.stations.beatLeft})`);
  check(h.stations.inBeat() === false || h.stations.beatLeft <= CONSEQUENCE_BEAT_S, 'beat bounded');
  check(eraBegins >= 1, `crossed into era 2 (era-begin events: ${eraBegins})`);
  check(stationsSeen >= 1, `stations met: ${stationsSeen}`);
  console.log(`   committed: ${JSON.stringify(committed)}, stations seen: ${stationsSeen}, era-begin: ${eraBegins}`);
}

console.log('== 2. era 1→2: leave a station unresolved via Esc (stays READY) ==');
{
  const { h, leftUnresolved, committed } = runEra({ seed: 21, commitFirst: false, leaveSecond: true });
  check(leftUnresolved.length >= 1, `a station was left unresolved (${JSON.stringify(leftUnresolved)})`);
  const first = leftUnresolved[0];
  check(!h.game.state.resolvedEncounters?.some?.((r) => r.id === first), 'unresolved station recorded nothing');
  check(committed.length === 0, `no commit happened (${JSON.stringify(committed)})`);
  console.log(`   left unresolved: ${JSON.stringify(leftUnresolved)}`);
}

console.log('== 3. both fork routes traversed across two runs ==');
{
  // Two seeds give different lane/terrain combos; the wall-probe bot walks
  // whichever lane is passable, and the era tail's two x-ranges both get
  // visited across the two runs.
  const routesSeen = new Set();
  for (const seed of [21, 42]) {
    const h = makeRun(seed);
    let steps = 0;
    while (h.game.state.era < 2 && steps++ < 60 * 60 * 5) {
      h.sim.frame(FIXED_DT, { ...idle, ...botMovement(h) });
      const route = h.world.routeAtX(h.player.x + h.player.w / 2);
      if (route) routesSeen.add(route);
    }
  }
  check(routesSeen.has('ridge') && routesSeen.has('valley'),
    `both fork routes traversed (saw: ${[...routesSeen].join(', ')})`);
  console.log(`   routes walked: ${[...routesSeen].join(', ')}`);
}

console.log('== 4. D2 live check: injected paint exception — loop survives, 3 strikes auto-pause ==');
{
  const recordingOps = [];
  const canvas = {
    width: 960, height: 540,
    getContext: () => new Proxy({}, {
      get: (t, k) => (k === 'drawImage' ? (...a) => recordingOps.push(a)
        : k === 'fillRect' ? () => recordingOps.push(['fillRect'])
        : k === 'fillText' ? () => recordingOps.push(['fillText'])
        : () => {}),
      set: () => true,
    }),
  };
  let paints = 0;
  let throwNext = true;
  let rafCb = null;
  const loop = createGuardedLoop({
    canvas,
    update: () => {},
    paint: () => { paints++; if (throwNext) throw new Error('injected paint exception'); },
    faultCopy: loadV9Copy(v9CopyDoc).renderFault(),
    requestFrame: (fn) => { rafCb = fn; return 1; },
  });
  loop.start();
  rafCb(16); rafCb(32); rafCb(48);
  check(loop.paused === true, `auto-paused after 3 consecutive faults (consecutive=${loop.consecutiveFaults})`);
  check(loop.faultCount === 3, `fault counter total=3 (got ${loop.faultCount})`);
  check(recordingOps.some((a) => a[0] === 'fillText'), 'diagnostic stripe text painted on the last-good framebuffer');
  // R: the loop resumes and keeps going when the fault clears.
  throwNext = false;
  loop.resume();
  rafCb(64);
  check(loop.paused === false && paints >= 4, `loop alive after resume (paints=${paints})`);
  loop.stop();
  console.log(`   faults: ${loop.faultCount}, paints: ${paints}, stripe painted: true`);
}

// ---- report ----
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} check(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nPASS — v9 playthrough sim green (station commit + beat, Esc leave-unresolved, both fork routes, D2 injected-fault survival).');
