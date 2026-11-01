// src/ui/scroller-boot.js — SPEC v6: canvas-2D boot layer for the side-scroller.
// The only DOM-aware module of the engine surface. Wires world/player/camera/
// encounters/hud into a rAF loop, loads Studio art (sheets, parallax, props),
// and keeps save/load on the existing contracts (localStorage SAVE_KEY, game
// serialize/deserialize + migration). NO idle tick: nothing moves unless the
// player moves or a set piece plays.

import { createGame } from '../core/game.js';
import { loadStateV6, saveStringV6, attachV6Fields, entryXForEra, boundaryProgress } from '../engine/save-v6.js';
import { createWorld, SEG_W } from '../engine/world.js';
import { createPlayer } from '../engine/player.js';
import { createCamera } from '../engine/camera.js';
import { createEncounterSystem } from '../engine/encounters.js';
import { createTransition } from '../engine/transition.js';
import { createSim } from '../engine/tick.js';
import { createHud } from '../engine/hud.js';
import { drawFigure, sheetUrl } from '../engine/figure.js';
import { PARALLAX, VIEW_W, VIEW_H, TILE, HINT_R, FLASH_MS, GLOW_FRAMES, GLOW_ALPHA, DESAT_WASH } from '../engine/feel.js';
import * as gatesMod from '../engine/gates.js';           // v7 §3
import * as choicesMod from '../engine/actionChoices.js'; // v7 §4
import { createJuice, easeOutQuad, gradeEra } from '../engine/juice.js'; // v8 §1/§2
import { createSfx, pickupVoice } from '../engine/sfx.js'; // v8 §2
import { setCollapseDoc } from '../engine/collapse.js';   // v8 §3 copy
import {
  ambientLinesForEra, indexEchoes, echoForEncounter, markEchoSeen, collapseLine,
} from '../engine/copy-v8.js';                            // v8 §3 copy
import { loadV9Copy, dimReasonKeyFor, ambientHookLine } from '../engine/v9copy.js'; // v9 §9 copy
import { createStations } from '../engine/stations.js';   // v9 §1 stations
import { createLayout, createGuardedLoop, drawClampedText, blitEntity, drawStationGlow } from './worldview.js'; // v9 §4
import { createChrome } from './chrome.js';               // v9 §5 chrome bands

const SAVE_KEY = 'long-ascent-save-v1'; // same key: old saves migrate in place
const SETTINGS_KEY = 'long-ascent-settings-v1';

