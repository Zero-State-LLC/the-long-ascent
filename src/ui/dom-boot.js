// THE LONG ASCENT — UI layer. DOM screens over the pure core: resource bar,
// event cards, choice buttons, Chronicle, settings, endings. No game logic here.

import { createGame, POOLS, ENTROPY_BGM_THRESHOLD } from '../core/game.js';
import { createRenderer } from '../render/renderer.js';
import { SpriteAnimator, loadAssets, ERA_IDS, BADGE_NAMES } from '../render/SpriteAnimator.js';
import { AnimScene, drawFrame } from '../render/AnimScene.js';
import { checkSceneSheet, drawSceneFrame, drawStageFallback, FLOOR_FRAC } from '../render/stagePainter.js';
import { StageWalk } from './stageWalk.js';
import {
  createRun, step as mgStep, act as mgAct, forfeit as mgForfeit, reward as mgReward,
  isAvailable, ledgerRows, MINIGAME_COPY,
} from '../core/minigames.js';
import { drawMinigameFrame, drawCountdown, drawEndCard } from '../render/minigameStage.js';
import { ParallaxBg } from '../render/ParallaxBg.js';
import { AudioManager } from '../render/AudioManager.js';

const SAVE_KEY = 'long-ascent-save-v1';
const SETTINGS_KEY = 'long-ascent-settings-v1';
const BADGES_KEY = 'long-ascent-badges-v1';
const PRIMER_KEY = 'long-ascent-primer-seen-v1'; // §9.1: first-run primer, remembered

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fmt = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

