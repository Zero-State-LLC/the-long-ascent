// v2 render-layer tests: SpriteAnimator frame slicing, AnimScene loop/one-shot,
// AudioManager init guard + mute persistence, ParallaxBg wrap math + era reset.
// No DOM/canvas required — pure logic + injectable stubs throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SpriteAnimator, costumeFrameAt, sliceCostumeFrames, loadAssets,
  COSTUME_FRAME_W, COSTUME_FRAME_H, COSTUME_FRAMES, ERA_IDS, BADGE_NAMES,
} from '../src/render/SpriteAnimator.js';
import {
  AnimScene, frameAt, sliceFrames, SCENE_FRAME_W, SCENE_FPS, SCENE_LOOP_FRAMES,
} from '../src/render/AnimScene.js';
import { ParallaxBg, wrapOffset, eraTempo, BASE_SPEED, LAYER_FACTOR } from '../src/render/ParallaxBg.js';
import { AudioManager, MUTE_KEY, CROSSFADE_SEC } from '../src/render/AudioManager.js';

const readyImg = (w = 512, h = 256) => ({ complete: true, naturalWidth: w, naturalWidth_: w, width: w, height: h });

// ---------------------------------------------------------------- SpriteAnimator
test('costume sheets slice into 4 frames of 128x256 at row offsets', () => {
  const frames = sliceCostumeFrames();
  assert.equal(frames.length, COSTUME_FRAMES);
  assert.deepEqual(frames.map((f) => f.sx), [0, 128, 256, 384]);
  for (const f of frames) {
    assert.equal(f.w, COSTUME_FRAME_W);
    assert.equal(f.h, COSTUME_FRAME_H);
    assert.equal(f.sy, 0);
  }
  // 4 cells tile the delivered 512x256 sheet exactly
  assert.equal(COSTUME_FRAMES * COSTUME_FRAME_W, 512);
});

test('costumeFrameAt cycles 0..3 at 6fps and wraps backwards-safe', () => {
  assert.equal(costumeFrameAt(0), 0);
  assert.equal(costumeFrameAt(0.16), 0);   // < 1/6s
  assert.equal(costumeFrameAt(1 / 6), 1);
  assert.equal(costumeFrameAt(3 / 6), 3);
  assert.equal(costumeFrameAt(4 / 6), 0);  // wraps
  assert.equal(costumeFrameAt(10 / 6), 2); // 10 % 4
});

test('SpriteAnimator maps era numbers to the 11 era ids and picks costumes', () => {
  assert.equal(ERA_IDS.length, 11);
  assert.equal(ERA_IDS[0], 'cave');
  assert.equal(ERA_IDS[10], 'singularity');
  const costumes = new Map([['cave', readyImg()], ['agriculture', null]]);
  const sa = new SpriteAnimator({ costumes, badges: new Map() });
  sa.setEra(1);
  assert.equal(sa.eraId(), 'cave');
  assert.equal(sa.available(), true);
  sa.setEra(2);
  assert.equal(sa.available(), false); // missing sheet -> parametric fallback
});

test('loadAssets resolves null (never throws) when every file is missing', async () => {
  const { costumes, badges } = await loadAssets({ loadImage: () => Promise.reject(new Error('404')) });
  assert.equal(costumes.size, 11);
  assert.equal(badges.size, BADGE_NAMES.length);
  for (const v of costumes.values()) assert.equal(v, null);
  for (const v of badges.values()) assert.equal(v, null);
});

test('badges are unique, validated, and drawn only when their glyph loaded', () => {
  const badgeImg = { complete: true, naturalWidth: 24, naturalHeight: 24 };
  const sa = new SpriteAnimator({ costumes: new Map(), badges: new Map([['fire', badgeImg]]) });
  assert.equal(sa.addBadge('fire'), true);
  assert.equal(sa.addBadge('fire'), false);       // idempotent
  assert.equal(sa.addBadge('not_a_badge'), false); // rejected
  assert.ok(sa.hasBadge('fire'));
  const calls = [];
  const ctx = { save() {}, restore() {}, drawImage(img) { calls.push(img); } };
  sa.drawBadges(ctx, 0);
  assert.equal(calls.length, 1); // only fire; missing glyphs skipped silently
});

// --------------------------------------------------------------------- AnimScene
test('scene sheets slice into 8 frames of 160x180 tiling the 1280 strip', () => {
  const frames = sliceFrames(1280, 8);
  assert.equal(frames.length, 8);
  assert.deepEqual(frames.map((f) => f.sx), [0, 160, 320, 480, 640, 800, 960, 1120]);
  assert.equal(frames[0].w, SCENE_FRAME_W);
  assert.equal(frames[0].h, 180);
  assert.equal(8 * SCENE_FRAME_W, 1280);
});

