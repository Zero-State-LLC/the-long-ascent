// tests/scene-nonblank.test.mjs — SPEC v4 §3: the stage is never blank.
//
// 1. Geometry audit: every scene_id used by events.json must pass checkSceneSheet
//    against its PNG's real dimensions (parsed from IHDR, no canvas needed).
// 2. Pixel proof: a synthetic sheet through drawSceneFrame into a recording ctx
//    must produce non-blank pixels for EVERY frame; an unavailable sheet must
//    route to drawStageFallback which also produces non-blank pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkSceneSheet, drawSceneFrame, drawStageFallback, containRect, SCENE_SHEET_W, SCENE_SHEET_H, SCENE_CELLS } from '../src/render/stagePainter.js';

// ---- PNG IHDR reader (stdlib only) ------------------------------------------
function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${path}`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---- recording 2D context stub -----------------------------------------------
// Records every drawImage so "non-blank" means "a real blit with positive area".
function recordingCtx(w = 480, h = 270) {
  const ops = [];
  return {
    canvas: { width: w, height: h },
    ops,
    clearRect: (...a) => ops.push({ op: 'clear', a }),
    save: () => {}, restore: () => {},
    drawImage: (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
      ops.push({ op: 'drawImage', sx, sy, sw, sh, dx, dy, dw, dh });
    },
    set globalAlpha(v) { this._ga = v; }, get globalAlpha() { return this._ga ?? 1; },
  };
}
const paintedPixels = (ctx) => ctx.ops.filter((o) => o.op === 'drawImage' && o.dw > 0 && o.dh > 0 && o.sw > 0 && o.sh > 0);

const imgStub = (w, h) => ({ naturalWidth: w, naturalHeight: h, complete: true });

// ---- §3.1 geometry audit: all used scene_ids ---------------------------------
const eventsData = JSON.parse(readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8'));
const usedSceneIds = [...new Set((eventsData.events || eventsData).flatMap((ev) => (ev.scene_id ? [ev.scene_id] : [])))].sort();

test('all used scene_ids exist as sheets and pass the geometry check', () => {
  assert.ok(usedSceneIds.length >= 35, `expected >=35 used scene ids, got ${usedSceneIds.length}`);
  const failures = [];
  for (const id of usedSceneIds) {
    let size = null;
    try { size = pngSize(new URL(`../assets/sprites/scene_${id}.png`, import.meta.url)); } catch { failures.push(`${id}: sheet missing`); continue; }
    const check = checkSceneSheet(imgStub(size.width, size.height));
    if (!check.ok) failures.push(`${id}: ${check.reason} (${size.width}x${size.height})`);
  }
  assert.deepEqual(failures, [], `scene sheets failing the blank-stage guard:\n${failures.join('\n')}`);
});

test('granary_siege specifically passes the geometry check', () => {
  const size = pngSize(new URL('../assets/sprites/scene_granary_siege.png', import.meta.url));
  const logs = [];
  const check = checkSceneSheet(imgStub(size.width, size.height), (m) => logs.push(m));
  assert.equal(check.ok, true, `granary_siege unavailable: ${check.reason}`);
  assert.ok(logs.length === 0, 'no diagnostics logged for a healthy sheet');
});

test('checkSceneSheet diagnoses broken sheets instead of silently no-oping (§3.1)', () => {
  const logs = [];
  const log = (m) => logs.push(m);
  assert.equal(checkSceneSheet(null, log).ok, false, 'missing sheet -> unavailable');
  assert.equal(checkSceneSheet({ naturalWidth: 0, naturalHeight: 0, complete: true }, log).ok, false, 'decode failed -> unavailable');
  assert.equal(checkSceneSheet({ naturalWidth: 100, naturalHeight: 50, complete: false }, log).ok, false, 'not decoded -> unavailable');
  // wrong cell count: a 100x180 sheet slices into slivers, not drawable frames
  const bad = checkSceneSheet(imgStub(100, 180), log);
  assert.equal(bad.ok, false, 'geometry mismatch -> unavailable');
  assert.ok(logs.some((l) => /naturalWidth=100/.test(l)), 'diagnostic names naturalWidth vs expected');
  // square-ish fallback: any sheet whose width slices into >=1 rows of its own
  // height is drawable even off-contract
  assert.equal(checkSceneSheet(imgStub(640, 160), log).ok, true, 'off-contract but sliceable stays drawable');
});

// ---- §3.3 pixel proof: drawSceneFrame paints every frame ----------------------
test('every frame of a scene sheet produces non-blank output through drawSceneFrame', () => {
  const sheet = imgStub(SCENE_SHEET_W, SCENE_SHEET_H);
  for (let f = 0; f < SCENE_CELLS; f++) {
    const ctx = recordingCtx();
    const drew = drawSceneFrame(ctx, sheet, f, 480, 270, SCENE_CELLS);
    assert.equal(drew, true, `frame ${f} reported drawn`);
    const px = paintedPixels(ctx);
    assert.ok(px.length >= 1, `frame ${f}: getImageData alpha sum would be > 0 (one real blit)`);
    assert.equal(px[0].sx, f * (SCENE_SHEET_W / SCENE_CELLS), `frame ${f} slices the right cell`);
    assert.ok(px[0].dx >= 0 && px[0].dy >= 0 && px[0].dx + px[0].dw <= 480.001 && px[0].dy + px[0].dh <= 270.001, `frame ${f} lands on-canvas (letterboxed)`);
  }
});

test('containRect letterboxes without cropping or overflowing', () => {
  const r = containRect(160, 180, 480, 270); // tall cell in a wide box
  assert.ok(r.dw <= 480 && r.dh <= 270, 'fits inside');
  assert.ok(Math.abs(r.dx - (480 - r.dw) / 2) < 1e-9, 'centered horizontally');
  assert.ok(Math.abs(r.dy - (270 - r.dh) / 2) < 1e-9, 'centered vertically');
  const e = containRect(0, 0, 480, 270);
  assert.deepEqual(e, { dx: 0, dy: 0, dw: 480, dh: 270 }, 'degenerate source safe');
});

// ---- §3.2 fallback: unavailable scene still paints ----------------------------
test('drawStageFallback paints background layers + idle figure when the scene is unavailable', () => {
  const ctx = recordingCtx();
  const drew = drawStageFallback(ctx, {
    bgFar: imgStub(640, 180), bgNear: imgStub(640, 180), costume: imgStub(512, 256),
  }, 480, 270, 0);
  assert.equal(drew, true);
  const px = paintedPixels(ctx);
  assert.ok(px.length >= 3, `far + near + figure blits, got ${px.length}`);
  const fig = px.at(-1);
  assert.ok(fig.dy + fig.dh <= 270.001 && fig.dy >= 0, 'figure stands on-canvas at the floor line');
});

test('fallback with ONLY the costume still paints (stage never empty)', () => {
  const ctx = recordingCtx();
  const drew = drawStageFallback(ctx, { bgFar: null, bgNear: null, costume: imgStub(512, 256) }, 480, 270, 2);
  assert.equal(drew, true);
  assert.ok(paintedPixels(ctx).length >= 1);
});

test('fallback with nothing at all reports false so callers can react', () => {
  const ctx = recordingCtx();
  assert.equal(drawStageFallback(ctx, {}, 480, 270, 0), false);
});