export function bootApp({ erasData, eventsData, copyData = null }) {
  const U = erasData.uiStrings;
  // v2.1 copy (SPEC §9.5, Scribe): tooltips/primer/goals/delta flavor. Missing
  // file -> fall back to the era uiStrings so the game never renders empty.
  const COPY = copyData || {};
  const TOOLTIPS = { ...U.tooltips, ...(COPY.tooltips || {}) };
  let toastTimer = null;
  let game = loadGame() || createGame({ erasData, eventsData, copyData: COPY });
  let settings = loadSettings();
  let viewMode = 'game'; // game | chronicle | settings | ending

  const renderer = createRenderer($('#scene'));

  // ------------------------------------------------------- v2 media (non-blocking)
  // Sprite/audio layers load lazily after boot; every consumer degrades to v1 when
  // an asset is missing, so the game is playable before (or without) any of this.
  const audio = new AudioManager();
  audio.attachGestureUnlock(typeof document !== 'undefined' ? document : null);
  const sprites = new SpriteAnimator(null, { reducedMotion: settings.reduceMotion });
  const parallax = new ParallaxBg({ reducedMotion: settings.reduceMotion });
  applySettings(); // safe now: v2 instances exist
  renderer.setSpriteAnimator(sprites);
  renderer.setParallax(parallax);
  let sceneAnim = null; // AnimScene for the open event card
  const sheetCache = new Map(); // sprite url -> Promise<img|null>
  const bgCache = new Map();    // `${eraId}` -> {far,near} promises

  // ---- SPEC v4 §2: walkable figure on the event-card stage -----------------
  // Pure state machine (stageWalk.js); this block is its only DOM adapter.
  const walk = new StageWalk({ count: 0, reducedMotion: settings.reduceMotion, v2: false });
  let stageCtx = null;        // 2D ctx of the open card's stage canvas
  let stageCanvasRef = null;  // the open card's stage canvas element
  let stageSheet = null;      // scene sheet img (null => fallback layers)
  let stageCostume = null;    // era costume img for the walking figure
  let stageBg = { far: null, near: null }; // era background layers for the fallback
  let stageMarkers = [];      // DOM dots positioned over the floor
  let stageButtons = [];      // choice buttons (armed class target)
  let stageRaf = null;        // rAF handle for the walk render loop
  let stageLastT = 0;
  const prefersReducedMotion = () =>
    settings.reduceMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function loadImage(src) {
    return new Promise((res) => {
      if (typeof Image === 'undefined') return res(null);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null); // graceful: caller skips the layer
      img.src = src;
    });
  }
  function cachedSheet(url) {
    if (!sheetCache.has(url)) sheetCache.set(url, loadImage(url));
    return sheetCache.get(url);
  }

  // Kick off sprite + first-era strip loading without awaiting (never gates boot).
  loadAssets({ loadImage }).then(({ costumes, badges }) => {
    sprites.assets = { costumes, badges };
    for (const b of loadBadges()) sprites.addBadge(b);
  }).catch(() => { /* stay parametric */ });
  loadEraStrips(game.state.era);

  function loadEraStrips(eraNum) {
    const eraId = ERA_IDS[eraNum - 1];
    if (!eraId) return;
    if (!bgCache.has(eraId)) {
      bgCache.set(eraId, Promise.all([
        cachedSheet(`assets/sprites/bg_${eraId}_far.png`),
        cachedSheet(`assets/sprites/bg_${eraId}_near.png`),
      ]));
    }
    bgCache.get(eraId).then(([far, near]) => renderer.setParallaxLayers(far, near));
  }

  function loadBadges() {
    try {
      const arr = JSON.parse(localStorage.getItem(BADGES_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((b) => BADGE_NAMES.includes(b)) : [];
    } catch { return []; }
  }
  function persistBadges() {
    try { localStorage.setItem(BADGES_KEY, JSON.stringify(sprites.badges)); } catch { /* noop */ }
  }
  // Sync earned badges from game state (save codes carry them) and storage.
  function syncBadges() {
    const st = game.state;
    if (!Array.isArray(st.badges)) st.badges = []; // pre-v2 deserialized saves
    for (const b of [...st.badges]) if (sprites.addBadge(b)) persistBadges();
    for (const b of loadBadges()) if (sprites.addBadge(b)) { if (!st.badges.includes(b)) st.badges.push(b); }
  }
  syncBadges();

  // Era transitions: crossfade BGM + play the transition sting + swap strips.
  renderer.onEraChange((num) => {
    audio.play('era_transition');
    audio.playBgm(ERA_IDS[num - 1] || 'title');
    loadEraStrips(num);
  });

  // SFX hooks per SPEC §4.3: badge earned, carrier death (heir named), fork/drift in era 11+.
  let prevCopies = game.state.copies;
  let prevLineageDeaths = 0;
  // Era goal completion sting (§9.1): the Chronicle line is written by core; here
  // we hear it once per new entry and light the sprite badge.
  let prevGoalLines = 0;
  function sfxHooks() {
    if (sprites.badges.length > (sfxHooks._badges || 0)) audio.play('upgrade');
    sfxHooks._badges = sprites.badges.length;
    const goalLines = (game.state.chronicle || []).filter((c) => c.kind === 'goal').length;
    if (goalLines > prevGoalLines) audio.play('era_goal_complete');
    prevGoalLines = goalLines;
    const deaths = (game.state.chronicle || []).filter((c) => /^Died in era/.test(c.text || '')).length;
    if (deaths > prevLineageDeaths) audio.play('lineage_death');
    prevLineageDeaths = deaths;
    if (game.state.copies > prevCopies) audio.play('fork');
    else if (game.state.copies < prevCopies) audio.play('drift');
    prevCopies = game.state.copies;
  }

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
      row.title = TOOLTIPS[pool] || ''; // §9.1: hover on desktop, long-press on touch
      row.append(el('span', 'res-label', labels[pool]));
      row.append(el('span', 'res-value', String(Math.round(game.state.resources[pool] * 10) / 10)));
      // §9.1: explain idle production — "Food 182 +1.2/s". Deltas come from the
      // same core function tick() applies, so chips never lie about the sim.
      const rate = game.poolRate(pool);
      if (rate !== 0) row.append(el('span', 'res-delta', `${rate > 0 ? '+' : '−'}${Math.abs(rate).toFixed(1)}/s`));
      if (pool === 'entropy') row.append(el('span', 'res-pattern', ''));
      bar.append(row);
    }
  }

  // ------------------------------------------------------------------- header
  function renderHeader() {
    const era = game.eraDef();
    const st = game.state;
    $('#era-title').textContent = `ERA ${era.num} — ${era.name}`;
    // §9.1: label the purple bar — always-visible caption, not a hover ghost.
    const pct = Math.min(100, Math.round(st.progress));
    const nextName = (erasData.eras[era.num] && erasData.eras[era.num].name) || 'what comes next';
    const labelTpl = COPY.era_progress_label_format || 'ERA PROGRESS — {pct}% → next: {era}';
    $('#progress-label').textContent = fmt(labelTpl, { pct, era: nextName });
    const goal = game.eraGoal();
    if (goal) {
      const done = st.eraGoalsDone.includes(goal.era);
      $('#era-goal').textContent = `${done ? '✓ ' : ''}${goal.name} — ${goal.description}`;
      $('#era-goal').classList.toggle('era-goal-done', done);
    } else {
      $('#era-goal').textContent = '';
    }
    $('#era-sub').textContent = fmt(U.eraProgress, { era: era.signatureResource, pct });
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
  // SPEC v4 §2 stage loop: scene frame + walking figure + marker dots. Runs
  // while a card with a stage is open; draws the fallback layers when the scene
  // sheet is unavailable so the stage is never empty (§3).
  function stageFrame(t) {
    if (!stageCtx) return;
    const cv = stageCtx.canvas;
    const w = cv.width, h = cv.height;
    let drewScene = false;
    if (stageSheet) {
      const f = sceneAnim && sceneAnim.mode !== 'stopped' ? sceneAnim.currentFrame : Math.floor(t * 8) % 5;
      drewScene = drawSceneFrame(stageCtx, stageSheet, f, w, h, 8);
    }
    if (!drewScene) {
      drawStageFallback(stageCtx, { bgFar: stageBg.far, bgNear: stageBg.near, costume: stageCostume }, w, h, walk.frame(t));
    } else if (stageCostume) {
      // figure on the floor line over the scene
      const ch = h * 0.5;
      const cw = stageCostume.naturalWidth && stageCostume.naturalHeight ? ch * (stageCostume.naturalWidth / 4) / stageCostume.naturalHeight : ch / 2;
      drawFrame(stageCtx, stageCostume, walk.frame(t), w * walk.x - cw / 2, h * FLOOR_FRAC - ch, cw, ch, 4);
    }
    for (let i = 0; i < stageMarkers.length; i++) {
      stageMarkers[i].style.left = `${walk.markers[i] * 100}%`;
    }
  }

  function stageLoop(now) {
    stageRaf = null;
    if (!stageCtx || (stageCtx.canvas && stageCtx.canvas.isConnected === false)) { stopStageLoop(); return; }
    const t = now / 1000;
    const dt = stageLastT ? Math.min(0.25, t - stageLastT) : 0;
    stageLastT = t;
    walk.reducedMotion = prefersReducedMotion();
    walk.update(dt);
    syncArmedUi();
    stageFrame(t);
    if (mgSession) {
      if (mgSession.canvas !== stageCanvasRef && mgSession.canvas?.isConnected === false) mgSession = null; // host card gone
      else mgFrame(t);
    }
    stageRaf = requestAnimationFrame(stageLoop);
  }
  function startStageLoop() {
    if (stageRaf != null || typeof requestAnimationFrame === 'undefined') return;
    stageLastT = 0;
    stageRaf = requestAnimationFrame(stageLoop);
  }
  function stopStageLoop() {
    if (stageRaf != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(stageRaf);
    stageRaf = null;
    stageCtx = null; stageSheet = null; stageMarkers = []; stageButtons = []; stageCanvasRef = null;
  }

  // SPEC v4 §2: while an event card is open the stage owns ←/→, Enter, Space and
  // digits — the page must not scroll underneath the card.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', stageKeydown);
    document.addEventListener('keyup', stageKeyup);
  }

  // Highlight ring follows the armed marker; its choice button gets .armed.
  // classList-free (classList.toggle is undefined on some minimal DOM shims).
  function setArmedClass(node, on) {
    if (!node) return;
    const cls = (node.className || '').split(/\s+/).filter(Boolean);
    const i = cls.indexOf('armed');
    if (on && i < 0) cls.push('armed');
    if (!on && i >= 0) cls.splice(i, 1);
    node.className = cls.join(' ');
  }
  function syncArmedUi() {
    for (let i = 0; i < stageMarkers.length; i++) setArmedClass(stageMarkers[i], walk.armed === i);
    for (let i = 0; i < stageButtons.length; i++) setArmedClass(stageButtons[i], walk.armed === i);
  }

  // Keyboard adapter: consumes arrows/Enter/Space/digits while a card is open so
  // the page never scrolls under it. Mounted once; reads live stage state.
  function stageKeydown(e) {
    if (viewMode !== 'game') return;
    if (mgSession && mgKey(e)) return; // v5: overlay owns all keys mid-run
    if (!stageButtons.length && !stageCtx) return; // no card stage open
    const action = walk.keyAction(e.key);
    if (action === 'ignore') return;
    e.preventDefault();
    if (action === 'left' || action === 'right') {
      walk.apply(action);
      startStageLoop();
      return;
    }
    if (action.startsWith('select:')) {
      const r = walk.apply(action);
      syncArmedUi();
      if (r.selected != null && stageButtons[r.selected]) focusButton(stageButtons[r.selected]);
      stageTickOnce();
      return;
    }
    if (action === 'confirm') {
      const r = walk.apply(action);
      if (r.confirm != null && stageButtons[r.confirm]) onChoose(stageButtons[r.confirm].dataset.label, stageCanvasRef);
    }
  }
  function stageKeyup(e) {
    const action = walk.keyAction(e.key);
    if (action === 'left' || action === 'right') walk.release(action);
  }
  function focusButton(btn) { try { btn.focus({ preventScroll: true }); } catch { /* older DOM shims */ } }
  function stageTickOnce() {
    if (stageRaf == null) stageFrame((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
  }

  // ---- SPEC v5 §4: mini-game session on the same stage canvas ----------------
  // mgSession phases: countdown -> play -> end. The overlay owns keys while it
  // is non-null; renderEventCard() aborts a run if its host canvas goes away.
  let mgSession = null; // { run, phase, count, ctx, canvas, w, h, deltas, lastT }
  const crisisActiveNow = () => Object.keys(game.state.crisisLatched || {}).length > 0;

  // Offer check for the era's family (eras.json `minigame.family`). Crossing II
  // ('crossing') is a trigger record — never an overlay (spec §3).
  function minigameOffer() {
    const fam = game.eraMinigame();
    if (!fam || fam === 'crossing') return { ok: false, why: 'none' };
    return isAvailable(game.state.minigames, fam, {
      eraNum: game.state.era,
      crisisActive: crisisActiveNow(),
      crossingOpen: !!game.state.crossingUnlocked && viewMode === 'ending',
    });
  }

  function startMinigame() {
    const offer = minigameOffer();
    if (!offer.ok || !stageCanvasRef || mgSession) { if (offer.why) toast(MINIGAME_COPY[offer.why] || ''); return; }
    const fam = game.eraMinigame();
    // Seed from run count + era so replays within a lineage differ but stay reproducible.
    const seed = (game.state.tickCount * 2654435761 ^ (game.state.era * 97) ^ (game.state.minigames.playedThisEra * 131)) >>> 0;
    mgSession = {
      family: fam,
      run: createRun(fam, { seed, diff: Math.min(1, (game.state.era - 1) / 16) }),
      phase: 'countdown', count: 3,
      canvas: stageCanvasRef, ctx: stageCtx,
      lastT: 0, deltas: null,
    };
    audio.play('click_choice');
    startStageLoop(); // guarantees a rAF pump for the overlay
  }

  function endMinigame(forfeited) {
    const s = mgSession;
    if (!s) return;
    s.run = forfeited ? mgForfeit(s.run) : s.run;
    s.phase = 'end';
    s.deltas = forfeited ? {} : mgReward(s.run);
    const applied = game.applyMinigameReward(s.family, s.deltas, { score: s.run.score });
    autosave();
    renderHeader();
    renderResourceBar();
    const { node } = deltaChips(applied);
    $('#card-wrap').append(node);
    setTimeout(() => { try { node.remove?.(); } catch { /* shim without remove */ } }, 5200);
    // Let the end card sit on canvas for a beat, then tear the session down.
    setTimeout(() => { if (mgSession === s) mgSession = null; }, 2600);
  }

  // Per-frame overlay pump; called from stageLoop when a session is active.
  function mgFrame(nowSec) {
    const s = mgSession;
    if (!s || !s.ctx) return;
    const dt = s.lastT ? Math.min(0.1, nowSec - s.lastT) : 0;
    s.lastT = nowSec;
    const w = s.canvas.width, h = s.canvas.height;
    if (s.phase === 'countdown') {
      drawCountdown(s.ctx, s.count, w, h);
      s.count -= dt;
      if (s.count <= 0) s.phase = 'play';
      return;
    }
    if (s.phase === 'play') {
      s.run = mgStep(s.run, dt);
      if (s.run.done) endMinigame(false);
      else drawMinigameFrame(s.ctx, s.run, w, h);
      return;
    }
    // 'end': static verdict card with delta chips until teardown.
    drawEndCard(s.ctx, s.run, s.deltas, w, h);
  }

  // Keyboard adapter for the overlay (spec §4): Esc forfeits; family inputs map
  // from arrows/WASD/digits. Consumes everything while active so the walk mode
  // and page scroll stay out of the way.
  function mgKey(e) {
    const s = mgSession;
    if (!s) return false;
    e.preventDefault();
    if (s.phase === 'end') { if (e.key === 'Enter' || e.key === 'Escape') mgSession = null; return true; }
    if (s.phase === 'countdown') {
      if (walk.forfeitAction(e.key) === 'forfeit') { endMinigame(true); return true; } // Esc cancels before the gun
      s.count = Math.min(s.count, 0.01); return true; // any other key skips ahead
    }
    if (walk.forfeitAction(e.key) === 'forfeit') { endMinigame(true); return true; }
    const k = e.key;
    const map = {
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
      ' ': s.family === 'fallout' ? 'rest' : 'duck',
      Shift: s.family === 'fallout' ? 'run' : 'stand',
      q: 'gate:left', Q: 'gate:left', e: 'gate:right', E: 'gate:right',
      Enter: 'stop',
    };
    if (/^[0-3]$/.test(k)) { mgAct(s.run, `digit:${Number(k)}`); return true; }
    const actName = map[k];
    if (actName) mgAct(s.run, actName);
    return true;
  }

  function renderEventCard() {
    if (mgSession) return; // v5: never tear down the stage under a live run
    const wrap = $('#card-wrap');
    wrap.replaceChildren();
    stopStageLoop(); // SPEC v4: previous card's stage loop/markers are gone
    const ev = game.currentEvent();
    if (!ev) {
      const wait = el('div', 'card waiting');
      wait.append(el('p', 'card-kicker', U.eraTransition));
      wrap.append(wait);
      return;
    }
    // Lineage (heir-naming) cards get the ledger only: no stage, no walk mode.
    const isLineage = ev.kind === 'lineage';
    const card = el('article', 'card' + (ev.kind === 'transition' ? ' card-transition' : ''));
    // SPEC v4 §1: two-stage layout — RIGHT column is the stage shell (canvas +
    // marker rail + caption), LEFT column is the ledger (title → body → choices).
    // CSS puts them side by side >=900px, stacked stage-on-top below that.
    let sceneCanvas = null;
    const stage = el('div', 'card-stage');
    if (ev.scene_id && !isLineage) {
      sceneCanvas = document.createElement('canvas');
      sceneCanvas.className = 'card-scene card-scene-active';
      sceneCanvas.width = 480;
      sceneCanvas.height = 270;
      sceneCanvas.setAttribute('aria-hidden', 'true');
      stage.append(sceneCanvas);
    }
    let rail = null;
    if (!isLineage) {
      rail = el('div', 'choice-marker-rail');
      rail.setAttribute('aria-hidden', 'true');
      stage.append(rail);
      stage.append(el('p', 'stage-caption', `${game.eraDef().name || ''} · ${ev.scene_id || 'no scene'}`));
      card.append(stage);
    }
    const ledger = el('div', 'card-ledger');
    ledger.append(el('p', 'card-kicker', ev.kind === 'lineage' ? 'Lineage' : U.eventModal[0]));
    ledger.append(el('h2', 'card-title', ev.title || ''));
    ledger.append(el('p', 'card-body', ev.body || ev.prompt || ''));
    if (ev.kind !== 'lineage') ledger.append(el('p', 'card-sub', U.eventModal[1]));
    const choices = el('div', 'choices');
    for (const c of ev.choices) {
      const btn = el('button', 'choice');
      btn.type = 'button';
      btn.dataset.label = c.label;
      btn.append(el('span', 'choice-label', c.label));
      const hint = effectHint(c);
      if (hint) btn.append(el('span', 'choice-hint', hint));
      btn.title = U.choiceHover;
      btn.addEventListener('click', () => onChoose(c.label, sceneCanvas));
      choices.append(btn);
    }
    ledger.append(choices);
    card.append(ledger);
    wrap.append(card);

    // ---- wire the walkable stage (§2) --------------------------------------
    walk.setChoiceCount(isLineage ? 0 : ev.choices.length);
    stageButtons = [...choices.children]; // .choice buttons (querySelectorAll-free)
    stageMarkers = rail ? walk.markers.map(() => {
      const dot = el('div', 'choice-marker');
      dot.style.left = '0%';
      rail.append(dot);
      return dot;
    }) : [];
    syncArmedUi();
    if (sceneCanvas) {
      const ctx = sceneCanvas.getContext?.('2d'); // shim canvases without 2D: no walk render
      stageCtx = ctx || null;
      stageCanvasRef = ctx ? sceneCanvas : null;
    }
    // ---- SPEC v5 §4: mini-game launch button + ledger scoreboard on the stage.
    if (stageCanvasRef && !isLineage) {
      const offer = minigameOffer();
      if (offer.ok) {
        const fam = game.eraMinigame();
        const mgBtn = el('button', 'btn btn-minigame', MINIGAME_COPY[fam]?.title || fam);
        mgBtn.type = 'button';
        mgBtn.title = `${MINIGAME_COPY[fam]?.blurb || ''} — Esc forfeits`;
        mgBtn.addEventListener('click', startMinigame);
        stage.append(mgBtn);
      }
      const rows = ledgerRows(game.state.minigames).filter((r) => r.best > 0);
      if (rows.length) {
        const board = el('div', 'mg-scoreboard');
        board.setAttribute('aria-label', 'Mini-game ledger');
        for (const r of rows) board.append(el('span', 'mg-score-row', `${r.title}: ${r.best}`));
        stage.append(board);
      }
    }
    // Era costume for the figure (missing sheet => no figure, keys 1-4 still work).
    const eraId = ERA_IDS[game.state.era - 1];
    stageCostume = sprites.assets?.costumes?.get(eraId) || null;
    cachedSheet(`assets/sprites/costume_${eraId}.png`).then((img) => {
      if (img && stageCanvasRef === sceneCanvas) stageCostume = img;
    });
    bgCache.get(eraId)?.then(([far, near]) => { stageBg = { far, near }; });
    // Start (or restart) the scene loop for this event once its sheet resolves.
    if (sceneAnim) { sceneAnim.stop(); sceneAnim = null; }
    if (sceneCanvas && ev.scene_id) {
      cachedSheet(`assets/sprites/scene_${ev.scene_id}.png`).then((img) => {
        if (!stageCanvasRef || stageCanvasRef !== sceneCanvas) return; // card replaced
        const check = checkSceneSheet(img, (m) => console.debug(m));
        if (!check.ok) {
          // §3: unavailable scene -> mark it so and paint the fallback immediately.
          stageSheet = null;
          sceneCanvas.classList.remove('card-scene-active');
          drawStageFallback(stageCtx, { bgFar: stageBg.far, bgNear: stageBg.near, costume: stageCostume }, sceneCanvas.width, sceneCanvas.height, 0);
          startStageLoop(); // keep the idle figure animating on the fallback
          return;
        }
        stageSheet = img;
        sceneCanvas.classList.add('card-scene-active');
        sceneAnim = new AnimScene(stageCtx, img, 160, 180, 8, {});
        sceneAnim.play(true);
        startStageLoop(); // figure + markers ride on top of the scene frames
      });
    } else if (stageCtx && !isLineage) {
      // No scene_id: still never empty — fallback layers behind the ledger view.
      drawStageFallback(stageCtx, { bgFar: stageBg.far, bgNear: stageBg.near, costume: stageCostume }, 480, 270, 0);
      startStageLoop();
    }
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

  // §9.2 outcome reveal: "+12 Food, −3 Legitimacy, +1 badge: Fire" as chips under
  // the card, using Scribe delta_flavor copy for the hover/aria line.
  function deltaChips(deltas, badges = []) {
    const wrapEl = el('div', 'outcome-chips');
    const labels = { ...poolLabels() };
    const parts = [];
    for (const [p, v] of Object.entries(deltas || {})) {
      const chip = el('span', 'chip ' + (v > 0 ? 'chip-up' : 'chip-down'), `${v > 0 ? '+' : '−'}${Math.abs(v)} ${labels[p] || p}`);
      const tpl = v > 0 ? COPY.delta_flavor?.gain : COPY.delta_flavor?.loss;
      if (tpl) chip.title = fmt(tpl, { n: Math.abs(v), res: labels[p] || p });
      wrapEl.append(chip);
      parts.push(chip.textContent);
    }
    for (const b of badges) {
      const chip = el('span', 'chip chip-badge', `+1 badge: ${b[0].toUpperCase()}${b.slice(1)}`);
      if (COPY.delta_flavor?.badge) chip.title = fmt(COPY.delta_flavor.badge, { badge: b });
      wrapEl.append(chip);
      parts.push(chip.textContent);
    }
    return { node: wrapEl, text: parts.join(', ') };
  }

  function poolLabels() {
    return {
      sustenance: game.eraDef().sustenanceLabel, knowledge: 'Knowledge',
      population: game.state.copies > 1 ? 'Instances' : 'Population',
      infrastructure: 'Infrastructure', legitimacy: 'Legitimacy', entropy: 'Entropy',
    };
  }

  function onChoose(label, sceneCanvas = null) {
    audio.play('click_choice');
    const advance = () => {
      let res;
      try {
        res = game.choose(label);
      } catch (err) {
        toast(U.toastCorrupt);
        return;
      }
      syncBadges();
      sfxHooks();
      const cur = game.state.chronicle.at(-1);
      if (cur && /Benthics recorded this choice/.test(cur.text || '')) audio.play('benthic_ping');
      if (sprites.badges.length && !game.state.badges.length) persistBadges();
      // §9.2: soft tick when consequences become visible (+ sfx_era_goal_complete
      // when the choice carried the era across its goal line).
      const hasDeltas = res && res.deltas && Object.keys(res.deltas).length;
      if (hasDeltas || (res && res.badges && res.badges.length)) audio.play('choice_deltas');
      if (game.state.phase === 'ending') {
        autosave();
        showEnding();
      } else {
        autosave();
        renderAll();
        if (hasDeltas || (res && res.badges && res.badges.length)) showOutcomeChips(res.deltas, res.badges);
      }
    };
    // v2: play the outcome frames (one-shot) before advancing — capped so a slow
    // or missing sheet can never gate gameplay.
    if (sceneAnim && sceneCanvas && sceneCanvas.isConnected) {
      let done = false;
      const go = () => { if (!done) { done = true; advance(); } };
      sceneAnim.playOnce(go);
      setTimeout(go, 700);
    } else {
      advance();
    }
  }

  function showOutcomeChips(deltas, badges = []) {
    const { node } = deltaChips(deltas, badges);
    const wrap = $('#card-wrap');
    wrap.append(node);
    setTimeout(() => { try { node.remove?.(); } catch { /* shim without remove: harmless */ } }, 5200);
  }

  // ------------------------------------------------------------------ ending
  function showEnding() {
    viewMode = 'ending';
    const e = game.endingText();
    if (game.state.ending) audio.play(`ending_${String(game.state.ending).replace(/^the_/, '')}`);
    audio.playBgm('ending'); // §9.4: bgm_ending bed under every ending screen
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

  // --------------------------------------------------------------- lineage (§9.2)
  // "Legacy modifiers pane": everything past choices did to this bloodline,
  // straight from state.lineageMods (persisted in the save).
  function renderLineage() {
    const list = $('#lineage-list');
    list.replaceChildren();
    const mods = game.state.lineageMods || [];
    if (!mods.length) { list.append(el('li', 'chron-empty', 'No modifiers yet. Every choice so far was deniable.')); return; }
    for (const m of mods) {
      const li = el('li', 'lineage-mod');
      li.append(el('span', 'lineage-mod-era', `E${m.era}`));
      li.append(el('span', 'lineage-mod-name', m.name));
      li.append(el('span', 'lineage-mod-blurb', m.blurb));
      list.append(li);
    }
  }

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

    // v2: audio mute (persisted by AudioManager itself to localStorage)
    const soundRow = settingRow('Sound', 'Music and effects. Silent until you click anywhere once.');
    const sound = document.createElement('input');
    sound.type = 'checkbox'; sound.checked = !audio.muted;
    sound.addEventListener('change', () => {
      if (sound.checked) { try { audio.init(); } catch { /* pre-gesture: preference still persists */ } audio.unmute(); }
      else audio.mute();
    });
    soundRow.control.append(sound);

    // §9.1: "Pause during choices" — on by default, persisted with the rest of settings.
    const pauseRow = settingRow('Pause during choices', 'Production stops while an event card is open. Reading should not cost Food.');
    const pause = document.createElement('input');
    pause.type = 'checkbox'; pause.checked = settings.pauseDuringChoices !== false;
    pause.addEventListener('change', () => { settings.pauseDuringChoices = pause.checked; saveSettings(); });
    pauseRow.control.append(pause);

    root.append(speedRow.node, motionRow.node, soundRow.node, pauseRow.node);

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
      const g = createGame({ erasData, eventsData, copyData: COPY });
      g.deserialize(raw);
      toast(U.load);
      return g;
    } catch {
      toast(U.toastCorrupt);
      return null;
    }
  }
  function loadSettings() {
    // pauseDuringChoices defaults ON (SPEC §9.1): reading a card must not cost resources.
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { speed: 2, reduceMotion: false, pauseDuringChoices: true }; } catch { return { speed: 2, reduceMotion: false, pauseDuringChoices: true }; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
  }
  function applySettings() {
    const rm = settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setReducedMotion(rm);
    if (typeof sprites !== 'undefined') sprites.setReducedMotion(rm);
    if (typeof parallax !== 'undefined') parallax.setReducedMotion(rm);
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
    game = createGame({ erasData, eventsData, copyData: COPY });
    viewMode = 'game';
    $('#ending-screen').hidden = true;
    syncBadges(); // badges persist across lineages (SPEC §4.1)
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

  // §9.1: first-run primer — three lines before Era 1, skippable, remembered in
  // localStorage so it never interrupts a second lineage uninvited.
  function primerSeen() {
    try { return localStorage.getItem(PRIMER_KEY) === '1'; } catch { return false; }
  }
  function markPrimerSeen() {
    try { localStorage.setItem(PRIMER_KEY, '1'); } catch { /* noop */ }
  }
  function showPrimer(onDone) {
    const lines = COPY.first_run_primer || [];
    if (!lines.length) return onDone();
    const splash = $('#primer-screen');
    splash.hidden = false;
    splash.replaceChildren();
    splash.append(el('p', 'primer-kicker', 'BEFORE THE FIRST FIRE'));
    for (const line of lines) splash.append(el('p', 'primer-line', line));
    const go = el('button', 'btn btn-primary', 'Begin the ascent');
    go.addEventListener('click', () => { markPrimerSeen(); splash.hidden = true; onDone(); });
    const skip = el('button', 'btn', 'Skip');
    skip.addEventListener('click', () => { markPrimerSeen(); splash.hidden = true; onDone(); });
    splash.append(go, skip);
    return true;
  }

  function renderAll() {
    renderHeader();
    renderResourceBar();
    renderEventCard();
    if (viewMode === 'chronicle') renderChronicle();
    if (viewMode === 'lineage') renderLineage();
    if (viewMode === 'settings') renderSettings();
    if (viewMode === 'ending') showEnding();
    renderer.setEra(game.state.era);
    renderer.setEntropy(game.state.resources.entropy);
    renderer.setCopies(game.state.copies);
    // §9.3 carrier anim state: event open => idle; otherwise the era is producing.
    sprites.setCarrierState(game.currentEvent() ? 'event' : 'producing');
    sprites.setEntropy(game.state.resources.entropy);
    document.body.dataset.view = viewMode;
  }

  // ---------------------------------------------------------------- idle loop
  // The core advances progress/resources via tick(); pace follows the Speed setting.
  let acc = 0;
  let prevEntropy = game.state.resources.entropy;
  setInterval(() => {
    if (viewMode !== 'game' || game.state.phase === 'ending') return;
    acc += Number(document.documentElement.dataset.speed || 2);
    // §9.1: production pauses while an event card is open (setting, default ON).
    const paused = settings.pauseDuringChoices !== false && !!game.currentEvent();
    while (acc >= 1) { acc -= 1; game.tick(paused, !!mgSession); } // frozen while a minigame is live
    if (game.state.phase === 'ending') { autosave(); showEnding(); return; }
    if (game.state.resources.entropy > prevEntropy + 0.5) audio.play('entropy_tick');
    prevEntropy = game.state.resources.entropy;
    ambientBgm();
    renderHeader();
    renderResourceBar();
    // v5: a live minigame pins the card — re-rendering mid-run would kill its rAF loop
    // (stopStageLoop) and detach its canvas. The session ends before any legit re-render.
    if (!mgSession && !game.currentEvent()) renderEventCard();
  }, 400);

  // §9.4 audio beds: bgm_choice under open event cards, bgm_high_entropy when
  // entropy > 70 (outranks everything — that is the point), otherwise the era
  // theme. Only re-calls AudioManager when the desired bed actually changes.
  function ambientBgm() {
    const ent = game.state.resources.entropy;
    const want = ent > ENTROPY_BGM_THRESHOLD ? 'high_entropy'
      : (game.currentEvent() ? 'choice' : (ERA_IDS[game.state.era - 1] || 'title'));
    if (want !== ambientBgm._cur) { ambientBgm._cur = want; audio.playBgm(want); }
  }

  // intro splash
  function showTitle() {
    const splash = $('#title-screen');
    splash.hidden = false;
    splash.replaceChildren();
    splash.append(el('h1', 'title-main', U.title));
    splash.append(el('p', 'title-tag', U.tagline));
    const btns = el('div', 'title-buttons');
    const hasSave = !!localStorage.getItem(SAVE_KEY);
    const startGame = () => {
      splash.hidden = true;
      audio.playBgm(ERA_IDS[game.state.era - 1] || 'title');
    };
    const neu = el('button', 'btn btn-primary', U.buttons[0]);
    neu.addEventListener('click', () => {
      newLineage();
      // §9.1: first-run primer gates Era 1 exactly once (skippable, remembered).
      if (!primerSeen()) showPrimer(startGame); else startGame();
    });
    const cont = el('button', 'btn', U.buttons[1]);
    cont.disabled = !hasSave;
    cont.addEventListener('click', startGame);
    btns.append(neu, cont);
    splash.append(btns);
  }

  // nav rail
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  }

  showTitle();
  renderAll();
  return { get game() { return game; }, renderer, toast, audio, sprites, parallax, walk,
    // v5 test seam: the minigame session lifecycle (mg-ui tests drive these).
    _mg: { start: startMinigame, key: mgKey, offer: minigameOffer,
      get session() { return mgSession; } } };
}
