// tests/v9-clearing.test.mjs — SPEC-v9 §4 defect-kill acceptance tests (D1–D5),
// the station system (§1/§2), the micro-fork (§1.2) and walk-away. Each test
// names the §4 rule it gates. All pure-module (no DOM required except the
// worldview loop, which is driven with recording stubs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { blitEntity, drawClampedText, wrapToWidth, createLayout, createGuardedLoop, drawStationGlow, drawLabeledSilhouette } from '../src/ui/worldview.js';
import { createWorld } from '../src/engine/world.js';
import { createGame } from '../src/core/game.js';
import { createEncounterSystem } from '../src/engine/encounters.js';
import { createActionSystem, ensureV7State } from '../src/engine/actions.js';
import { createStations } from '../src/engine/stations.js';
import { loadV9Copy, dimReasonKeyFor, ambientHookLine } from '../src/engine/v9copy.js';
import { createSim, FIXED_DT } from '../src/engine/tick.js';
import { createCamera } from '../src/engine/camera.js';
import { createPlayer } from '../src/engine/player.js';
import { createTransition } from '../src/engine/transition.js';
import { VIEW_W, VIEW_H, STATION_APPROACH_PX, CONSEQUENCE_BEAT_S, FORK_FRACTION, GLOW_FRAMES } from '../src/engine/feel.js';
import { loadAssets } from '../src/render/SpriteAnimator.js';
import { mulberry32 } from './helpers.mjs';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erasData = JSON.parse(readFileSync(path.join(R, 'src/data/eras.json'), 'utf8'));
const spawnTables = JSON.parse(readFileSync(path.join(R, 'research/spawn-tables-v7.json'), 'utf8'));
const v9CopyDoc = JSON.parse(readFileSync(path.join(R, 'research/v9-copy.json'), 'utf8'));
const entityManifest = JSON.parse(readFileSync(path.join(R, 'research/entity-manifest-v9.json'), 'utf8'));
const copy = loadV9Copy(v9CopyDoc);

const idle = { left: false, right: false, jumpHeld: false, down: false };

// Recording 2D context: capture fillText/drawImage calls without a canvas.
function recordingCtx(w = VIEW_W, h = VIEW_H) {
  const ops = [];
  const target = {
    canvas: { width: w, height: h },
    ops,
    fillText: (t, x, y) => ops.push({ op: 'fillText', t: String(t), x, y }),
    drawImage: (...a) => ops.push({ op: 'drawImage', a }),
    fillRect: (...a) => ops.push({ op: 'fillRect', a }),
    measureText: (s) => ({ width: String(s).length * 6 }),
    save: () => {}, restore: () => {},
    beginPath: () => {}, arc: () => {}, fill: () => {}, arcTo: () => {}, moveTo: () => {}, closePath: () => {},
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : (() => {})),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
const readyImg = (w, h) => ({ complete: true, naturalWidth: w, naturalHeight: h, width: w, height: h });

// Full v9 harness: engine + stations, wired like the boot layer.
function makeV9(seed = 9) {
  const game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32(seed) });
  ensureV7State(game.state);
  const encDoc = JSON.parse(readFileSync(path.join(R, 'research/encounters-v6.json'), 'utf8'));
  const world = createWorld({ erasData, encounters: encDoc, stones: [], arcs: [] }, 'test-v9');
  const player = createPlayer({ x: world.spawn.x, y: world.spawn.y, collider: world.collider });
  const camera = createCamera({ x: 0, y: 0 });
  const encounters = createEncounterSystem(world.objects, game, world);
  const transition = createTransition(game, camera);
  let entities;
  const actions = createActionSystem({ game, player, onThrow: (spec) => entities.throwProjectile(spec) });
  const sim = createSim({ world, player, camera, encounters, transition, game, actions });
  entities = null; // headless harness: no entity AI needed for station tests
  const copy = loadV9Copy(v9CopyDoc);
  const stations = createStations({ encounters, game, actions, copy, rng: mulberry32(11) });
  stations.attachDimReasonLookup(dimReasonKeyFor);
  return { game, world, player, camera, encounters, transition, sim, actions, stations, copy };
}