export function bootScroller({ erasData, content, canvas, hudRoot, promptRoot, menuRoot, toastRoot, chromeTop, chromeBottom, options = {} }) {
  const settings = loadSettings();
  const reducedMotion = () =>
    settings.reduceMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let toastTimer = null; // TDZ fix: toast() fires during save-load, before its old declaration
  // ---- core state (unchanged contracts; idle paths simply never called) ----
  let game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32Local(0xacce66) });
  attachV6Fields(game.state);

  // ---- v9 copy + stations ----------------------------------------------------
  const copy = loadV9Copy(options.v9CopyDoc);
  const entityManifest = options.entityManifest || { entities: [] };
  const manifestBySrc = new Map(entityManifest.entities.map((r) => [r.src, r]));

  // ---- world + entities ------------------------------------------------------
  const world = createWorld({
    erasData,
    encounters: content.encounters || [],
    stones: content.stones || [],
    arcs: content.arcs || [],
  }, 'long-ascent');
  // v7 §4: mark encounter choices with their verb requirements (grey-out source).
  if (options.actionChoices) choicesMod.attachActionMarks(world.objects, options.actionChoices);
  const player = createPlayer({ x: world.spawn.x, y: world.spawn.y, collider: world.collider });
  const camera = createCamera({ x: Math.max(0, world.spawn.x - 300), y: world.spawn.y - VIEW_H + 140, reducedMotion: reducedMotion() });
  const encounters = createEncounterSystem(world.objects, game, world);
  const transition = createTransition(game, camera);
  // ---- v7: actions + entities (SPEC v7; optional deps keep v6 boot alive) ------
  let actions = null, entities = null;
  if (options.actionsModule && options.entitySystemFactory) {
    actions = options.actionsModule.createActionSystem({
      game, player,
      onThrow: (spec) => {
        if (!entities) return;
        entities.throwProjectile(spec); // v8 §1: whoosh + arc trail (the trail renders from projFx tracking)
        sfx.play('throw');
      },
    });
  }

  const sim = createSim({ world, player, camera, encounters, transition, game, actions });
  if (options.entitySystemFactory && actions) {
    entities = options.entitySystemFactory({
      world, game, actions, surfaceFeet: (x) => surfaceFeetAt(x),
      toast, spawnTables: options.spawnTables,
    });
    sim.attachEntities(entities);
  }

  // ---- v9: stations + chrome + guarded loop ------------------------------------
  const stations = createStations({ encounters, game, actions, copy, rng: mulberry32Local(0x57a710) });
  stations.attachDimReasonLookup(dimReasonKeyFor);
  const chrome = createChrome({ topRoot: chromeTop, bottomRoot: chromeBottom, hud: null, hudRoot, copy, el: makeEl });
  const layout = createLayout({ canvas });
  layout.layout();

  // ---- v8: juice + audio + copy (SPEC §1–§3; all optional, headless-safe) ------
  const juice = createJuice({ reducedMotion, rng: mulberry32Local(0x5eed17), state: game.state });
  if (entities) entities.attachV8Fx(juice);
  const sfx = createSfx({
    ctx: options.audioContext || null,
    getSettings: () => ({ volume: settings.volume, music: settings.music, sfx: settings.sfx }),
  });
  sfx.setEra(game.state.era);
  if (options.collapseDoc) setCollapseDoc(options.collapseDoc);
  const echoIndex = indexEchoes(options.echoesDoc);
  const whisperEras = new Map(); // era -> ambient line pool (research/ambient-v8.json)
  let pendingEcho = null;        // consequence sign waiting for the next boundary
  let lastComboCount = 0;        // chain-tick detector for menu-click sfx
  // Per-era walk ledger feeding the boundary report card (SPEC §2).
  const eraLedger = { era: game.state.era, dist: 0, timeS: 0, gained: 0, multSum: 0, multN: 0, collapsed: false, route: null };

  // Continue: restart at the last boundary reached (SPEC §2).
  const rawSave = safeGet(SAVE_KEY);
  if (rawSave) {
    try {
      loadStateV6(game, rawSave);
      const ex = entryXForEra(game.state.lastBoundaryEra || game.state.era);
      player.x = Number.isFinite(game.state.walkX) && game.state.walkX >= ex ? game.state.walkX : ex;
      player.y = surfaceFeetAt(player.x + player.w / 2) - player.h;
      camera.x = Math.max(camera.x, player.x - 300);
      toast('Save loaded — the ascent continues.');
    } catch {
      toast('Save unreadable; starting a fresh lineage.');
      game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32Local(0xacce66) });
      attachV6Fields(game.state);
    }
  }

  // ---- input ------------------------------------------------------------------
  // SPEC v9 §3 (normative, one-handed laptop): ←/→ or A/D walk · ↑/W/Space jump
  // (hold=higher) · ↓/S crouch-hold (C toggle REMOVED) · E ask/interact
  // (station-only trigger) · X hold→release throw · Shift sprint · ↑↓⏎ station
  // panel nav/commit · Esc leave station unresolved · Tab era almanac.
  // Mouse fallback REMOVED — keyboard-only mandate.
  const keys = { left: false, right: false, jumpHeld: false, down: false, sprint: false, aimHeld: false };
  let almanacQueued = false;
  let menuIndex = 0;

  function inputSnapshot() {
    const s = { ...keys, era: world.eraAtX(player.x + player.w / 2) };
    return s;
  }

  function onKeyDown(e) {
    const k = e.key;
    // v8 §1: any key skips the era sequence once past the 400 ms beat.
    if (juice.eraSeq.active) { juice.eraSeq.skip(); return; }
    // v9: station panel owns ↑↓⏎/Esc while open.
    if (stations.active) return stationKey(e);
    if (k === 'Shift') keys.sprint = true;
    else if (k === 'x' || k === 'X') keys.aimHeld = true;
    else if (k === 'q' || k === 'Q') keys.dropQueued = true;
    else if (k === 'ArrowLeft' || k === 'a') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd') keys.right = true;
    else if (k === 'ArrowUp' || k === 'w' || k === ' ') { keys.jumpHeld = true; e.preventDefault?.(); }
    else if (k === 'ArrowDown' || k === 's') keys.down = true; // crouch-HOLD (v9: toggle gone)
    else if (k === 'e' || k === 'E') keys.eQueued = true;      // ask/interact (station-only trigger)
    else if (k === 'Tab') { almanacQueued = true; e.preventDefault?.(); }
  }
  function onKeyUp(e) {
    const k = e.key;
    if (k === 'Shift') keys.sprint = false;
    else if (k === 'x' || k === 'X') keys.aimHeld = false; // release = throw (actions.js edge)
    else if (k === 'ArrowLeft' || k === 'a') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd') keys.right = false;
    else if (k === 'ArrowUp' || k === 'w' || k === ' ') keys.jumpHeld = false;
    else if (k === 'ArrowDown' || k === 's') keys.down = false;
  }
  // Station panel nav (SPEC §3): ↑↓ move, ⏎/Enter commit, Esc leave unresolved.
  function stationKey(e) {
    if (e.key === 'ArrowDown' || e.key === 's') { stations.move('down'); e.preventDefault?.(); }
    else if (e.key === 'ArrowUp' || e.key === 'w') { stations.move('up'); e.preventDefault?.(); }
    else if (e.key === 'Enter' || e.key === ' ') { commitStation(); e.preventDefault?.(); }
    else if (e.key === 'Escape') {
      stations.leave();
      sim.setPaused(false);
      sfx.play('menu-click');
      e.preventDefault?.();
    }
  }
  function commitStation() {
    const res = stations.commit();
    if (!res.ok) { juice.menu.denied(); sfx.play('denied-buzz'); return; }
    sfx.play('menu-click');
    sim.setPaused(false); // world re-animates; the beat carries the numbers
    autosave();
    renderHud();
    toast(describeDeltas(res.deltas));
    // v8 §3: remember the consequence echo for the NEXT boundary sign.
    const echo = echoForEncounter(echoIndex, res.id, game.state.v8);
    if (echo) pendingEcho = echo;
  }

  // ---- assets (non-blocking; every consumer degrades gracefully) ---------------
  const images = new Map();
  function loadImage(src) {
    return new Promise((res) => {
      if (typeof Image === 'undefined') return res(null);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
  }
  function cachedImage(src) {
    if (!images.has(src)) images.set(src, loadImage(src));
    return images.get(src);
  }
  let currentSheet = null; // { img } for game.state.era
  function loadEraArt(era) {
    cachedImage(sheetUrl(era)).then((img) => { currentSheet = { img }; });
    const layers = world.layersFor(era);
    for (const u of Object.values(layers)) cachedImage(u);
  }
  for (const o of world.objects) if (o.prop) cachedImage(`assets/prop_${o.prop}.png`);
  // v7: entity art (non-blocking; every draw call above degrades to a chip).
  if (entities) {
    for (const d of entities.defs) {
      if (d.kind === 'hazard') cachedImage(`assets/hazard_${d.type}.png`);
      else if (d.kind === 'pickup') cachedImage(`assets/pickup_${d.type}.png`);
      else if (d.kind === 'terrain') cachedImage(`assets/terr_${d.type}.png`);
      else if (d.kind === 'stone_pile') cachedImage('assets/terr_stone_pile.png');
    }
    for (const it of ['stone', 'torch', 'spear', 'fruit', 'tool']) cachedImage(`assets/held_${it}.png`);
  }
  loadEraArt(game.state.era);

  // ---- HUD ---------------------------------------------------------------------
  const hud = createHud({ root: hudRoot, el: makeEl });

  function renderHud() {
    const eraDef = game.eraDef();
    hud.render(game.state, {
      eraName: `ERA ${game.state.era} — ${eraDef?.name || ''}`,
      progress01: boundaryProgress(player.x),
      label: '',
      hand: actions ? { held: actions.held, staminaFrac: actions.staminaFrac(), aiming: actions.aiming } : null,
      comboMult: juice.combo.mult(), // v8 §2: multiplier chip when a chain is live
      // v8 §1: stamina bar pulses when drained below 20% (hud.js paints the class).
      staminaLow: actions ? actions.staminaFrac() < 0.2 : false,
    });
    // Keep the header in sync (same element contract as v4/v5).
    const title = document.getElementById('era-title');
    if (title) title.textContent = `ERA ${game.state.era} — ${(eraDef?.name || '').toUpperCase()}`;
    const sub = document.getElementById('era-sub');
    if (sub) sub.textContent = eraDef?.label || '';
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${Math.round(boundaryProgress(player.x) * 100)}%`;
  }

  // ---- render loop (D2: guarded, never dies) -----------------------------------
  let raf = 0, lastT = 0, running = true;
  let lightLevel = 1; // v7: dark_cave overlay (entities 'light-change' event)

  function stepFrame(dt) {
    // v8 §1: era transition sequence owns the clock — skippable after 400 ms.
    if (juice.eraSeq.active) {
      juice.eraSeq.update(dt);
      paint();
      return;
    }
    const prevX = player.x;
    const snap = inputSnapshot();
    // v9: stations update BEFORE the sim so the freeze applies same-tick; the
    // panel opens when the body is within 40 px of a READY station.
    const st = stations.update(player, dt);
    if (st.opened) { sim.setPaused(true); juice.menu.opened(); sfx.play('menu-click'); }
    const events = sim.frame(dt, snap);
    // v7 §2: E interacts with entities when no encounter object owns the press.
    if (snap.eQueued && !stations.active && entities) {
      const r = entities.interact(player);
      if (r.ok) { entityInteractFx(r); autosave(); renderHud(); }
      else if (r.reason === 'hand busy') sfx.play('denied-buzz');
      snap.eQueued = false;
    }
    for (const ev of events) handleEvent(ev);
    v8Tick(dt, prevX);
    paint();
    hudTick(dt);
    renderChrome();
  }

  // D2: the guarded loop owns the rAF chain — a throw anywhere in update+paint
  // paints a diagnostic stripe on the last-good framebuffer and keeps going.
  const guarded = createGuardedLoop({
    canvas,
    paint: () => {},
    update: (dt) => stepFrame(dt),
    faultCopy: copy.renderFault(),
    onPause: () => { sim.setPaused(true); toast(copy.renderFault().toast); },
  });
  function frame(tms) { guarded._frameExternal?.(tms); }

  // ---- v8 per-frame feel/copy/depth tick ----------------------------------------
  function v8Tick(dt, prevX) {
    if (dt <= 0) return;
    juice.update(dt);
    if (actions) actions.inputLocked = juice.hit.locked;
    // projectile spin + trail points
    if (entities) {
      for (const p of entities.projectiles) {
        if (p.done) { juice.projFx.release(p.id); continue; }
        juice.projFx.track(p.id, p.x, p.y);
        juice.projFx.advance(p.id, dt);
      }
    }
    // combo chain ledger (menu-click on each new link; avg for the report card)
    if (juice.combo.count > lastComboCount) {
      eraLedger.multSum += juice.combo.mult();
      eraLedger.multN += 1;
      sfx.play('menu-click');
    }
    lastComboCount = juice.combo.count;
    // sprint dust: a puff every ~0.28 s while sprinting on the ground (juice §3)
    if (actions && actions.sprinting && player.grounded) {
      sprintDustAcc += dt;
      if (sprintDustAcc >= 0.28) {
        sprintDustAcc = 0;
        juice.particles.sprintPuff(player.x + player.w / 2, player.y + player.h, Math.sign(player.vx) || 1);
      }
    } else sprintDustAcc = 0;
    // v9 §1.2: track the walked fork route for the era report card.
    const route = world.routeAtX(player.x + player.w / 2);
    if (route) eraLedger.route = route;
    // whisper bubbles above the figure every ~45 s of walking (SPEC §3)
    const moving = Math.abs(player.x - prevX) > 0.01;
    if (moving) {
      eraLedger.dist += Math.abs(player.x - prevX);
      eraLedger.timeS += dt;
      game.state.v8.runTimeS = (game.state.v8.runTimeS || 0) + dt;
      const era = world.eraAtX(player.x + player.w / 2);
      if (!whisperEras.has(era)) whisperEras.set(era, ambientLinesForEra(options.ambientDoc, era));
      juice.whisper.update(dt, true, era, whisperEras.get(era));
    } else {
      juice.whisper.update(dt, false, game.state.era, []);
    }
    // HUD repaint while a multiplier chip or hit blink is live
    if (juice.combo.count > 0 || juice.hit.flashLeftMs > 0) hudComboTick(dt);
  }

  let hudComboAcc = 0, sprintDustAcc = 0;
  function hudComboTick(dt) {
    hudComboAcc += dt;
    if (hudComboAcc >= 0.2) { hudComboAcc = 0; renderHud(); }
  }

  /** Juice + audio reaction to a successful entity interact (pickup/gather). */
  function entityInteractFx(r) {
    const px = player.x + player.w / 2, feet = player.y + player.h;
    if (r.took || r.gathered) {
      sfx.play('pickup', { pool: r.pool });
      if (r.amount > 0) eraLedger.gained += r.amount;
      if (r.amount > 0 || r.took) {
        juice.pickup.pickupTaken({ took: r.took || r.gathered, amount: r.amount || 0, pool: r.pool || null, x: px, y: feet - 32 });
        juice.particles.pickupSparkle(px, feet - 20);
      }
    }
  }

  // ---- v8: era sequence, report cards, whisper bubble ---------------------------

  /** Snapshot the live frame once so the set piece can push in on it. */
  let seqSnapCanvas = null;
  function captureSeqSnapshot() {
    if (!canvas || !canvas.toDataURL && !canvas.getContext) return;
    try {
      const src = canvas;
      if (!seqSnapCanvas) seqSnapCanvas = (typeof document !== 'undefined' ? document.createElement('canvas') : null);
      if (!seqSnapCanvas) return;
      seqSnapCanvas.width = src.width; seqSnapCanvas.height = src.height;
      const sctx = seqSnapCanvas.getContext('2d');
      if (sctx && src.width > 0) sctx.drawImage(src, 0, 0);
    } catch { /* headless or tainted canvas: sequence paints without the snapshot */ }
  }

  /** Kick off the 1.2 s boundary set piece + audio swell + report card. */
  function beginEraSequence(toEra) {
    const fromEra = Math.max(1, toEra - 1);
    captureSeqSnapshot();
    juice.eraSeq.begin(toEra, {
      fromEra,
      name: erasData?.eras?.find((e) => e.num === toEra)?.name || erasData?.eras?.[toEra - 1]?.name || '',
    });
    sfx.play('era-swell');
    sfx.setEra(toEra); // bed crossfade by era group (1-5 / 6-11 / 12-17)
    gradeAndShowEra(fromEra);
    // SPEC §3: consequence echo near the boundary we just crossed (once per run).
    if (pendingEcho) {
      toast(pendingEcho.text);
      markEchoSeen(game.state.v8, pendingEcho.id);
      pendingEcho = null;
    }
  }

  /** SPEC §2: per-era report card at the boundary; persisted in state.v8. */
  function gradeAndShowEra(era) {
    const total = world.objects.filter((o) => o.choices?.length && o.era === era).length;
    const resolvedList = game.state.resolvedEncounters || [];
    const resolved = resolvedList.filter((r) => r.era === era).length;
    const comboAvg = eraLedger.multN > 0 ? eraLedger.multSum / eraLedger.multN : 1;
    const resources = Math.round(eraLedger.gained);
    // v9 §1.2: the route actually walked — the majority route under the body.
    const walkedRoute = eraLedger.route || null;
    const missedIds = world.missedStations(era, walkedRoute);
    const stars = gradeEra({ encountersResolved: resolved, encountersTotal: total, collapsed: eraLedger.collapsed, comboAvg });
    const missedLine = missedIds.length ? copy.missedLine(era, mulberry32Local(era * 7919)) : null;
    const card = { era, stars, timeS: Math.round(eraLedger.timeS), resources, encountersResolved: resolved, encountersTotal: total, comboAvg: Math.round(comboAvg * 100) / 100, missedStations: missedIds, missedLine };
    juice.scores.record(era, card);
    showReportCard(card);
    // reset the ledger for the era we are walking INTO
    eraLedger.era = era + 1; eraLedger.dist = 0; eraLedger.timeS = 0; eraLedger.gained = 0;
    eraLedger.multSum = 0; eraLedger.multN = 0; eraLedger.collapsed = false; eraLedger.route = null;
    autosave();
  }

  let reportEl = null, reportTimer = null;
  function showReportCard(card) {
    if (typeof document === 'undefined' || !toastRoot?.parentElement) return;
    if (!reportEl) {
      reportEl = makeEl('div', 'v8-report');
      reportEl.style.cssText = 'position:fixed;top:14%;left:50%;transform:translateX(-50%);z-index:9;'
        + 'background:rgba(8,10,24,.92);color:#F4E9C8;padding:10px 18px;border:1px solid #f4bd68;'
        + 'font:600 13px ui-monospace,monospace;text-align:center;pointer-events:none';
      toastRoot.parentElement.appendChild(reportEl);
    }
    const starStr = '★'.repeat(card.stars) + '☆'.repeat(3 - card.stars);
    reportEl.textContent = `ERA ${card.era} — ${starStr} · ${card.encountersResolved}/${card.encountersTotal} encounters · +${card.resources} res · ${card.timeS}s · ×${card.comboAvg.toFixed(2)}`;
    reportEl.hidden = false;
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => { if (reportEl) reportEl.hidden = true; }, 2600);
  }

  // Whisper bubble element (SPEC §3): rides above the figure while walking.
  let whisperEl = null;
  function ensureWhisperEl() {
    if (whisperEl || typeof document === 'undefined' || !toastRoot?.parentElement) return whisperEl;
    whisperEl = makeEl('div', 'v8-whisper');
    whisperEl.style.cssText = 'position:fixed;z-index:6;background:rgba(244,233,200,.92);color:#1a1a22;'
      + 'padding:4px 10px;border-radius:10px;font:500 12px ui-monospace,monospace;'
      + 'max-width:260px;text-align:center;pointer-events:none';
    whisperEl.hidden = true;
    toastRoot.parentElement.appendChild(whisperEl);
    return whisperEl;
  }
  function paintWhisperBubble() {
    const el = ensureWhisperEl();
    if (!el || !canvas?.getBoundingClientRect) return;
    if (!juice.whisper.bubbleText) { el.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const sx = ((player.x + player.w / 2 - camera.x) / VIEW_W) * rect.width;
    const sy = ((player.y - 18 - camera.y) / VIEW_H) * rect.height;
    el.textContent = juice.whisper.bubbleText;
    el.hidden = false;
    el.style.left = `${rect.left + sx}px`;
    el.style.top = `${rect.top + sy}px`;
    el.style.transform = 'translate(-50%, -100%)';
  }

  // HUD repaints only on change or on a visible meter beat (stamina drains).
  let hudAcc = 0;
  function hudTick(dt) {
    hudAcc += dt;
    const movingMeter = actions && (actions.sprinting || actions.staminaFrac() < 1);
    if (hudAcc >= 0.25 && movingMeter) { hudAcc = 0; renderHud(); }
  }

  function handleEvent(ev) {
    if (ev.type === 'reequip') loadEraArt(game.state.era);
    if (ev.type === 'era-begin') { beginEraSequence(ev.toEra); onEraBoundary(ev); autosave(); renderHud(); }
    else if (ev.type === 'era-done') { onEraBoundary(ev); autosave(); renderHud(); }
    if (ev.type === 'crossing-unlocked') toast('THE CROSSING is open — the gantry stands lit.');
    if (ev.type === 'menu-open') { menuIndex = 0; juice.menu.opened(); sfx.play('menu-click'); }
    if (ev.type === 'menu-close') { /* menu painted from state each frame */ }
    // ---- v7 events -----------------------------------------------------------
    if (ev.type === 'contact') {
      toast(`The ${ev.hazard} catches you. −${ev.cost} sustenance.`);
      hitFx(ev);
      renderHud();
    }
    if (ev.type === 'shakedown') {
      toast(`${ev.guard} shakes you down for passage.`);
      hitFx(ev);
      renderHud();
    }
    if (ev.type === 'zone-drain') {
      if (juice.combo) juice.combo.damage(); // belt-and-suspenders: damage breaks chain
      renderHud();
    }
    if (ev.type === 'throw-hit') { autosave(); }
    if (ev.type === 'light-change') lightLevel = ev.level;
    if (ev.type === 'collapse') {
      const line = options.collapseDoc
        ? collapseLine(options.collapseDoc, game.state.__lastHazardHit)
        : `You collapse — ${ev.reason}.`;
      eraLedger.collapsed = true;
      juice.shake.kick('collapse');
      sfx.play('collapse');
      fadeOutThen(() => toast(`${line} Woke at the boundary stone. −1 ${ev.lost.pool}.`));
      autosave(); renderHud();
    }
    // ---- v8 events -----------------------------------------------------------
    if (ev.type === 'jump') {
      juice.squash.jump();
      juice.particles.jumpDust(player.x + player.w / 2, player.y + player.h);
      sfx.play('jump');
    }
    if (ev.type === 'land') {
      const sq = juice.squash.land(ev.fallVy ?? 0);
      juice.particles.landDust(player.x + player.w / 2, player.y + player.h, ev.fallVy ?? 0);
      if (sq.t >= 0.6) juice.shake.kick('heavy'); // heavy landing: 1 px / 80 ms
      sfx.play('land');
    }
    if (ev.type === 'throw-land' || ev.type === 'fuse-out') sfx.play('throw');
    if (ev.type === 'hazard-kill') {
      juice.shake.kick('hazard');
      juice.particles.hitSparks(ev.x ?? player.x, ev.y ?? player.y);
      sfx.play('hit');
      if (ev.mastered) toast(`${ev.hazard} mastered. Your throws stun them now.`);
      // v9 §1.3 ambient hook: first hazard death of an era → fixed caption.
      const key = `hazard-death-${world.eraAtX(player.x)}`;
      if (!game.state.v9?.captions?.includes(key)) {
        if (!game.state.v9) game.state.v9 = {};
        if (!Array.isArray(game.state.v9.captions)) game.state.v9.captions = [];
        game.state.v9.captions.push(key);
        const line = ambientHookLine('first-hazard-death', { era: world.eraAtX(player.x), echoesDoc: options.echoesDoc });
        if (line) chrome.caption(line.text);
      }
    }
    if (ev.type === 'era-begin') {
      // v9 §1.3 ambient hook: era entry with <30 sustenance → caption, no pause.
      if (game.state.resources.sustenance < 30) {
        const line = ambientHookLine('low-sustenance-entry', { era: ev.toEra, collapseDoc: options.collapseDoc });
        if (line) chrome.caption(line.text);
      }
    }
    if (ev.type === 'mastery-stun') sfx.play('hit');
  }

  /** Hit feedback: white flash + knockback impulse + 200 ms input lock (SPEC §1). */
  function hitFx(ev) {
    const srcX = Number.isFinite(ev.sourceX) ? ev.sourceX : player.x - 40;
    const imp = juice.hit.hit(srcX);
    player.vx = imp.vx;
    if (player.grounded) player.vy = imp.vy;
    juice.shake.kick('hazard');
    juice.particles.hitSparks(player.x + player.w / 2, player.y + player.h - 12);
    sfx.play('hit');
  }

  // §4 gate sign: reading the seam before entering era N offers advantage/open.
  function onEraBoundary(ev) {
    if (!options.gatesDoc || ev.type !== 'era-begin') return;
    const gate = gatesMod.gateForEra(options.gatesDoc, ev.toEra);
    if (!gate) return;
    const chk = gatesMod.checkGate(gate, game.state, actions);
    if (chk.met && !gatesMod.gateTaken(game.state, ev.toEra)) {
      const adv = gatesMod.takeGate(options.gatesDoc, game.state, actions, ev.toEra);
      if (adv.ok) { toast(`${gate.sign} — ADVANTAGE PATH OPEN: ${adv.advantage}`); sfx.play('gate-open'); }
    } else {
      toast(chk.met ? `${gate.sign}.` : `${gate.sign} — ${chk.reason}. The open path remains.`);
    }
  }

  let fading = 0;
  function fadeOutThen(done) { fading = 1; fadeDone = done; }
  let fadeDone = null;

  function paint() {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    fitCanvas(canvas, ctx);
    // v8 §1: the era sequence owns the whole frame while it plays (its own
    // snapshot + beat overlays; reduced-motion paints the plain live frame).
    if (juice.eraSeq.active) { paintEraSequenceFrame(ctx); return; }

    // v8 shake: juice offset ADDS to the engine camera shake (SPEC §1).
    const off = juice.renderOffset(camera.renderOffset());
    const eraShown = world.eraAtX(player.x + player.w / 2);

    // Parallax: four depths, seamless tiling, per-era layers (SPEC §1/§3).
    drawParallax(ctx, off, eraShown);

    ctx.save();
    ctx.translate(-Math.round(off.x), -Math.round(off.y));

    // Objects in view: props anchored to terrain surface; resolved ones keep
    // rendering (funded granaries stand for the run, SPEC §1).
    const viewL = off.x - 96, viewR = off.x + VIEW_W + 96;
    // v9 §1: station glow markers first (behind terrain, ember pulse).
    paintStationGlow(ctx, off);
    for (const o of world.objects) {
      if (o.x < viewL || o.x > viewR) continue;
      drawObject(ctx, o);
    }

    // v7 §2: entities in view — D1 render contract blits (manifest rows,
    // feet-anchored, aspect-correct destW). Missing art falls back to a
    // labeled silhouette; dev mode throws loudly (guarded loop shows it).
    if (entities) {
      for (const d of entities.defs) {
        if (d.x < viewL || d.x > viewR) continue;
        const r = entities.runtimeOf(d.id);
        if (r.taken || r.dead) continue;
        if (d.kind === 'terrain' && (game.state.v7.depletedBushes || []).includes(d.id)) continue;
        const src = entitySrcFor(d);
        const row = manifestBySrc.get(src) || { src, srcW: 192, srcH: 96, destH: d.kind === 'hazard' ? 48 : 56, label: d.type };
        const img = images.get(src)?.img;
        const feet = surfaceFeetAt(d.x);
        try {
          blitEntity(ctx, row, img, d.x, feet, { dev: false, label: d.type });
        } catch {
          drawLabeledSilhouetteSafe(ctx, d.x, feet, row.destH, d.type);
        }
      }
    }

    drawFigure(ctx, currentSheet, v8Figure(), sim.clock, {});

    // v7 §2: thrown projectiles + transient drops (meat etc.)
    if (entities) {
      for (const dr of entities.drops) {
        const img = images.get(`assets/pickup_${dr.type}.png`);
        const feet = surfaceFeetAt(dr.x);
        if (img?.img) ctx.drawImage(img.img, Math.round(dr.x - 16), Math.round(feet - 32), 32, 32);
        else { ctx.fillStyle = '#f4bd68'; ctx.fillRect(Math.round(dr.x - 5), Math.round(feet - 10), 10, 10); }
      }
      for (const p of entities.projectiles) {
        drawProjectile(ctx, p);
      }
    }

    // v8 §1: particles (dust/spark/sparkle) in world space.
    drawParticles(ctx);
    ctx.restore();

    // ---- screen-space v8 layers -----------------------------------------------
    // Hit white-flash (color-only: stays on under reduced motion, juice rule 6).
    if (juice.hit.flashing) {
      ctx.fillStyle = `rgba(255,255,255,${(0.55 * (juice.hit.flashLeftMs / FLASH_MS)).toFixed(3)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // Floating '+N Resource' texts (world coords → screen via camera offset).
    ctx.textAlign = 'center';
    ctx.font = '700 13px ui-monospace, monospace';
    for (const t of juice.pickup.viewModel()) {
      ctx.globalAlpha = t.alpha;
      ctx.fillStyle = '#F4E9C8';
      ctx.fillText(t.text, t.x - off.x, t.y - off.y);
    }
    ctx.globalAlpha = 1;
    // Pickup flights toward the HUD strip.
    for (const f of juice.pickup.flights) {
      const img = images.get(`assets/pickup_${f.type}.png`);
      const fx = f.x - off.x, fy = f.y - off.y;
      if (img?.img) ctx.drawImage(img.img, Math.round(fx - 10), Math.round(fy - 10), 20, 20);
      else { ctx.fillStyle = '#F4E9C8'; ctx.fillRect(Math.round(fx - 4), Math.round(fy - 4), 8, 8); }
    }

    // v7: dark_cave overlay — pitch black beyond the mouth without a torch.
    if (lightLevel < 1) {
      ctx.fillStyle = `rgba(2, 3, 8, ${(1 - lightLevel).toFixed(2)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // v7 §5: collapse fade-out (immediate respawn underneath; pure feel).
    if (fading > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, fading).toFixed(2)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      fading += dt * 1.6;
      if (fading >= 2.2) { fading = 0; if (fadeDone) { fadeDone(); fadeDone = null; } }
    }

    // In-world UI overlays (v9: diegetic text only, via drawClampedText).
    paintOverlays();
    paintWhisperBubble();
    // v9 §1: desaturation wash while a station panel is up (world keeps painting).
    if (stations.active) {
      ctx.fillStyle = `rgba(120, 120, 130, ${DESAT_WASH.toFixed(3)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /** Entity → manifest src (D1 render contract). */
  function entitySrcFor(d) {
    if (d.kind === 'hazard') return `assets/hazard_${d.type}.png`;
    if (d.kind === 'pickup') return `assets/pickup_${d.type}.png`;
    if (d.kind === 'stone_pile') return 'assets/terr_stone_pile.png';
    return `assets/terr_${d.type}.png`;
  }
  /** Silhouette fallback helper (never an anonymous rect — D1). */
  function drawLabeledSilhouetteSafe(ctx, x, feetY, destH, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(125, 224, 138, 0.3)';
    ctx.beginPath();
    const w = 16, h = Math.max(12, destH || 24);
    ctx.roundRect ? ctx.roundRect(x - w / 2, feetY - h, w, h, 4) : ctx.rect(x - w / 2, feetY - h, w, h);
    ctx.fill();
    ctx.fillStyle = '#DAE8FF';
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(label || 'entity').slice(0, 14), x, feetY - h - 3);
    ctx.restore();
  }

  // ---- v8 paint helpers -------------------------------------------------------

  /** The figure with squash&stretch applied about its feet (SPEC §1). */
  function v8Figure() {
    const sq = juice.squash.current();
    if (sq.sx === 1 && sq.sy === 1) return player;
    const h = player.h * sq.sy, w = player.w * sq.sx;
    return { ...player, w, h, x: player.x + (player.w - w) / 2, y: player.y + (player.h - h) };
  }

  /** Projectile with spin rotation + 8-point ribbon trail (SPEC §1). */
  function drawProjectile(ctx, p) {
    const fx = juice.projFx.fx(p.id);
    for (let i = 0; i < fx.trail.length; i++) {
      const t = fx.trail[i];
      const a = ((i + 1) / fx.trail.length) * 0.35;
      ctx.fillStyle = `rgba(218, 232, 255, ${a.toFixed(3)})`;
      ctx.fillRect(Math.round(t.x - 2), Math.round(t.y - 2), 4, 4);
    }
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.rotate(fx.spin);
    const img = images.get(`assets/held_${p.item}.png`);
    if (img?.img) ctx.drawImage(img.img, -12, -12, 24, 24);
    else { ctx.fillStyle = '#DAE8FF'; ctx.fillRect(-4, -4, 8, 8); }
    ctx.restore();
  }

  /** Juice particles in world space (dust/spark/sparkle; sparkle maps to Studio's particle_star). */
  const PARTICLE_SRC = { sparkle: 'star' }; // kind → studio asset suffix
  function drawParticles(ctx) {
    for (const pt of juice.particles.list()) {
      const img = images.get(`assets/particle_${PARTICLE_SRC[pt.kind] || pt.kind}.png`);
      const s = pt.size;
      ctx.globalAlpha = pt.alpha;
      if (img?.img) ctx.drawImage(img.img, Math.round(pt.x - s / 2), Math.round(pt.y - s / 2), s, s);
      else { ctx.fillStyle = pt.kind === 'spark' ? '#FFE9B0' : '#C9BCA6'; ctx.fillRect(Math.round(pt.x - 2), Math.round(pt.y - 2), 4, 4); }
    }
    ctx.globalAlpha = 1;
  }

  /** Full-frame era transition sequence (SPEC §1 beat table). */
  function paintEraSequenceFrame(ctx) {
    const seq = juice.eraSeq.sample(juice.eraSeq.elapsed);
    const off = camera.renderOffset();
    const fromPal = PALETTES[seq.fromEra] || PALETTES[1];
    const toPal = PALETTES[seq.toEra] || PALETTES[1];
    // Palette crossfade backdrop.
    ctx.fillStyle = mixCss(fromPal.sky, toPal.sky, seq.fade);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Snapshot of the live scene, pushed in 8% around the figure's feet.
    if (seqSnapCanvas && seqSnapCanvas.width > 0) {
      const ax = player.x + player.w / 2 - off.x, ay = player.y + player.h - off.y;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.scale(seq.push, seq.push);
      ctx.translate(-ax, -ay);
      ctx.drawImage(seqSnapCanvas, 0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }
    // Desaturate wash over the snapshot.
    if (seq.desat > 0) { ctx.fillStyle = `rgba(120, 120, 130, ${(seq.desat * 0.35).toFixed(3)})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    // Light column at the boundary structure.
    if (seq.column > 0) {
      const bx = world.boundaryFor(seq.toEra)?.x ?? player.x;
      const sxp = bx - off.x;
      const g = ctx.createLinearGradient(sxp - 60, 0, sxp + 60, 0);
      g.addColorStop(0, 'rgba(255,244,214,0)');
      g.addColorStop(0.5, `rgba(255,244,214,${(0.5 * seq.column).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sxp - 60, 0, 120, VIEW_H);
    }
    // Re-equip white flash.
    if (seq.flash) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    // Title card slide in/out.
    if (seq.cardAlpha > 0) drawTitleCard(ctx, seq);
  }

  function drawTitleCard(ctx, seq) {
    const num = String(seq.toEra).padStart(2, '0');
    const img = images.get(`assets/titlecard_era${num}.png`);
    const slideIn = Math.min(1, seq.cardT / 0.25);
    const slideOut = Math.min(1, Math.max(0, (seq.cardT - 0.75) / 0.25));
    const x = -VIEW_W + easeOutQuad(slideIn) * (VIEW_W * 0.5) - easeOutQuad(slideOut) * (VIEW_W * 0.5);
    ctx.globalAlpha = seq.cardAlpha;
    if (img?.img) {
      const h = Math.round(VIEW_H * 0.5);
      ctx.drawImage(img.img, Math.round(x), Math.round(VIEW_H * 0.25), VIEW_W, h);
    } else {
      ctx.fillStyle = 'rgba(8, 10, 24, 0.85)';
      ctx.fillRect(Math.round(x), Math.round(VIEW_H * 0.35), VIEW_W, 90);
      ctx.fillStyle = '#F4E9C8';
      ctx.font = '700 28px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${seq.toEra} — ${seq.name}`, x + VIEW_W / 2, VIEW_H * 0.35 + 52);
    }
    ctx.globalAlpha = 1;
  }

  function paintOverlays() {
    // v9 D3: no anchored overlays — the deleted anchored-overlay path is
    // not coming back. The station panel lives in the fixed bottom chrome
    // band (renderChrome); diegetic prompts draw in-canvas only via
    // drawClampedText (world rect). Station glow markers are diegetic
    // (paintStationGlow in the objects pass above).
  }

  /** Chrome bands render (D3): top pools/hairline + bottom panel or key strip. */
  function renderChrome() {
    const eraDef = game.eraDef();
    chrome.renderTop({
      era: game.state.era,
      eraName: `ERA ${game.state.era} — ${(eraDef?.name || '').toUpperCase()}`,
      progress01: boundaryProgress(player.x),
      state: game.state,
    });
    chrome.renderBottom(stations.panel());
  }

  /** Station glow blit for READY/PROMPT encounter objects (diegetic marker). */
  function paintStationGlow(ctx, off) {
    if (!images.get('assets/station_glow.png')?.img) return;
    const t = performance.now() / 1000;
    for (const o of world.objects) {
      if (!o.choices?.length || encounters.isResolved(o.id)) continue;
      const s = encounters.stateOf(o.id);
      if (s !== 'ready' && s !== 'prompt') continue;
      const feet = surfaceFeetAt(o.x);
      const sx = o.x - off.x;
      drawStationGlow(ctx, images.get('assets/station_glow.png').img, sx, feet, t, { destH: 64, alpha: GLOW_ALPHA });
    }
  }

  // ---- drawing helpers ------------------------------------------------------------
  function fitCanvas(canvasEl, ctx) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = canvasEl.clientWidth || VIEW_W, h = canvasEl.clientHeight || VIEW_H;
    if (canvasEl.width !== Math.floor(w * dpr) || canvasEl.height !== Math.floor(h * dpr)) {
      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
    }
    ctx.setTransform((canvasEl.width / VIEW_W), 0, 0, (canvasEl.height / VIEW_H), 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function drawParallax(ctx, off, era) {
    const layers = world.layersFor(era);
    // sky base fill first so missing art never renders blank (v4 lesson).
    const pal = PALETTES[era] || PALETTES[1];
    ctx.fillStyle = pal.sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const [depth, factor] of Object.entries(PARALLAX)) {
      const img = images.get(layers[depth]);
      if (img?.img) {
        tileLayer(ctx, img.img, off.x * factor, off.y * factor * 0.4);
      } else if (depth === 'ground') {
        ctx.fillStyle = pal.ground;
        ctx.fillRect(0, VIEW_H * 0.72, VIEW_W, VIEW_H * 0.28);
      }
    }
  }

  function tileLayer(ctx, img, scrollX, scrollY) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    // Tile at native pixel size on the 1280×720 logical canvas: 1024-wide art
    // leaves a 256-px seam that gets covered by drawing the next era's layers
    // during crossfades; snapping to integers keeps 1-px art crisp (no shimmer).
    let x = -(scrollX % iw);
    if (x > 0) x -= iw;
    for (; x < VIEW_W; x += iw) {
      ctx.drawImage(img, Math.round(x), Math.round(-scrollY % VIEW_H), iw, ih);
    }
  }

  function drawObject(ctx, o) {
    const feet = surfaceFeetAt(o.x);
    const img = images.get(`assets/prop_${o.prop}.png`);
    const H = o.kind === 'boundary' ? 160 : o.kind === 'stone' ? 72 : 64;
    const W = o.kind === 'boundary' ? 160 : H * (4 / 3);
    if (img?.img) {
      ctx.drawImage(img.img, Math.round(o.x - W / 2), Math.round(feet - H), W, H);
    } else {
      ctx.fillStyle = '#DAE8FF';
      ctx.fillRect(Math.round(o.x - 4), Math.round(feet - H), 8, H);
    }
    // Stone inscription renders as small ink text above the monolith (SPEC §4).
    if (o.kind === 'stone' && o.inscription) {
      ctx.save();
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.fillStyle = '#DAE8FF';
      ctx.textAlign = 'center';
      wrapText(ctx, o.inscription, o.x, feet - H - 12, 220, 13, 3);
      ctx.restore();
    }
    // Far-hint glow (feel §6: 160 px faint hint, no button text).
    const d = Math.abs(o.x - (player.x + player.w / 2));
    if (d <= HINT_R && o.choices?.length && !encounters.isResolved(o.id)) {
      ctx.save();
      ctx.globalAlpha = 0.15 + 0.2 * (1 - d / HINT_R);
      ctx.fillStyle = '#B79CFF';
      ctx.beginPath();
      ctx.arc(o.x, feet - H - 8, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function surfaceFeetAt(x) {
    for (let y = 0; y < world.worldH; y += 8) {
      if (world.collider.solidAt(x, y)) return y;
    }
    return world.worldH;
  }

  // ---- lifecycle --------------------------------------------------------------------
  function autosave() { try { safeSet(SAVE_KEY, saveStringV6(game)); } catch { /* storage unavailable */ } }
  function toast(msg) {
    if (!toastRoot) return;
    toastRoot.hidden = false;
    toastRoot.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastRoot.hidden = true; }, 2600);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window?.addEventListener?.('resize', () => layout.resize());
  }
  renderHud();
  // D2: the guarded loop owns the rAF chain (never dies on a paint fault).
  if (typeof requestAnimationFrame !== 'undefined') guarded.start();
  const rafProxy = { get current() { return guarded.running ? 1 : 0; } };
  void rafProxy;

  return {
    game, world, player, camera, encounters, transition, sim, hud,
    stations, chrome, layout, guarded,
    get paused() { return !running; },
    pause() { running = false; guarded.stop(); },
    resume() { if (!running) { running = true; guarded.resume(); } },
    autosave, toast,
    _input: keys,
    _commitStation: commitStation,
    destroy() {
      running = false;
      guarded.stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
      }
    },
  };
}

// ---- small utils ---------------------------------------------------------------------

// Era palettes shipped by Studio (assets/palette_eraNN.json) are fetched at boot
// into this table by main.js; defaults keep the renderer alive before/if fetch fails.
export const PALETTES = {
  1: { sky: '#1c2938', far: '#526071', near: '#907958', ground: '#b8aa92', ink: '#101010', accent: '#f4bd68' },
};
export function setPalettes(table) { Object.assign(PALETTES, table || {}); }

// ---- small utils ---------------------------------------------------------------------

function makeEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Mix two #rrggbb colors, t in [0,1]. */
function mixCss(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* noop */ } }

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
}

function describeDeltas(deltas) {
  const parts = Object.entries(deltas || {}).map(([k, v]) => `${v > 0 ? '+' : '−'}${Math.abs(v)} ${k}`);
  return parts.length ? parts.join(', ') : 'Nothing changes. It never does.';
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y - (maxLines - 1 - lines) * lineH);
      lines++; line = w;
      if (lines >= maxLines) return;
    } else line = test;
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y - (maxLines - 1 - lines) * lineH);
}

function mulberry32Local(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
