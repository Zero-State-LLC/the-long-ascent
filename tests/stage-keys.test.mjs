// SPEC v4 §2 integration: with an event card open, the stage owns the keys.
// ←/→ walk (page must not scroll), walking onto a marker arms its button,
// Enter confirms the armed choice, digits 1-4 select directly.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim (same shape as tests/dom.test.mjs) ---------------------
class Node {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this._text = ''; this.hidden = false; this.listeners = {}; this.title = '';
    this.attrs = {}; this.disabled = false; this.type = ''; this.value = ''; this.checked = false;
  }
  set className(v) { this._cls = v; } get className() { return this._cls || ''; }
  get classList() {
    const self = this;
    const has = (c) => (self._cls || '').split(/\s+/).includes(c);
    return {
      add: (c) => { if (!has(c)) self._cls = `${self._cls || ''} ${c}`.trim(); },
      remove: (c) => { self._cls = (self._cls || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, on) => { if (on === undefined ? !has(c) : on) this.classList.add(c); else this.classList.remove(c); },
      contains: has,
    };
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...ns) { for (const n of ns) if (n != null) this.children.push(n); }
  replaceChildren(...ns) { this.children = []; this.append(...ns); }
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
  'chronicle-list', 'settings-form', 'ending-screen', 'title-screen', 'primer-screen', 'toast']) registry.set('#' + id, new Node('div'));
const navButtons = [0, 1, 2].map((i) => { const b = new Node('button'); b.dataset.view = ['game', 'chronicle', 'settings'][i]; return b; });