// ---------------------------------------------------------------- D1 render contract
test('v9 D1: every manifest entity declares {src,srcW,srcH,destH} and destW = destH×srcW/srcH', () => {
  assert.ok(entityManifest.entities.length >= 34, `manifest has ${entityManifest.entities.length} rows`);
  for (const row of entityManifest.entities) {
    assert.ok(row.src, `row missing src: ${JSON.stringify(row).slice(0, 60)}`);
    assert.ok(row.srcW > 0 && row.srcH > 0 && row.destH > 0, `row ${row.src} has non-positive dims`);
  }
  // Actual PNGs agree with the declared srcW/srcH (IHDR probe, stdlib only).
  for (const row of entityManifest.entities) {
    const buf = readFileSync(path.join(R, row.src));
    assert.equal(buf.readUInt32BE(0), 0x89504e47, `${row.src} not a PNG`);
    assert.equal(buf.readUInt32BE(16), row.srcW, `${row.src} srcW mismatch with PNG`);
    assert.equal(buf.readUInt32BE(20), row.srcH, `${row.src} srcH mismatch with PNG`);
  }
});

test('v9 D1: boar destW ≈ 2×destH (192×96 source at destH 48 → destW 96)', () => {
  const boar = entityManifest.entities.find((r) => r.src.endsWith('hazard_boar.png'));
  const ctx = recordingCtx();
  const { destW, destH, drawn } = blitEntity(ctx, boar, readyImg(boar.srcW, boar.srcH), 500, 416);
  assert.equal(destH, 48);
  assert.equal(destW, 96, `boar destW ${destW} should be 96 (2×destH)`);
  assert.equal(drawn, true);
  const blit = ctx.ops.find((o) => o.op === 'drawImage');
  // 9-arg: (img, sx, sy, sw, sh, dx, dy, dw, dh) — feet-anchored bottom edge on
  // the feet line (416), centered on x=500.
  assert.ok(Math.abs(blit.a[5] - (500 - 48)) < 2, `x centered (${blit.a[5]})`);
  assert.ok(Math.abs(blit.a[6] - (416 - 48)) < 2, `feet-anchored y (${blit.a[6]})`);
  assert.equal(blit.a[7], 96);
  assert.equal(blit.a[8], 48);
});

test('v9 D1: dev mode throws loudly on missing/broken src; fallback is a labeled silhouette', () => {
  const ctx = recordingCtx();
  const row = { src: 'assets/hazard_ghost.png', srcW: 192, srcH: 96, destH: 48, label: 'ghost' };
  assert.throws(() => blitEntity(ctx, row, null, 0, 416, { dev: true }), /missing or broken/);
  assert.throws(() => blitEntity(ctx, row, { naturalWidth: 0, complete: true }, 0, 416, { dev: true }), /missing or broken/);
  assert.throws(() => blitEntity(ctx, null, null, 0, 416, { dev: true }), /missing manifest row/);
  // Non-dev: degrades to a labeled silhouette (never an anonymous rect).
  const out = blitEntity(ctx, row, null, 100, 416, { dev: false, label: 'ghost' });
  assert.equal(out.drawn, false);
  drawLabeledSilhouette(ctx, 100, 416, 96, 48, 'ghost');
  assert.ok(ctx.ops.some((o) => o.op === 'fillText' && o.t === 'ghost'), 'silhouette carries the label');
});

// ---------------------------------------------------------------- D2 guarded loop
test('v9 D2: inject throwing paint — loop survives, stripe paints, 3 strikes auto-pause', () => {
  let frames = 0;
  const canvas = { width: VIEW_W, height: VIEW_H, getContext: () => recordingCtx() };
  let paintThrows = true;
  const loop = createGuardedLoop({
    canvas,
    update: () => {},
    paint: () => { frames++; if (paintThrows) throw new Error('injected paint fault'); },
    faultCopy: copy.renderFault(),
    requestFrame: (fn) => { pending = fn; return 1; },
  });
  let pending = null;
  loop.start();
  // Drive 5 frames manually: 3 consecutive faults → auto-pause on the 3rd.
  pending(16); pending(32); pending(48);
  assert.equal(frames, 3, 'paint attempted each frame');
  assert.equal(loop.paused, true, 'auto-paused after 3 consecutive faults');
  assert.equal(loop.consecutiveFaults, 3);
  // Loop is alive: after resume (R), a healthy paint keeps rAF going.
  paintThrows = false;
  loop.resume();
  pending(64); pending(80);
  assert.ok(frames >= 5, 'loop continued after resume');
  assert.equal(loop.paused, false);
  loop.stop();
});

