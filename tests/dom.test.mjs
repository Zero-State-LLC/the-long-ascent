// Smoke test: boot the app in a simulated DOM (no jsdom dependency) and drive a few choices.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM shim -------------------------------------------------------
class Node {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this._text = ''; this.hidden = false; this.listeners = {}; this.title = '';
    this.attrs = {}; this.disabled = false; this.type = ''; this.value = ''; this.checked = false;
  }
  set className(v) { this._cls = v; } get className() { return this._cls || ''; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...ns) { for (const n of ns) if (n != null) this.children.push(n); }
  replaceChildren(...ns) { this.children = []; this.append(...ns); }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn(); }
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
  'chronicle-list', 'settings-form', 'ending-screen', 'title-screen', 'toast']) registry.set('#' + id, new Node('div'));
const navButtons = [0, 1, 2].map((i) => { const b = new Node('button'); b.dataset.view = ['game', 'chronicle', 'settings'][i]; return b; });

globalThis.document = {
  querySelector: (sel) => {
    if (sel === '[data-view]') return navButtons[0]; // iterated via for..of below
    return registry.get(sel) || new Node('div');
  },
  querySelectorAll: (sel) => (sel === '[data-view]' ? navButtons : []),
  createElement: (tag) => new Node(tag),
  documentElement: { dataset: {} },
  body: new Node('body'),
};
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
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.window = { devicePixelRatio: 1 };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0; // don't keep the process alive

const canvas = registry.get('#scene');
canvas.getContext = () => new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
canvas.getBoundingClientRect = () => ({ width: 800, height: 600 });

// ---- boot --------------------------------------------------------------------
const erasData = JSON.parse(readFileSync(new URL('../src/data/eras.json', import.meta.url), 'utf8'));
const eventsData = JSON.parse(readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8'));

test('app boots on the title screen and starts a lineage', async () => {
  const { bootApp } = await import('../src/ui/dom-boot.js');
  const app = bootApp({ erasData, eventsData });
  assert.ok(registry.get('#title-screen').textContent.includes('THE LONG ASCENT'), 'title splash rendered');
  assert.equal(app.game.state.era, 1);
  // click New Lineage
  const neu = findDeep(registry.get('#title-screen'), (n) => n.tagName === 'button' && n.textContent.includes('New Lineage'));
  assert.ok(neu, 'New Lineage button present');
  neu.click();
  assert.ok(registry.get('#card-wrap').children.length > 0, 'event card rendered');
  assert.equal(registry.get('#resource-bar').children.length, 6, 'six resource rows');
});

test('choosing through the UI advances the core and autosaves', async () => {
  const { bootApp } = await import('../src/ui/dom-boot.js');
  const app = bootApp({ erasData, eventsData });
  const before = app.game.state.tickCount;
  // pick first choice on whatever card is up
  const btn = findDeep(registry.get('#card-wrap'), (n) => n.tagName === 'button');
  assert.ok(btn, 'a choice button exists');
  btn.click();
  assert.ok(store.has('long-ascent-save-v1'), 'autosave wrote to localStorage');
  assert.ok(before >= 0);
  // chronicle view renders entries
  navButtons[1].click();
  assert.ok(registry.get('#chronicle-list').children.length >= 1, 'chronicle has entries after a choice');
});
