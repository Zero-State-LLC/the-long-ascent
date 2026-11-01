// src/ui/chrome.js — SPEC v9 §5: fixed chrome bands (D3).
// All persistent UI lives in fixed top/bottom DOM bands; the world layer owns
// everything between. The anchored-overlay path (positionWorldElement) is
// deleted — panels NEVER float over mid-screen world coordinates.
//
// CHROME-TOP: era name · era# · boundary hairline · six mini-bars
// CHROME-BOTTOM: idle → key-hint strip; active station → panel with wrapped
//   prompt, dimmed choices with reasons, ↑↓⏎ hint, Esc leave-unresolved.
//
// Styling tokens: research/chrome-tokens-v9.md (bg #090F1C, hairline #394969,
// text #DAE8FF, secondary #AAB7D0, muted #71809A, accent #B79CFF, panel
// #141D31, dimmed #71809A, dim-reason #E65B4B).
// The hud builder API is DOM-injectable (hud.js), so the six-pool strip is
// re-parented into the top band rather than reimplemented.

import { POOL_ORDER } from '../engine/hud.js';

const KEYS_IDLE = '← → walk · ↑ jump (hold=higher) · ↓ crouch-hold · E ask · X hold→release throw · Shift sprint · Tab almanac';

/**
 * @param {object} deps {
 *   topRoot     #chrome-top container (fixed band)
 *   bottomRoot  #chrome-bottom container (fixed band)
 *   hud         createHud() instance — render() re-parents into topRoot
 *   hudRoot     element inside topRoot the hud renders into
 *   copy        loadV9Copy() instance (station_ui hints)
 *   el          element factory (defaults to document.createElement)
 * }
 */
export function createChrome({ topRoot, bottomRoot, hud = null, hudRoot = null, copy, el = defaultEl }) {
  const hints = (copy && copy.stationUi()) || { select_hint: '↑↓ select · ⏎ commit', leave_hint: 'Esc leaves it open.' };

  // ---- top band skeleton -----------------------------------------------------
  if (topRoot) {
    topRoot.replaceChildren();
    topRoot.className = 'chrome-top';
    const left = el('div', 'chrome-top-left');
    const title = el('span', 'chrome-era-name', '');
    const eraNum = el('span', 'chrome-era-num', '');
    left.append(eraNum, title);
    const hair = el('div', 'chrome-hairline');
    const hairFill = el('div', 'chrome-hairline-fill');
    hair.append(hairFill);
    topRoot.append(left, hair);
    if (hudRoot) {
      hudRoot.className = 'chrome-pools';
      topRoot.append(hudRoot);
    }
  }

  // ---- bottom band skeleton ---------------------------------------------------
  let hintsEl = null;
  let panelEl = null;
  if (bottomRoot) {
    bottomRoot.replaceChildren();
    bottomRoot.className = 'chrome-bottom';
    hintsEl = el('div', 'chrome-keys', KEYS_IDLE);
    bottomRoot.append(hintsEl);
  }

  /** Top band render: era name/num + hairline progress; pools via hud.render. */
  function renderTop({ era, eraName, progress01, state }) {
    if (!topRoot) return;
    const name = topRoot.querySelector?.('.chrome-era-name');
    if (name) name.textContent = eraName || `ERA ${era}`;
    const num = topRoot.querySelector?.('.chrome-era-num');
    if (num) num.textContent = `ERA ${String(era).padStart(2, '0')}`;
    const fill = topRoot.querySelector?.('.chrome-hairline-fill');
    if (fill) fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress01)) * 100)}%`;
    if (hud && hudRoot) hud.render(state, { eraName: '', progress01, label: '' });
  }

  /**
   * Bottom band render. idle: key hints. active: station panel — wrapped
   * prompt, dimmed choices with reasons, selection, hint lines.
   * panel = null → idle strip.
   */
  function renderBottom(panel = null) {
    if (!bottomRoot) return;
    if (!panel) {
      if (hintsEl) { hintsEl.hidden = false; hintsEl.textContent = KEYS_IDLE; }
      if (panelEl) { panelEl.remove?.(); panelEl = null; }
      bottomRoot.classList?.remove?.('chrome-bottom-active');
      return;
    }
    if (hintsEl) hintsEl.hidden = true;
    if (!panelEl) {
      panelEl = el('div', 'station-panel');
      bottomRoot.append(panelEl);
    }
    bottomRoot.classList?.add?.('chrome-bottom-active');
    panelEl.replaceChildren();
    panelEl.append(el('p', 'station-title', panel.title || ''));
    // Wrapped prompt (CSS wraps; the panel width is the clamp).
    if (panel.prompt) panelEl.append(el('p', 'station-prompt', panel.prompt));
    const list = el('div', 'station-choices');
    (panel.choices || []).forEach((c, i) => {
      const row = el('button', 'station-choice'
        + (i === panel.selectedIndex ? ' station-choice-sel' : '')
        + (c.disabled ? ' station-choice-off' : ''));
      row.type = 'button';
      row.disabled = !!c.disabled;
      row.dataset.label = c.label;
      row.append(el('span', 'station-choice-label', c.label));
      if (c.disabled && c.requirement) row.append(el('span', 'station-choice-reason', c.requirement));
      if (c.walkAway) row.classList.add('station-choice-walkaway');
      list.append(row);
    });
    panelEl.append(list);
    const hintLine = el('p', 'station-hints',
      `${hints.select_hint || ''} · ${hints.leave_hint || ''}`);
    panelEl.append(hintLine);
    if (panel.inBeat) panelEl.append(el('p', 'station-beat', hints.consequence_pending || ''));
  }

  /** Fixed-caption one-liner (ambient hooks §1.3): a single non-pausing line. */
  let captionEl = null;
  let captionTimer = null;
  function caption(text, ms = 2600) {
    if (!bottomRoot || typeof setTimeout === 'undefined') return;
    if (!captionEl) {
      captionEl = el('div', 'chrome-caption');
      bottomRoot.append(captionEl);
    }
    captionEl.textContent = String(text || '');
    captionEl.hidden = !text;
    clearTimeout(captionTimer);
    if (text) captionTimer = setTimeout(() => { if (captionEl) captionEl.hidden = true; }, ms);
  }

  return {
    renderTop, renderBottom, caption,
    get panelElement() { return panelEl; },
  };
}

/** Exposed for tests: the six mini-bar pool order rides the top band. */
export const CHROME_POOL_ORDER = POOL_ORDER;

function defaultEl(tag, cls, text) {
  const n = createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function createElement(tag) {
  if (typeof document !== 'undefined' && document.createElement) return document.createElement(tag);
  // Headless fallback: a minimal node with the DOM-builder surface chrome uses.
  return {
    tagName: tag, children: [], style: {}, dataset: {},
    _text: '', hidden: false, className: '', disabled: false, type: '', parent: null,
    append(...ns) { for (const n of ns) if (n != null) { n.parent = this; this.children.push(n); } },
    replaceChildren(...ns) { this.children = []; this.append(...ns); },
    remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } },
    get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); },
    set textContent(v) { this._text = String(v); },
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
    },
  };
}