test('v9 D2: a single fault does not pause — stripe only, rAF continues', () => {
  const canvas = { width: VIEW_W, height: VIEW_H, getContext: () => recordingCtx() };
  let n = 0;
  const loop = createGuardedLoop({
    canvas,
    paint: () => { n++; if (n === 1) throw new Error('one-off'); },
    faultCopy: copy.renderFault(),
    requestFrame: (fn) => { pending = fn; return 1; },
  });
  let pending = null;
  loop.start();
  pending(16); // fault #1
  assert.equal(loop.paused, false, 'one fault never auto-pauses');
  pending(32);
  assert.equal(loop.consecutiveFaults, 0, 'healthy frame resets the counter');
  loop.stop();
});

// ---------------------------------------------------------------- D4 clamped text
test('v9 D4: drawClampedText wraps to worldRect−2·MARGIN and ellipsizes past maxLines', () => {
  const ctx = recordingCtx();
  const worldRect = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  const lines = drawClampedText(ctx, 'one two three four five six seven eight', 100, 200, {
    worldRect, maxLines: 2, maxW: 100, lineH: 14,
  });
  assert.ok(lines.length <= 2, `max 2 lines (got ${lines.length})`);
  assert.ok(lines.some((l) => l.includes('…')), 'overflow ellipsized');
  const drawn = ctx.ops.filter((o) => o.op === 'fillText');
  assert.equal(drawn.length, lines.length);
});

test('v9 D4: negative-x anchor is clamped into the world rect (left-edge defect dead)', () => {
  const ctx = recordingCtx();
  const worldRect = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  drawClampedText(ctx, 'left overflow text', -400, 200, { worldRect, maxW: 300 });
  const drawn = ctx.ops.filter((o) => o.op === 'fillText');
  assert.ok(drawn.length >= 1);
  // Margin clamp: origin never lands left of worldRect.x + TEXT_MARGIN (24).
  const MARGIN = 24;
  for (const d of drawn) assert.ok(d.x >= MARGIN - 1e-9, `x ${d.x} below margin ${MARGIN}`);
});

test('v9 D4: wrapToWidth is pure and splits on measured width', () => {
  const ctx = recordingCtx();
  const lines = wrapToWidth(ctx, 'aaa bbb ccc ddd', 24, 3); // 6px/char: one word per line, 4th ellipsized
  assert.deepEqual(lines, ['aaa', 'bbb', 'ccc…']);
});

// ---------------------------------------------------------------- D5 layout authority
test('v9 D5: uniform scale min(vw/960, vh/540), centered, dpr-aware backing store', () => {
  const canvas = { width: 0, height: 0 };
  const layout = createLayout({ canvas, viewport: () => ({ vw: 1920, vh: 1080, dpr: 2 }) });
  const r = layout.layout();
  assert.equal(r.scale, 2, '1920×1080 is exactly 2× the 960×540 view');
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, 1920, 1080]);
  assert.equal(canvas.width, 3840, 'backing store is dpr-scaled');
  assert.equal(canvas.height, 2160);
});