test('AnimScene loops frames 0..4 at 8fps while playing', () => {
  let now = 0;
  const sc = new AnimScene(null, readyImg(1280, 180), 160, 180, SCENE_FPS, {
    now: () => now, schedule: () => 1, cancel: () => {},
  });
  sc.play(true);
  // exact expected indices from the documented rule: frame = floor(t*fps) % loopFrames
  for (const [t, exp] of [[0, 0], [0.13, 1], [0.25, 2], [0.375, 3], [0.6249, 4], [0.625, 0], [0.7, 0], [1.0, 3]]) {
    now = t;
    assert.equal(sc.pump(now), exp, `t=${t}s -> frame ${exp}`);
  }
  sc.stop();
  assert.equal(sc.mode, 'stopped');
});

test('AnimScene one-shot plays outcome frames 5..7 then fires onDone once', () => {
  let now = 0;
  let done = 0;
  const sc = new AnimScene(null, readyImg(1280, 180), 160, 180, 8, {
    now: () => now, schedule: () => 1, cancel: () => {},
  });
  sc.playOnce(() => { done += 1; });
  assert.equal(sc.pump(0), SCENE_LOOP_FRAMES + 0); // frame 5 first
  now = 0.13; assert.equal(sc.pump(now), SCENE_LOOP_FRAMES + 1);
  now = 0.26; assert.equal(sc.pump(now), SCENE_LOOP_FRAMES + 2);
  assert.equal(done, 1);
  sc.pump(1.0); // clamped, no double-fire
  assert.equal(done, 1);
  assert.equal(sc.mode, 'stopped');
});

test('frameAt clamps one-shots and modulo-loops; degenerate inputs give 0', () => {
  assert.equal(frameAt(0.25, 8, 5, true), 2);
  assert.equal(frameAt(10, 8, 5, true), 0);           // 80 % 5
  assert.equal(frameAt(10, 8, 3, false), 2);          // clamps at last
  assert.equal(frameAt(-1, 8, 5, true), ((-8 % 5) + 5) % 5);
  assert.equal(frameAt(1, 0, 5), 0);
  assert.equal(frameAt(1, 8, 0), 0);
});

// ------------------------------------------------------------------- ParallaxBg
test('wrapOffset keeps offsets in [0, period) for negative and huge values', () => {
  assert.equal(wrapOffset(0, 640), 0);
  assert.equal(wrapOffset(640, 640), 0);
  assert.equal(wrapOffset(641, 640), 1);
  assert.equal(wrapOffset(-1, 640), 639);
  assert.equal(wrapOffset(-640, 640), 0);
  assert.equal(wrapOffset(10_000_000, 640), 10_000_000 % 640);
  assert.equal(wrapOffset(5, 0), 0); // degenerate period never NaN
});

test('scroll speed scales with era index: far+near px/sec per era', () => {
  const pb = new ParallaxBg();
  pb.setEra(1);
  const o1 = pb.update(1);
  assert.ok(Math.abs(o1.far - BASE_SPEED * LAYER_FACTOR.far * eraTempo(0)) < 1e-9);
  assert.ok(Math.abs(o1.near - BASE_SPEED * LAYER_FACTOR.near * eraTempo(0)) < 1e-9);
  const pb2 = new ParallaxBg();
  pb2.setEra(11);
  const o2 = pb2.update(1);
  assert.ok(o2.near > o1.near * 10, 'singularity scrolls >10x cave');
  assert.ok(eraTempo(10) > eraTempo(0));
});

test('ParallaxBg resets offsets on era change and ignores same-era re-set', () => {
  const pb = new ParallaxBg();
  pb.setEra(1);
  pb.update(2);
  assert.ok(pb.offsets.near > 0);
  assert.equal(pb.setEra(1), false);   // no reset
  assert.ok(pb.offsets.near > 0);
  assert.equal(pb.setEra(2), true);    // era changed -> reset
  assert.equal(pb.offsets.far, 0);
  assert.equal(pb.offsets.near, 0);
});

test('reduced motion freezes scroll; missing strips keep default wrap period', () => {
  const pb = new ParallaxBg({ reducedMotion: true });
  pb.setEra(5);
  const o = pb.update(10);
  assert.equal(o.far, 0);
  assert.equal(stripPeriodFallback(), 640);
});
function stripPeriodFallback() {
  const pb = new ParallaxBg();
  return pb.stripWidth(); // no layers loaded -> delivered strip width
}