globalThis.document = {
  querySelector: (sel) => (sel === '[data-view]' ? navButtons[0] : registry.get(sel) || new Node('div')),
  querySelectorAll: (sel) => (sel === '[data-view]' ? navButtons : []),
  createElement: (tag) => new Node(tag),
  documentElement: { dataset: {} },
  body: new Node('body'),
  listeners: {},
};
// document-level key listeners are what stageKeydown mounts on.
const docListeners = {};
// A real EventTarget iterates a *snapshot* of listeners: a handler that calls
// removeEventListener mid-dispatch (AudioManager's one-shot unlock does) must
// not splice the live array and skip handlers queued behind it.
globalThis.document.addEventListener = (ev, fn) => {
  const l = (docListeners[ev] ||= []);
  l.push(fn);
  l._snap = [...l]; // next dispatch iterates this snapshot
};
globalThis.document.removeEventListener = (ev, fn) => {
  const l = docListeners[ev] || [];
  const i = l.indexOf(fn);
  if (i >= 0) l.splice(i, 1);
};
function keyEvent(key) {
  let prevented = false;
  return { key, preventDefault: () => { prevented = true; }, get prevented() { return prevented; } };
}
function fireKey(key) {
  const e = keyEvent(key);
  for (const fn of docListeners.keydown?._snap || []) fn(e);
  return e;
}
function releaseKey(key) {
  const e = keyEvent(key);
  for (const fn of docListeners.keyup?._snap || []) fn(e);
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
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
// ---- fake clock ---------------------------------------------------------------
// The stage rAF loop is stubbed (returns 0, never fires), so position must be
// integrated by the test's own pump, exactly like the real loop does: update(dt).
let simT = 1000; // seconds, arbitrary non-zero start
globalThis.performance = { now: () => simT * 1000 };
globalThis.window = { devicePixelRatio: 1 };
globalThis.setInterval = () => 0;

const canvas = registry.get('#scene');
canvas.getContext = () => new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
canvas.getBoundingClientRect = () => ({ width: 800, height: 600 });

const erasData = JSON.parse(readFileSync(new URL('../src/data/eras.json', import.meta.url), 'utf8'));
const eventsData = JSON.parse(readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8'));

function bootFresh(title) {
  // Each test needs a fresh module graph only once; bootApp is re-runnable.
  return bootPromise.then(({ bootApp }) => {
    const app = bootApp({ erasData, eventsData });
    const neu = findDeep(registry.get('#title-screen'), (n) => n.tagName === 'button' && n.textContent.includes(title));
    neu.click();
    // §9.1 first-run primer gates Era 1 once (lives in #primer-screen) — skip it.
    const skip = findDeep(registry.get('#primer-screen'), (n) => n.tagName === 'button');
    if (skip) skip.click();
    return app;
  });
}
const bootPromise = import('../src/ui/dom-boot.js');

test('arrow keys arm markers and Enter confirms through the UI', async () => {
  const app = await bootFresh('New Lineage');
  const wrap = registry.get('#card-wrap');
  const buttons = [];
  (function collect(n) { for (const c of n.children || []) { if (c.tagName === 'button' && c.dataset.label) buttons.push(c); collect(c); } })(wrap);
  assert.ok(buttons.length >= 2, `event card has choice buttons (${buttons.length})`);

  // Right arrow walks right: consumed (no page scroll) and moves the figure.
  const x0 = app.walk.x;
  const eRight = fireKey('ArrowRight');
  assert.equal(eRight.prevented, true, 'ArrowRight consumed while card open');
  simT += 0.25; app.walk.update(0.25); // pump like the rAF loop would
  assert.ok(app.walk.x > x0, `figure walked right (${x0} -> ${app.walk.x})`);

  // Keep walking right until some marker arms (markers at even spacing). Tap +
  // pump mirrors the rAF loop: keydown holds, each pump integrates one dt.
  let guard = 0;
  while (app.walk.armed == null && guard++ < 500) { simT += 0.1; app.walk.update(0.1); }
  assert.ok(app.walk.armed != null, 'walking right eventually arms a choice');
  releaseKey('ArrowRight'); // stop holding before the digit/select steps below
  // Drive the UI sync the way the loop would: fire a no-op keydown that lands on
  // the armed state (stageKeydown calls syncArmedUi for select/confirm paths),
  // then assert the .armed class landed on the right button.
  const armedIdx = app.walk.armed;
  fireKey(String(armedIdx + 1)); // select:<n> path re-arms and syncs the UI
  const armedBtn = buttons[armedIdx];
  assert.ok(armedBtn.className.split(' ').includes('armed'), 'armed choice button carries .armed class');

  // Disarm geometry: with 3 markers (0.25/0.5/0.75) and arm radius 0.06 the
  // figure can never fully disarm by walking — every x on the floor is within
  // reach of some marker (the design intent: a choice is always one step from
  // arming). What must change when walking away is *which* choice is armed.
  fireKey('2');
  assert.equal(app.walk.armed, 1, 'digit 2 arms the second choice');
  fireKey('ArrowLeft'); // keydown: hold left (keyup comes after the walk)
  let g2 = 0;
  while (app.walk.armed === 1 && g2++ < 200) { simT += 0.05; app.walk.update(0.05); }
  releaseKey('ArrowLeft');
  assert.ok(g2 < 200, `walking left moved the arm off choice 1 (armed=${app.walk.armed})`);
  assert.ok(app.walk.x < 0.44, `figure stepped left off marker 1 (x=${app.walk.x})`);

  // Digit selects directly (costume-missing path works too), Enter then confirms.
  fireKey('2');
  assert.equal(app.walk.armed, 1, 'digit 2 arms the second choice');
  const eraBefore = app.game.state.era, chronBefore = app.game.state.chronicle.length;
  const eEnter = fireKey('Enter');
  assert.equal(eEnter.prevented, true, 'Enter consumed while card open');
  assert.ok(app.game.state.chronicle.length > chronBefore || app.game.state.era !== eraBefore, 'Enter confirmed the armed choice into the core');
});

test('arrow keys fall through when no card stage is open', async () => {
  const app = await bootFresh('New Lineage');
  // go to chronicle view: no stage open there
  navButtons[1].click();
  const e = fireKey('ArrowRight');
  assert.equal(e.prevented, false, 'ArrowRight NOT consumed outside the game view');
  navButtons[0].click();
});
