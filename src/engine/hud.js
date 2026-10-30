// src/engine/hud.js — SPEC v6 §5: thin top resource strip, zero idle ticks.
// Pure DOM-builder module (testable without a real browser): renders the six
// pools in the v4 purple-bar language (--surface/--line/--accent tokens), plus
// the era caption and progress-to-boundary bar. Resources change ONLY through
// encounter choices / minigames — there is no tick() here by design; call
// render(state) whenever state changes and it repaints.

export const POOL_LABELS = {
  sustenance: 'Sustenance', knowledge: 'Knowledge', population: 'Population',
  infrastructure: 'Infra', legitimacy: 'Legitimacy', entropy: 'Entropy',
};
export const POOL_ORDER = ['sustenance', 'knowledge', 'population', 'infrastructure', 'legitimacy', 'entropy'];

/**
 * createHud({ root, el }) — `root` gets replaced children; `el(tag, cls, text)`
 * is an injectable element factory (defaults to document.createElement).
 */
export function createHud({ root, el = defaultEl }) {
  let lastEraName = null;

  function render(state, { eraName, progress01 = 0, label = '' } = {}) {
    if (!root) return;
    root.replaceChildren();

    // Era caption line (small, uppercase, muted — same voice as #era-header).
    const cap = el('div', 'hud-era');
    cap.append(el('span', 'hud-era-name', eraName || `ERA ${state.era}`));
    if (label) cap.append(el('span', 'hud-era-label', label));
    root.append(cap);

    // Thin boundary-progress hairline (walk distance to the next seam).
    const track = el('div', 'hud-track');
    const fill = el('div', 'hud-fill');
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress01)) * 100)}%`;
    track.append(fill);
    root.append(track);

    // The strip itself: six compact bars, purple language, no /s chips ever.
    const strip = el('div', 'hud-strip');
    strip.setAttribute?.('aria-label', 'Resources');
    for (const pool of POOL_ORDER) {
      const v = Number(state.resources?.[pool] ?? 0);
      const row = el('div', 'hud-res' + (pool === 'entropy' ? ' hud-entropy' : ''));
      row.title = POOL_LABELS[pool];
      row.append(el('span', 'hud-label', POOL_LABELS[pool]));
      row.append(el('span', 'hud-value', String(Math.round(v * 10) / 10)));
      const meter = el('span', 'hud-meter');
      const w = el('span', 'hud-meter-fill');
      w.style.width = `${Math.min(100, Math.max(0, (v / 100) * 100))}%`;
      meter.append(w);
      row.append(meter);
      strip.append(row);
    }
    root.append(strip);
    lastEraName = eraName;
  }

  /** In-world prompt bubble ("↓ Read the stone") anchored above an object. */
  function renderPrompt(promptRoot, { text = '↓', visible = false, fade = 1 } = {}) {
    if (!promptRoot) return;
    promptRoot.replaceChildren();
    if (!visible) { promptRoot.hidden = true; return; }
    promptRoot.hidden = false;
    const b = el('div', 'hud-prompt');
    b.style.opacity = String(Math.max(0, Math.min(1, fade)));
    b.append(el('span', 'hud-prompt-key', '↓'));
    b.append(el('span', 'hud-prompt-text', text));
    promptRoot.append(b);
  }

  /** In-world choice menu anchored to the object (never full-screen). */
  function renderMenu(menuRoot, { title = '', prompt = '', choices = [], onPick = null, selectedIndex = 0 }) {
    if (!menuRoot) return;
    menuRoot.replaceChildren();
    if (!choices.length) { menuRoot.hidden = true; return; }
    menuRoot.hidden = false;
    const card = el('div', 'hud-menu');
    if (title) card.append(el('p', 'hud-menu-title', title));
    if (prompt) card.append(el('p', 'hud-menu-prompt', prompt));
    const list = el('div', 'hud-menu-choices');
    choices.forEach((c, i) => {
      const btn = el('button', 'hud-choice' + (i === selectedIndex ? ' hud-choice-sel' : ''), c.label);
      btn.type = 'button';
      btn.dataset.label = c.label;
      if (onPick) btn.addEventListener('click', () => onPick(c.label));
      list.append(btn);
    });
    card.append(list);
    card.append(el('p', 'hud-menu-hint', '↑/↓ move · Enter choose · Esc close'));
    menuRoot.append(card);
  }

  return { render, renderPrompt, renderMenu, get lastEraName() { return lastEraName; } };
}

function defaultEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