// ------------------------------------------------------------------ AudioManager
test('AudioManager refuses init before a user gesture (throws)', () => {
  class FakeCtx { constructor() { this.destination = {}; } createGain() { return { gain: { value: 1 } }; } }
  const am = new AudioManager({ AudioCtx: FakeCtx, storage: null });
  assert.equal(am.initialized, false);
  assert.throws(() => am.init(), /no user gesture/i);
  assert.equal(am.initialized, false);
});

test('gesture unlock arms the manager and init becomes idempotent', () => {
  class FakeCtx { constructor() { this.destination = {}; this.gains = 0; } createGain() { this.gains++; return { gain: { value: 1 }, connect() {} }; } resume() {} }
  const listeners = {};
  const fakeDoc = {
    addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
  };
  const am = new AudioManager({ AudioCtx: FakeCtx, storage: null });
  am.attachGestureUnlock(fakeDoc);
  assert.ok(listeners.pointerdown?.length === 1);
  listeners.pointerdown[0](); // the gesture
  assert.equal(am.initialized, true);
  const ctx = am.ctx;
  assert.equal(am.init(), ctx); // idempotent
  // listeners removed after firing
  assert.equal(listeners.pointerdown.length, 0);
});

test('play/playBgm are silent no-ops pre-init and never throw', () => {
  const am = new AudioManager({ storage: null });
  assert.equal(am.play('click_choice'), false);
  assert.equal(am.playBgm('cave'), false);
  assert.equal(am.play('not_an_sfx'), false);
});

test('mute/unmute persist to localStorage and gate the master gain', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  class FakeCtx { constructor() { this.destination = {}; } createGain() { return { gain: { value: 1 }, connect() {} }; } resume() {} }
  const am = new AudioManager({ AudioCtx: FakeCtx, storage });
  assert.equal(am.muted, false);
  am.gestureArmed = true; // mute/unmute gate the master gain only once the context exists
  am.init();
  am.mute();
  assert.equal(store.get(MUTE_KEY), '1');
  assert.equal(am.master.gain.value, 0);
  // a fresh manager reads the persisted preference (gain gating needs its own context)
  const am2 = new AudioManager({ AudioCtx: FakeCtx, storage });
  assert.equal(am2.muted, true);
  am2.gestureArmed = true;
  am2.init();
  am2.unmute();
  assert.equal(store.get(MUTE_KEY), '0');
  assert.equal(am2.master.gain.value, 1);
});

test('playBgm crossfades: old track fades out, new track ramps up', () => {
  const ramps = []; // [gainObj, target] in ramp order (master excluded)
  class FakeGain {
    constructor() { this.gain = { value: 0, setTargetAtTime: (v) => { this.value = v; ramps.push([this, v]); } }; }
    connect() {}
  }
  class FakeCtx {
    constructor() { this.destination = {}; }
    createGain() { return new FakeGain(); }
    createMediaElementSource() { return { connect() {} }; }
  }
  const els = [];
  const makeEl = () => {
    const el = { src: '', loop: false, preload: '', play: () => Promise.resolve(), pause() {} };
    els.push(el);
    return el;
  };
  const am = new AudioManager({ AudioCtx: FakeCtx, storage: null, createMediaElement: makeEl, now: () => 0 });
  am.gestureArmed = true;
  am.init();
  assert.equal(am.playBgm('cave'), true);
  assert.ok(els[0].src.endsWith('bgm_cave.ogg'));
  assert.equal(els[0].loop, true);
  assert.equal(am.playBgm('agriculture'), true);
  assert.ok(els[1].src.endsWith('bgm_agriculture.ogg'));
  // ramps: [master -> (un)muted level], [old track -> 0], [new track -> 1]
  const targets = ramps.map(([, v]) => v);
  assert.deepEqual(targets, [1, 0, 1]);
  assert.equal(am.playBgm('agriculture'), false, 'same-era replay is a no-op');
});

test('missing audio files degrade to silence and are not retried', async () => {
  class FakeCtx { constructor() { this.destination = {}; } createGain() { return { gain: { value: 1 }, connect() {} }; } resume() {} decodeAudioData() { return Promise.reject(new Error('corrupt')); } createBufferSource() { return { buffer: null, connect() {}, start() {} }; } }
  const am = new AudioManager({ AudioCtx: FakeCtx, storage: null });
  am.gestureArmed = true;
  am.init();
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  assert.equal(am.play('fork'), true);   // accepted, async fetch will fail
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(am.play('fork'), false);  // marked failed: silent from now on
});
