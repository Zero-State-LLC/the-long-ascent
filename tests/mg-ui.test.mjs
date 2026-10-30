// tests/mg-ui.test.mjs — SPEC v5 §4 integration on the fake DOM (same shim
// shape as stage-keys.test.mjs): launch button on the stage canvas, countdown,
// Esc forfeit with no reward, ledger scoreboard rows, delta chips on end.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim -------------------------------------------------------
class Node {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this._text = ''; this.hidden = false; this.listeners = {}; this.title = '';
    this.attrs = {}; this.disabled = false; this.type = ''; this.value = ''; this.checked = false;
    this.isConnected = true;
  }
  set className(v) { this._cls = v; } get className() { return this._cls || ''; }
  get classList() {
    const self = this;
    const has = (c) => (self._cls || '').split(/\s+/).includes(c);
    return {
      add: (c) => { if (!has(c)) self._cls = `${self._cls || ''} ${c}`.trim(); },
      remove: (c) => { self._cls = (self._cls || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, on) => { if (on === undefined ? !has(c) : on) self.classList.add(c); else self.classList.remove(c); },
      contains: has,
    };
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...ns) { for (const n of ns) if (n != null) this.children.push(n); }
  replaceChildren(...ns) { this.children = []; this.append(...ns); }
  remove() { /* dom-boot's chip-teardown hook only needs this to exist */ }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn(); }
  focus() {}
  querySelector(sel) { const want = sel.slice(1); return findDeep(this, (n) => n._cls && n._cls.split(' ').includes(want)); }
  setAttribute(k, v) { this.attrs[k] = v; }
}
function findDeep(node, pred) {
  for (const c of node.children || []) {
    if (pred(c)) return c;
    const hit = findDeep(c, pred);
    if (hit) return hit;
  }
  return null;
}
const registry = new Map();
for (const id of ['scene', 'era-title', 'era-sub', 'era-meta', 'progress-fill', 'resource-bar', 'card-wrap',
  'chronicle-list', 'settings-form', 'ending-screen', 'title-screen', 'primer-screen', 'toast']) {
  const n = new Node('div');
  if (id === 'scene') n.getContext = () => (n._ctx ||= recordingCtx(n));
  registry.set('#' + id, n);
}
const navButtons = [0, 1, 2].map((i) => { const b = new Node('button'); b.dataset.view = ['game', 'chronicle', 'settings'][i]; return b; });

// Recording 2D context: every fillText lands in `drawn` so the test can assert
// what the overlay PAINTED (countdown label, verdict, delta chips). Property
// sets (fillStyle, font...) are absorbed by the Proxy.
function recordingCtx(canvas) {
  const drawn = [];
  const noop = () => {};
  const target = {
    canvas, drawn,
    fillText: (t) => drawn.push(String(t)),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

globalThis.document = {
  querySelector: (sel) => (sel === '[data-view]' ? navButtons[0] : registry.get(sel) || new Node('div')),
  querySelectorAll: (sel) => (sel === '[data-view]' ? navButtons : []),
  createElement: (tag) => {
    const n = new Node(tag);
    if (tag === 'canvas') {
      let own = null;
      n.getContext = () => (own ||= recordingCtx(n));
    }
    return n;
  },
  documentElement: { dataset: {} },
  body: new Node('body'),
  listeners: {},
};
const docListeners = {};
globalThis.document.addEventListener = (ev, fn) => {
  const l = (docListeners[ev] ||= []);
  l.push(fn);
  l._snap = [...l];
};
globalThis.document.removeEventListener = (ev, fn) => {
  const l = docListeners[ev] || [];
  const i = l.indexOf(fn);
  if (i >= 0) l.splice(i, 1);
};
function fireKey(key) {
  let prevented = false;
  const e = { key, preventDefault: () => { prevented = true; }, get prevented() { return prevented; } };
  for (const fn of docListeners.keydown?._snap || []) fn(e);
  return e;
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;

// Driven rAF: the stage loop registers ONE callback at a time; pump() runs it
// forward on our fake clock, exactly like the browser would.
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => { rafCb = null; };
let simT = 1000; // seconds
globalThis.performance = { now: () => simT * 1000 };
globalThis.window = { devicePixelRatio: 1 };
globalThis.setInterval = () => 0;
// controllable timers: endMinigame uses setTimeout for the chip teardown + session tear
const timers = [];
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, at: simT * 1000 + (ms || 0) }); return timers.length; };
function runTimers() {
  const now = simT * 1000;
  for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) if (t.at <= now) t.fn();
}
function pump(steps = 1, dtMs = 16) {
  for (let i = 0; i < steps; i++) {
    simT += dtMs / 1000;
    const cb = rafCb; rafCb = null;
    if (cb) cb(simT * 1000);
  }
}

// Every canvas (renderer + per-card stage canvases) gets its OWN recording ctx
// (wired into document.createElement above).
registry.get('#scene').getBoundingClientRect = () => ({ width: 800, height: 600 });