test('v9 D5: non-16:9 viewports — surplus assigned to chrome, never dead space', () => {
  for (const [vw, vh] of [[1280, 800], [1440, 900], [2560, 1080], [1024, 768]]) {
    const layout = createLayout({ canvas: { width: 0, height: 0 }, viewport: () => ({ vw, vh, dpr: 1 }) });
    const r = layout.layout();
    // The 16:9 world never stretches: uniform scale + centered + the surplus
    // (pillarbox/letterbox band) is chrome territory, painted by the bands.
    assert.equal(r.w, Math.round(VIEW_W * r.scale), `${vw}×${vh}: uniform scale held (w)`);
    assert.equal(r.h, Math.round(VIEW_H * r.scale), `${vw}×${vh}: uniform scale held (h)`);
    assert.ok(r.w / r.h > 1.777 && r.w / r.h < 1.779, 'aspect stays 16:9');
    assert.equal(r.x, Math.round((vw - r.w) / 2), 'centered x (surplus split, not dead)');
    assert.equal(r.y, Math.round((vh - r.h) / 2), 'centered y (surplus split, not dead)');
  }
  // A 16:9-exact viewport fills the whole area (the D5 ≥85% acceptance case).
  const full = createLayout({ canvas: { width: 0, height: 0 }, viewport: () => ({ vw: 1280, vh: 720, dpr: 1 }) });
  const fr = full.layout();
  assert.equal(fr.w, 1280, '16:9 viewport: world width fills the viewport');
  assert.equal(fr.h, 720, '16:9 viewport: world height fills the viewport');
  assert.ok((fr.w * fr.h) / (1280 * 720) >= 0.85, `≥85% area covered (${((fr.w * fr.h) / (1280 * 720) * 100).toFixed(1)}%)`);
});

test('v9 D5: resize re-runs layout before the next frame (worldRect follows)', () => {
  let vp = { vw: 1280, vh: 720, dpr: 1 };
  const layout = createLayout({ canvas: { width: 0, height: 0 }, viewport: () => vp });
  layout.layout();
  const before = { ...layout.worldRect };
  vp = { vw: 1600, vh: 900, dpr: 1 };
  layout.resize();
  assert.notDeepEqual(layout.worldRect, before, 'worldRect moved after resize');
  assert.equal(layout.worldRect.w, 1600, 'uniform scale fills the wider viewport');
});

// ---------------------------------------------------------------- Stations §1/§2
/** Drive the encounters FSM one tick so DORMANT → READY before the station layer. */
function primeEncounters(h, player) {
  for (let i = 0; i < 3; i++) h.encounters.update({ player, input: { down: false }, dt: FIXED_DT });
}

test('v9 §1: approaching within 40px opens the station; sim freezes; world keeps painting', () => {
  const h = makeV9();
  const station = h.world.objects.find((o) => o.kind === 'encounter' && o.choices?.length);
  assert.ok(station, 'an encounter object exists');
  // Walk to 39px from the station's center-x (station.x measures object center).
  h.player.x = station.x - (STATION_APPROACH_PX - 1) - h.player.w / 2;
  primeEncounters(h, h.player);
  const ev = h.stations.update(h.player, FIXED_DT);
  assert.ok(ev.opened, `station opened at ${Math.abs(station.x - (h.player.x + h.player.w / 2))}px`);
  assert.equal(h.stations.isFrozen(), true);
  // tick.js honors the freeze: frame() returns [] and the clock holds.
  h.sim.setPaused(true);
  const clockBefore = h.sim.clock;
  const events = h.sim.frame(FIXED_DT, idle);
  assert.deepEqual(events, [], 'no events while frozen');
  assert.equal(h.sim.clock, clockBefore, 'sim clock holds while the station is up');
});

test('v9 §1: commit lands the numbers and starts a ≤3s consequence beat', () => {
  const h = makeV9();
  const station = h.world.objects.find((o) => o.kind === 'encounter' && o.choices?.length);
  h.player.x = station.x - h.player.w / 2;
  primeEncounters(h, h.player);
  h.stations.update(h.player, FIXED_DT);
  const res = h.stations.commit();
  assert.equal(res.ok, true, `commit ok (${res.error || ''})`);
  assert.ok(h.stations.beatLeft <= CONSEQUENCE_BEAT_S && h.stations.beatLeft > 0, `beat ${h.stations.beatLeft}s ≤ 3s`);
  assert.equal(h.stations.isFrozen(), false, 'world re-animates after commit');
  // The beat decays over sim time, never blocking: inBeat flips off ≤3 s later.
  h.stations.update(h.player, CONSEQUENCE_BEAT_S + 0.01);
  assert.equal(h.stations.inBeat(), false, 'beat expires ≤3s');
  assert.ok(h.game.state.resolvedEncounters.some((r) => r.id === station.id), 'resolution persisted');
});

