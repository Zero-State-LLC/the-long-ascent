// tools/smoke-v6.mjs — headless smoke test of the v6 engine surface.
import { readFileSync } from 'node:fs';
import { createWorld, SEG_W, WORLD_COLS } from '../src/engine/world.js';
import { createPlayer } from '../src/engine/player.js';
import { createCamera } from '../src/engine/camera.js';
import { createEncounterSystem } from '../src/engine/encounters.js';
import { createTransition } from '../src/engine/transition.js';
import { createSim } from '../src/engine/tick.js';
import { createGame } from '../src/core/game.js';
import { attachV6Fields } from '../src/engine/save-v6.js';

const erasData = JSON.parse(readFileSync('src/data/eras.json', 'utf8'));
const encounters = JSON.parse(readFileSync('research/encounters-v6.json', 'utf8'));
const stones = JSON.parse(readFileSync('research/boundary-stones-v6.json', 'utf8'));
const arcs = JSON.parse(readFileSync('research/arc-encounters-v6.json', 'utf8'));

const world = createWorld({ erasData, encounters, stones, arcs }, 'long-ascent');
console.log('objects', world.objects.length, '| boundary structures:', world.objects.filter((o) => o.kind === 'boundary').length,
  '| stones:', world.objects.filter((o) => o.kind === 'stone').length,
  '| arcs:', world.objects.filter((o) => o.kind === 'arc').length);
console.log('spawn', world.spawn);

// settle on ground
const p = createPlayer({ x: world.spawn.x, y: world.spawn.y - 200, collider: world.collider });
for (let i = 0; i < 120; i++) p.update({}, 1 / 60);
console.log('settled: grounded=', p.grounded, 'y=', p.y.toFixed(2), 'feet=', (p.y + p.h).toFixed(2));

// held jump apex
const g = p.y;
let minY = Infinity;
for (let i = 0; i < 120; i++) { p.update({ jumpHeld: true }, 1 / 60); minY = Math.min(minY, p.y); }
console.log('held apex rise:', (g - minY).toFixed(1), '(target ~102)');
// land back
for (let i = 0; i < 180 && !p.grounded; i++) p.update({ jumpHeld: true }, 1 / 60);
console.log('landed back:', p.grounded, 'drift x:', (p.x - world.spawn.x).toFixed(1));

// tapped jump (press 3 ticks then release)
p.x = world.spawn.x; p.y = g; p.vy = 0; p.grounded = true; p.jumpWasHeld = false;
let minY2 = Infinity;
for (let i = 0; i < 150; i++) { p.update({ jumpHeld: i >= 5 && i <= 7 }, 1 / 60); minY2 = Math.min(minY2, p.y); }
console.log('tapped apex rise:', (g - minY2).toFixed(1), '(target 45-55)');

// full sim walk + encounter trigger
const cam = createCamera({ x: 0, y: 300 });
const game = createGame({ erasData, eventsData: { events: [] }, rng: () => 0.5 });
attachV6Fields(game.state);
const enc = createEncounterSystem(world.objects, game, world);
const tr = createTransition(game, cam);
const sim = createSim({ world, player: p, camera: cam, encounters: enc, transition: tr, game });
p.x = world.spawn.x; p.y = world.spawn.y; p.vx = 0; p.vy = 0;
let opened = null;
for (let i = 0; i < 60 * 30 && !opened; i++) {
  const evs = sim.frame(1 / 60, { right: true, jumpHeld: false });
  opened = evs.find((e) => e.type === 'menu-open') || null;
}
console.log('walk-to-first-encounter:', opened ? `OPENED ${opened.id}` : 'never', 'x=', p.x.toFixed(0));
if (opened) {
  const obj = opened.object;
  const res = enc.choose(obj.choices[0].label);
  console.log('choose:', res.ok, JSON.stringify(res.deltas).slice(0, 120));
  console.log('resolved persists:', enc.isResolved(obj.id), '| state.resolvedEncounters:', game.state.resolvedEncounters.length);
}

// era transition: teleport near seam 2
p.x = 2 * SEG_W - 100; p.y = world.spawn.y; p.vx = 0; p.vy = 0;
let advanced = false;
for (let i = 0; i < 60 * 20 && !advanced; i++) {
  const evs = sim.frame(1 / 60, { right: true });
  if (evs.some((e) => e.type === 'era-done')) advanced = true;
}
console.log('era transition done:', advanced, '| state.era now', game.state.era);
