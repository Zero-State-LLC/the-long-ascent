// THE LONG ASCENT — UI layer. DOM screens over the pure core: resource bar,
// event cards, choice buttons, Chronicle, settings, endings. No game logic here.

import { createGame, POOLS } from '../core/game.js';
import { createRenderer } from '../render/renderer.js';

const SAVE_KEY = 'long-ascent-save-v1';
const SETTINGS_KEY = 'long-ascent-settings-v1';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fmt = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

export function bootApp({ erasData, eventsData }) {
  const U = erasData.uiStrings;
  let toastTimer = null;
  let game = loadGame() || createGame({ erasData, eventsData });
  let settings = loadSettings();
  let viewMode = 'game'; // game | chronicle | settings | ending

  const renderer = createRenderer($('#scene'));
  applySettings();

  // ------------------------------------------------------------------ toast
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
  }

  // ------------------------------------------------------------- resource bar
  function renderResourceBar() {
    const bar = $('#resource-bar');
    bar.replaceChildren();
    const era = game.eraDef();
    const labels = {
      sustenance: era.sustenanceLabel, knowledge: 'Knowledge', population: game.state.copies > 1 ? 'Instances' : 'Population',
      infrastructure: 'Infrastructure', legitimacy: 'Legitimacy', entropy: 'Entropy',
    };
    for (const pool of POOLS) {
      const row = el('div', 'res' + (pool === 'entropy' ? ' res-entropy' : ''));
      row.title = U.tooltips[pool];
      row.append(el('span', 'res-label', labels[pool]));
      row.append(el('span', 'res-value', String(Math.round(game.state.resources[pool] * 10) / 10)));
      if (pool === 'entropy') row.append(el('span', 'res-pattern', ''));
      bar.append(row);
    }
  }

  // ------------------------------------------------------------------- header
  function renderHeader() {
    const era = game.eraDef();
    const st = game.state;
    $('#era-title').textContent = `ERA ${era.num} — ${era.name}`;
    $('#era-sub').textContent = fmt(U.eraProgress, { era: era.signatureResource, pct: Math.min(100, Math.round(st.progress)) });
    const meta = [];
    meta.push(`Carrier ${roman(st.carrier)}`);
    if (st.copies > 1) meta.push(fmt(U.copyCount, { n: st.copies, m: Math.round(st.drift) }));
    if (era.num >= 8) meta.push(fmt(U.doomsdayClock, { n: Math.max(0, Math.round(st.clock / 10)) }));
    $('#era-meta').textContent = meta.join(' · ');
    const pb = $('#progress-fill');
    pb.style.width = `${Math.min(100, st.progress)}%`;
    pb.setAttribute('aria-valuenow', String(Math.round(st.progress)));
  }

  function roman(n) {
    const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out || 'I';
  }

  // -------------------------------------------------------------- event card
  function renderEventCard() {
    const wrap = $('#card-wrap');
    wrap.replaceChildren();
    const ev = game.currentEvent();
    if (!ev) {
      const wait = el('div', 'card waiting');
      wait.append(el('p', 'card-kicker', U.eraTransition));
      wrap.append(wait);
      return;
    }
    const card = el('article', 'card' + (ev.kind === 'transition' ? ' card-transition' : ''));
    card.append(el('p', 'card-kicker', ev.kind === 'lineage' ? 'Lineage' : U.eventModal[0]));
    card.append(el('h2', 'card-title', ev.title || ''));
    card.append(el('p', 'card-body', ev.body || ev.prompt || ''));
    if (ev.kind !== 'lineage') card.append(el('p', 'card-sub', U.eventModal[1]));
    const choices = el('div', 'choices');
    for (const c of ev.choices) {
      const btn = el('button', 'choice');
      btn.type = 'button';
      btn.append(el('span', 'choice-label', c.label));
      const hint = effectHint(c);
      if (hint) btn.append(el('span', 'choice-hint', hint));
      btn.title = U.choiceHover;
      btn.addEventListener('click', () => onChoose(c.label));
      choices.append(btn);
    }
    card.append(choices);
    wrap.append(card);
  }

  function effectHint(c) {
    const parts = [];
    for (const [k, v] of Object.entries(c.effects || {})) {
      if (POOLS.includes(k)) parts.push(`${k === 'sustenance' ? game.eraDef().sustenanceLabel : k} ${v > 0 ? '+' : '−'}${Math.abs(v)}`);
      else if (k === 'clock') parts.push(`danger ${v > 0 ? '+' : '−'}${Math.abs(v)}`);
      else if (k === 'morale') parts.push(`morale ${v > 0 ? '+' : '−'}${Math.abs(v)}`);
    }
    for (const f of c.flags || []) if (f.startsWith('seed_')) parts.push('⌘ trajectory');
    return parts.slice(0, 4).join(' · ');
  }

  function onChoose(label) {
    try {
      game.choose(label);
    } catch (err) {
      toast(U.toastCorrupt);
      return;
    }
    if (game.state.phase === 'ending') {
      autosave();
      showEnding();
    } else {
      autosave();
      renderAll();
    }
  }

  // ------------------------------------------------------------------ ending
  function showEnding() {
    viewMode = 'ending';
    const e = game.endingText();
    const root = $('#ending-screen');
    root.hidden = false;
    root.replaceChildren();
    root.append(el('p', 'ending-kicker', 'THE LONG ASCENT'));
    root.append(el('h1', 'ending-title', e ? e.title : 'The End'));
    root.append(el('p', 'ending-body', e ? e.body : ''));
    const stats = el('p', 'ending-stats', `Era ${game.state.era} · Carrier ${roman(game.state.carrier)} · ${game.state.chronicle.length} chronicle entries`);
    root.append(stats);
    const actions = el('div', 'ending-actions');
    const chron = el('button', 'btn', U.buttons[2]);
    chron.addEventListener('click', () => { viewMode = 'chronicle'; root.hidden = true; renderAll(); });
    const again = el('button', 'btn btn-primary', U.buttons[0]);
    again.addEventListener('click', () => { newLineage(); });
    const exp = el('button', 'btn', U.buttons[4]);
    exp.addEventListener('click', exportSave);
    actions.append(chron, again, exp);
    root.append(actions);
  }

  // --------------------------------------------------------------- chronicle
  function renderChronicle() {
    const list = $('#chronicle-list');
    list.replaceChildren();
    const entries = [...game.state.chronicle].reverse();
    if (!entries.length) { list.append(el('li', 'chron-empty', 'No decisions yet. The ancestors are unimpressed and silent.')); return; }
    for (const c of entries) {
      const li = el('li', 'chron-entry chron-' + c.kind);
      const mark = el('span', 'chron-era', `E${c.era}`);
      mark.style.borderColor = eraAccent(c.era);
      li.append(mark);
      li.append(el('span', 'chron-text', c.text));
      list.append(li);
    }
  }
  const eraAccent = (n) => ['#FF7A32', '#D49B3B', '#D5A64B', '#E5B95E', '#8B3F3B', '#D18A42', '#C84D46', '#A8D879', '#54D6C8', '#E779B7', '#B79CFF'][n - 1] || '#fff';

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    const root = $('#settings-form');
    root.replaceChildren();
    const speedRow = settingRow('Speed', U.settingsSpeed);
    const speed = document.createElement('input');
    speed.type = 'range'; speed.min = '1'; speed.max = '4'; speed.step = '1';
    speed.value = String(settings.speed || 2);
    speed.addEventListener('input', () => { settings.speed = Number(speed.value); saveSettings(); });
    speedRow.control.append(speed);

    const motionRow = settingRow('Reduce Motion', U.settingsMotion);
    const motion = document.createElement('input');
    motion.type = 'checkbox'; motion.checked = !!settings.reduceMotion;
    motion.addEventListener('change', () => { settings.reduceMotion = motion.checked; saveSettings(); applySettings(); });
    motionRow.control.append(motion);

    root.append(speedRow.node, motionRow.node);

    const expBtn = el('button', 'btn', U.buttons[4]);
    expBtn.addEventListener('click', exportSave);
    const impBtn = el('button', 'btn', U.buttons[5]);
    impBtn.addEventListener('click', importSave);
    const resetBtn = el('button', 'btn btn-danger', 'Reset');
    resetBtn.title = U.settingsReset;
    resetBtn.addEventListener('click', () => {
      if (confirm(U.settingsReset)) { localStorage.removeItem(SAVE_KEY); newLineage(); }
    });
    root.append(el('div', 'settings-actions'));
    root.querySelector('.settings-actions').append(expBtn, impBtn, resetBtn);
  }

  function settingRow(label, hint) {
    const node = el('div', 'setting-row');
    const l = el('label', 'setting-label', label);
    const control = el('span', 'setting-control');
    l.htmlFor = '';
    node.append(l, control);
    if (hint) node.append(el('p', 'setting-hint', hint));
    return { node, control };
  }

  // ------------------------------------------------------------ save/manage
  function autosave() {
    try { localStorage.setItem(SAVE_KEY, game.serialize()); } catch { /* storage unavailable */ }
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const g = createGame({ erasData, eventsData });
      g.deserialize(raw);
      toast(U.load);
      return g;
    } catch {
      toast(U.toastCorrupt);
      return null;
    }
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { speed: 2, reduceMotion: false }; } catch { return { speed: 2, reduceMotion: false }; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
  }
  function applySettings() {
    renderer.setReducedMotion(settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.dataset.speed = String(settings.speed || 2);
  }
  function exportSave() {
    const code = game.exportCode();
    navigator.clipboard?.writeText(code).then(
      () => toast(`${U.save} Code copied.`),
      () => prompt('Save code:', code),
    ) ?? prompt('Save code:', code);
  }
  function importSave() {
    const code = prompt('Paste a save code:');
    if (!code) return;
    try { game.importCode(code.trim()); autosave(); toast(U.load); renderAll(); } catch { toast(U.toastCorrupt); }
  }
  function newLineage() {
    game = createGame({ erasData, eventsData });
    viewMode = 'game';
    $('#ending-screen').hidden = true;
    autosave();
    renderAll();
  }

  // ------------------------------------------------------------------ screens
  function setView(mode) {
    viewMode = mode === 'game' && game.state.phase === 'ending' ? 'ending' : mode;
    $('#ending-screen').hidden = viewMode !== 'ending';
    renderAll();
    if (viewMode === 'ending') showEnding();
  }

  function renderAll() {
    renderHeader();
    renderResourceBar();
    renderEventCard();
    if (viewMode === 'chronicle') renderChronicle();
    if (viewMode === 'settings') renderSettings();
    if (viewMode === 'ending') showEnding();
    renderer.setEra(game.state.era);
    renderer.setEntropy(game.state.resources.entropy);
    renderer.setCopies(game.state.copies);
    document.body.dataset.view = viewMode;
  }

  // ---------------------------------------------------------------- idle loop
  // The core advances progress/resources via tick(); pace follows the Speed setting.
  let acc = 0;
  setInterval(() => {
    if (viewMode !== 'game' || game.state.phase === 'ending') return;
    acc += Number(document.documentElement.dataset.speed || 2);
    while (acc >= 1) { acc -= 1; game.tick(); }
    if (game.state.phase === 'ending') { autosave(); showEnding(); return; }
    renderHeader();
    renderResourceBar();
    if (!game.currentEvent()) renderEventCard();
  }, 400);

  // intro splash
  function showTitle() {
    const splash = $('#title-screen');
    splash.hidden = false;
    splash.replaceChildren();
    splash.append(el('h1', 'title-main', U.title));
    splash.append(el('p', 'title-tag', U.tagline));
    const btns = el('div', 'title-buttons');
    const hasSave = !!localStorage.getItem(SAVE_KEY);
    const neu = el('button', 'btn btn-primary', U.buttons[0]);
    neu.addEventListener('click', () => { newLineage(); splash.hidden = true; });
    const cont = el('button', 'btn', U.buttons[1]);
    cont.disabled = !hasSave;
    cont.addEventListener('click', () => { splash.hidden = true; renderAll(); });
    btns.append(neu, cont);
    splash.append(btns);
  }

  // nav rail
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  }

  showTitle();
  renderAll();
  return { get game() { return game; }, renderer, toast };
}