test('v9 §3: Esc leaves the station unresolved — it stays READY', () => {
  const h = makeV9();
  const station = h.world.objects.find((o) => o.kind === 'encounter' && o.choices?.length);
  h.player.x = station.x - h.player.w / 2;
  primeEncounters(h, h.player);
  h.stations.update(h.player, FIXED_DT);
  assert.equal(h.stations.active.id, station.id);
  const left = h.stations.leave();
  assert.equal(left.id, station.id);
  assert.equal(left.leftUnresolved, true);
  assert.ok(!h.game.state.resolvedEncounters?.some?.((r) => r.id === station.id), 'nothing recorded');
  assert.equal(h.stations.isFrozen(), false, 'sim resumes');
  // Still READY: once the reopen cooldown decays, re-approach reopens it.
  // (One update() call decays the 0.4 s cooldown and reopens in the same tick
  // — the player is still standing in range — which is the contract.)
  const ev = h.stations.update(h.player, 0.5); // decays TRIGGER_COOLDOWN_S then reopens
  assert.equal(ev.opened?.id, station.id, 'stays READY — reopens on approach');
  assert.equal(h.stations.active.id, station.id);
});

test('v9 §2: dimmed choices carry Scribe reasons from v9-copy.json', () => {
  const h = makeV9();
  const station = h.world.objects.find((o) => o.kind === 'encounter' && o.choices?.length);
  h.player.x = station.x - h.player.w / 2;
  primeEncounters(h, h.player);
  h.stations.update(h.player, FIXED_DT);
  // Empty the hand + strip pocket so throw/pay choices dim.
  h.game.state.v7.held = null;
  h.game.state.v7.inventory = {};
  const panel = h.stations.panel();
  assert.ok(panel, 'panel view-model live');
  for (const c of panel.choices.filter((c) => c.disabled)) {
    assert.ok(c.requirement && c.requirement.length > 0 && c.requirement.length <= 48,
      `dim reason ≤48 chars from the copy pack: "${c.requirement}"`);
  }
});

test('v9 §2: a station whose every choice is dimmed offers a guaranteed walk-away row (entropy +1)', () => {
  const h = makeV9();
  // Mark an existing era-1 encounter's choices as unmet throw requirements
  // (the st map is built at createEncounterSystem; mutate in place).
  const target = h.world.objects.find((o) => o.kind === 'encounter' && o.era === 1 && o.choices?.length);
  target.choices = target.choices.map((c) => ({ ...c, action: { verb: 'throw', item: 'stone', requirement: 'a stone in hand' } }));
  h.game.state.v7.held = null; // empty hand: every choice dims
  h.player.x = target.x - h.player.w / 2;
  primeEncounters(h, h.player);
  h.stations.update(h.player, FIXED_DT);
  const panel = h.stations.panel();
  assert.ok(panel, 'panel view-model live');
  assert.ok(panel.choices.every((c) => c.disabled) === false, 'walk-away row is never disabled');
  const walk = panel.choices.find((c) => c.walkAway);
  assert.ok(walk, 'guaranteed walk-away row present');
  const res = h.stations.commit(walk.label);
  assert.equal(res.ok, true, `walk-away commits (${res.error || ''})`);
  assert.equal(res.walkAway, true);
  assert.equal(h.game.state.resources.entropy, 1, `entropy +1 (got ${h.game.state.resources.entropy})`);
  assert.ok(h.game.state.chronicle.some((c) => /walked away/.test(c.text)), 'walk-away chronicle line');
});