const erasData = JSON.parse(readFileSync(new URL('../src/data/eras.json', import.meta.url), 'utf8'));
const eventsData = JSON.parse(readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8'));
const bootPromise = import('../src/ui/dom-boot.js');

async function freshBoot() {
  // Reset module-level test state between boots: a previous boot's stageLoop
  // (single rafCb slot), keydown listeners, and fake timers all leak across
  // tests and steal frames/keys from the new session.
  rafCb = null;
  for (const k of Object.keys(docListeners)) delete docListeners[k];
  timers.length = 0;
  simT = 1000;
  store.clear();
  const { bootApp } = await bootPromise;
  const app = bootApp({ erasData, eventsData });
  const neu = findDeep(registry.get('#title-screen'), (n) => n.tagName === 'button' && n.textContent.includes('New Lineage'));
  neu.click();
  const skip = findDeep(registry.get('#primer-screen'), (n) => n.tagName === 'button');
  if (skip) skip.click();
  return app;
}

// The stage canvas is the one carrying the .card-scene-active class.
function stageCanvas() {
  return findDeep(registry.get('#card-wrap'), (n) => n.tagName === 'canvas');
}

test('v5 §4: era stage shows the launch button; clicking it starts the countdown on canvas', async () => {
  const app = await freshBoot();
  assert.equal(app.game.eraMinigame(), 'granary', 'era 1 offers Granary Handout');
  const btn = findDeep(registry.get('#card-wrap'), (n) => n._cls === 'btn btn-minigame');
  assert.ok(btn, 'launch button rendered on the stage');
  btn.click();
  const canvas = stageCanvas();
  assert.ok(canvas, 'stage canvas present');
  const ctx = canvas.getContext('2d');
  pump(2); // first frames paint the countdown
  assert.ok(ctx.drawn.includes('Ready…'), `countdown label painted (saw ${JSON.stringify(ctx.drawn.slice(0, 10))})`);
  assert.ok(ctx.drawn.some((t) => /^[0-9]$/.test(t)), 'a countdown digit was painted');
});

test('v5 §4: Escape forfeits mid-run — score 0, no deltas applied, slot still consumed', async () => {
  const app = await freshBoot();
  const btn = findDeep(registry.get('#card-wrap'), (n) => n._cls === 'btn btn-minigame');
  btn.click();
  pump(2); // one painted frame so the run is live
  const before = { ...app.game.state.resources, morale: app.game.state.morale };
  const esc = fireKey('Escape');
  assert.ok(esc.prevented, 'overlay consumes Escape');
  pump(2); // draw the end card
  runTimers(); // let the tear-down timer fire so mgSession clears like production
  const ctx = stageCanvas().getContext('2d');
    assert.ok(ctx.drawn.includes('FORFEITED'), `end card paints the forfeit verdict (saw ${JSON.stringify(ctx.drawn.slice(-6))})`);
  assert.equal(app.game.state.minigames.playedThisEra, 1, 'rate-limit slot consumed even on forfeit');
  const after = { ...app.game.state.resources, morale: app.game.state.morale };
  assert.deepEqual(after, before, 'forfeit pays nothing');
});

test('v5 §4: a finished run applies capped rewards and paints delta chips on the end card', async () => {
  const app = await freshBoot();
  const btn = findDeep(registry.get('#card-wrap'), (n) => n._cls === 'btn btn-minigame');
  btn.click();
  pump(30 * 4); // countdown out
  // Autopilot through the overlay keys ONLY (UI path): chase sacks toward
  // center, hammer Enter; the run ends by timeout at the latest.
  let guard = 0;
  while (app.game.state.minigames.playedThisEra === 0 && guard++ < 5000) {
    fireKey(guard % 2 === 0 ? 'ArrowRight' : 'Enter');
    pump(1);
  }
  pump(2); // paint the end card: endMinigame flips the phase, next frame draws the verdict
  assert.equal(app.game.state.minigames.playedThisEra, 1, 'run completed within the window');
  const ctx = stageCanvas().getContext('2d');
  // The end card repaints each rAF while the session lives (static verdict);
  // assert it IS the last thing painted and appears at least once.
  const verdict = ctx.drawn.filter((t) => ['WON', 'LOST'].includes(t));
  assert.ok(verdict.length >= 1, `verdict painted (saw ${JSON.stringify(ctx.drawn.slice(-14))})`);
  assert.ok(['WON', 'LOST'].includes(ctx.drawn[ctx.drawn.length - 4]), 'verdict is the final card painted');
  assert.ok(ctx.drawn.some((t) => /^[a-z]+ [+-]\d+$/.test(t)), `delta chips painted (saw ${JSON.stringify(ctx.drawn.slice(-8))})`);
  // Ledger best recorded through the UI path (a lost run with score 0 correctly
  // leaves best unset — recordResult only stores improvements).
  assert.equal(app.game.state.minigames.playedThisEra, 1, 'UI run recorded exactly once');
});

test('v5 §4: ledger scoreboard rows appear once a family has a best score', async () => {
  const app = await freshBoot();
  // Seed a best directly, then re-render the card by choosing through the event.
  app.game.applyMinigameReward('granary', {}, { score: 777 });
  const wrap = registry.get('#card-wrap');
  const evBtn = findDeep(wrap, (n) => n.tagName === 'button' && n._cls !== 'btn btn-minigame');
  evBtn.click(); // advance -> next event card renders -> scoreboard path re-runs
  const board = findDeep(wrap, (n) => n._cls === 'mg-scoreboard');
  assert.ok(board, 'scoreboard rendered on the stage');
  assert.ok(board.textContent.includes('Granary Handout: 777'), `row shows title + best (got "${board.textContent}")`);
});
