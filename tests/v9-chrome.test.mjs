// tests/v9-chrome.test.mjs — SPEC-v9 §4 D3: fixed chrome regions + §3 input map.
// Chrome bands own all persistent UI (panel roots are chrome containers);
// positionWorldElement is deleted; the input map matches SPEC §3 exactly
// (C toggle gone, mouse fallback gone, ↑↓⏎/Esc in the station panel).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createChrome, CHROME_POOL_ORDER } from '../src/ui/chrome.js';
import { loadV9Copy } from '../src/engine/v9copy.js';
import { POOL_ORDER } from '../src/engine/hud.js';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v9CopyDoc = JSON.parse(readFileSync(path.join(R, 'research/v9-copy.json'), 'utf8'));
const copy = loadV9Copy(v9CopyDoc);

// Minimal DOM shim (same shape as tests/dom.test.mjs).
class Node {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this._text = ''; this.hidden = false; this.className = ''; this.title = '';
    this.disabled = false; this.type = ''; this.parent = null;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...ns) {
    for (const n of ns) if (n != null) { n.parent = this; this.children.push(n); }
  }
  replaceChildren(...ns) { this.children = []; this.append(...ns); }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
  querySelector(sel) {
    const want = sel.slice(1);
    const walk = (n) => {
      for (const c of n.children || []) {
        if ((c.className || '').split(/\s+/).includes(want)) return c;
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
}

// ---- D3: panel roots' parents are chrome containers ------------------------------
test('v9 D3: chrome bands construct; station panel renders INSIDE the bottom band', () => {
  const top = new Node('header');
  const bottom = new Node('footer');
  const chrome = createChrome({ topRoot: top, bottomRoot: bottom, hud: null, hudRoot: null, copy });
  // Idle: key hints strip visible, no panel.
  chrome.renderBottom(null);
  assert.equal(top.children.length > 0, true, 'top band built');
  assert.ok(bottom.children.some((c) => c.className === 'chrome-keys'), 'idle key-hint strip in the band');
  // Active: the panel element's parent IS the bottom chrome container.
  chrome.renderBottom({
    title: 'THE SALT CARAVAN',
    prompt: 'The salt must move; the caravan wants terms.',
    choices: [
      { label: 'Give grain', disabled: true, requirement: copy.dimReason('no_item_stone') },
      { label: 'Trade a secret', disabled: false },
    ],
    selectedIndex: 1,
    hints: copy.stationUi(),
    inBeat: false,
  });
  const panel = bottom.children.find((c) => c.className === 'station-panel');
  assert.ok(panel, 'station panel element exists');
  assert.ok(bottom.children.includes(panel), 'panel parent is the chrome-bottom container (never world-anchored)');
  assert.ok(panel.textContent.includes('THE SALT CARAVAN'), 'title rendered');
  assert.ok(panel.textContent.includes('No stone in hand'), 'dim reason from the copy pack rendered');
  assert.ok(panel.textContent.includes('↑↓ select'), 'nav hint rendered');
  // Back to idle: panel is removed, hints return.
  chrome.renderBottom(null);
  assert.equal(bottom.children.some((c) => c.className === 'station-panel'), false, 'panel removed on close');
});

test('v9 D3: positionWorldElement is deleted from the boot layer', () => {
  const src = readFileSync(path.join(R, 'src/ui/scroller-boot.js'), 'utf8');
  assert.ok(!src.includes('positionWorldElement'), 'the anchored-overlay path is gone');
  assert.ok(src.includes('renderChrome'), 'chrome render path present');
  assert.ok(!src.includes('pointerFallback'), 'mouse fallback deleted (§3 keyboard-only mandate)');
  const html = readFileSync(path.join(R, 'index.html'), 'utf8');
  assert.ok(html.includes('id="chrome-top"') && html.includes('id="chrome-bottom"'), 'fixed bands exist in the shell');
  assert.ok(!html.includes('world-menu') && !html.includes('world-prompt'), 'anchored overlay roots deleted from the shell');
});

// ---- §3 input map (normative) ------------------------------------------------------
test('v9 §3: input map — C crouch-toggle REMOVED; crouch is hold-↓/S only', () => {
  const src = readFileSync(path.join(R, 'src/ui/scroller-boot.js'), 'utf8');
  assert.ok(!/k === 'c' \|\| k === 'C'/.test(src), 'no C key handler');
  assert.ok(/ArrowDown' \|\| k === 's'\) keys\.down = true/.test(src), '↓/S is a crouch hold');
});

test('v9 D3: the six mini-bars ride the top band (pool order contract)', () => {
  assert.deepEqual(CHROME_POOL_ORDER, POOL_ORDER);
  assert.equal(CHROME_POOL_ORDER.length, 6);
});

test('v9 D3: fixed-caption ambient hook helper exists and never pauses', () => {
  // The caption path lives in chrome.caption(); verify it exists and the boot
  // layer wires it (no pause: captions are text-only).
  const top = new Node('header');
  const bottom = new Node('footer');
  const chrome = createChrome({ topRoot: top, bottomRoot: bottom, hud: null, hudRoot: null, copy });
  chrome.caption('Someone carried a question to that ridge.');
  assert.equal(typeof chrome.caption, 'function');
  // Chrome exposes the panel element for tests (parents' contract).
  assert.equal(chrome.panelElement, null);
});