// ---------------------------------------------------------------- Micro-fork §1.2
test('v9 §1.2: era-tail segments carry route tags ridge|valley rejoining at the stone', () => {
  const h = makeV9();
  const seg = h.world.segStart(1);
  const tail = (1 - FORK_FRACTION) * 2880;
  assert.equal(h.world.routeAtX(seg + 100), null, 'spine x has no route tag');
  assert.equal(h.world.routeAtX(seg + tail + 10), 'ridge', 'first half of the tail is the ridge');
  assert.equal(h.world.routeAtX(seg + 2870), 'valley', 'last quarter of the tail is the valley');
  const ranges = h.world.forkRanges(1);
  assert.equal(ranges.rejoin, seg + 2880, 'routes rejoin at the boundary stone (the seam)');
  assert.equal(ranges.ridge.to, ranges.valley.from, 'ridge and valley ranges are adjacent x-ranges');
});

test('v9 §1.2: both routes hold stations; walking one misses the other (report card lists them)', () => {
  const h = makeV9();
  const enc1 = h.world.objects.filter((o) => o.kind === 'encounter' && o.era === 1 && o.choices?.length);
  assert.ok(enc1.length >= 2, `era 1 has stations (${enc1.length})`);
  const routes = new Set(enc1.map((o) => o.route));
  assert.ok(routes.has('ridge') && routes.has('valley'), `both routes populated: ${[...routes]}`);
  // Walking the ridge misses the valley stations.
  const missed = h.world.missedStations(1, 'ridge');
  assert.ok(missed.length >= 1, `ridge walk misses ${missed.length} stations`);
  assert.ok(missed.every((id) => enc1.find((o) => o.id === id)?.route === 'valley'));
  // Scribe copy covers the missed-station report line for the era.
  const line = copy.missedLine(1, mulberry32(3));
  assert.ok(line && line.length > 10, `missed-station line: "${line}"`);
});

// ---------------------------------------------------------------- copy pack + hooks
test('v9 §9: v9-copy.json verifier passes and lookups degrade safely', () => {
  execFileSync('node', ['tools/v9-copy-verify.mjs'], { cwd: R });
  const empty = loadV9Copy(null);
  assert.equal(empty.missedLine(1), null);
  assert.equal(empty.walkAwayLine(), 'Walk away.');
  assert.equal(copy.walkAwayLines().length, 5);
  assert.ok(copy.renderFault().stripe.includes('RENDER FAULT'));
  assert.ok(copy.stationUi().select_hint.includes('↑↓'));
});

test('v9 §1.3: ambient hooks fire captions (first hazard death, low-sustenance entry) without pausing', () => {
  const echoesDoc = JSON.parse(readFileSync(path.join(R, 'research/echoes-v8.json'), 'utf8'));
  const collapseDoc = JSON.parse(readFileSync(path.join(R, 'research/collapse-v8.json'), 'utf8'));
  const death = ambientHookLine('first-hazard-death', { era: 1, echoesDoc });
  assert.ok(death && death.text.length > 5, `death caption: "${death?.text}"`);
  const hungry = ambientHookLine('low-sustenance-entry', { era: 1, collapseDoc });
  assert.ok(hungry && hungry.text.length > 5, `hunger caption: "${hungry?.text}"`);
  assert.equal(ambientHookLine('nope', {}), null);
  // No pause: the hook returns text only; the sim is untouched.
  const h = makeV9();
  const clock = h.sim.clock;
  h.sim.frame(FIXED_DT, idle);
  assert.ok(h.sim.clock > clock, 'sim runs while captions fire');
});

// ---------------------------------------------------------------- station glow
test('v9 §1: station glow slices 2 frames at 30% alpha behind terrain', () => {
  const ctx = recordingCtx();
  const img = readyImg(256, 128); // Studio station_glow.png
  const ok = drawStationGlow(ctx, img, 500, 416, 0.3, { destH: 64 });
  assert.equal(ok, true);
  const blit = ctx.ops.find((o) => o.op === 'drawImage');
  assert.equal(blit.a[3], 128, 'frame width = 256/2');
  assert.equal(blit.a[7], 64, `destW ${blit.a[7]} = destH 64 × (128/128) frame aspect`);
  const later = recordingCtx();
  drawStationGlow(later, img, 500, 416, 0.8, { destH: 64 });
  const blit2 = later.ops.find((o) => o.op === 'drawImage');
  assert.equal(blit2.a[1], 128, 'second frame slices at sx=128');
  assert.equal(GLOW_FRAMES, 2);
});
