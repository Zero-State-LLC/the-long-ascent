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
import { PARALLAX, VIEW_W, VIEW_H, TILE, HINT_R } from '../engine/feel.js';

const SAVE_KEY = 'long-ascent-save-v1'; // same key: old saves migrate in place
const SETTINGS_KEY = 'long-ascent-settings-v1';

export function bootScroller({ erasData, content, canvas, hudRoot, promptRoot, menuRoot, toastRoot }) {
  const settings = loadSettings();
  const reducedMotion = () =>
    settings.reduceMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let toastTimer = null; // TDZ fix: toast() fires during save-load, before its old declaration
  // ---- core state (unchanged contracts; idle paths simply never called) ----
  let game = createGame({ erasData, eventsData: { events: [] }, rng: mulberry32Local(0xacce66) });
  attachV6Fields(game.state);

  // ---- world + entities ------------------------------------------------------
  const world = createWorld({
    erasData,
    encounters: content.encounters || [],
    stones: content.stones || [],
    arcs: content.arcs || [],
  }, 'long-ascent');
  const player = createPlayer({ x: world.spawn.x, y: world.spawn.y, collider: world.collider });
  const camera = createCamera({ x: Math.max(0, world.spawn.x - 300), y: world.spawn.y - VIEW_H + 140, reducedMotion: reducedMotion() });
  const encounters = createEncounterSystem(world.objects, game, world);
  const transition = createTransition(game, camera);
  const sim = createSim({ world, player, camera, encounters, transition, game });

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
  const keys = { left: false, right: false, jumpHeld: false, down: false };
  let downEdgeQueued = false;
  let menuIndex = 0;

  function inputSnapshot() {
    const s = { ...keys, downEdge: downEdgeQueued };
    downEdgeQueued = false;
    return s;
  }

  function onKeyDown(e) {
    const k = e.key;
    if (encounters.active) return menuKey(e);
    if (k === 'ArrowLeft' || k === 'a') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd') keys.right = true;
    else if (k === 'ArrowUp' || k === 'w' || k === ' ') { keys.jumpHeld = true; e.preventDefault?.(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'e' || k === 'Enter') {
      // ↓ interact; Space-as-interact only when grounded (jump wins otherwise, feel §6)
      if (k === ' ' && !player.grounded) return;
      downEdgeQueued = true;
      e.preventDefault?.();
    }
  }
  function onKeyUp(e) {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd') keys.right = false;
    else if (k === 'ArrowUp' || k === 'w' || k === ' ') keys.jumpHeld = false;
    else if (k === 'ArrowDown' || k === 's') keys.down = false;
  }
  function menuKey(e) {
    const obj = encounters.active;
    const n = obj.choices.length;
    if (e.key === 'ArrowDown' || e.key === 's') { menuIndex = (menuIndex + 1) % n; e.preventDefault?.(); }
    else if (e.key === 'ArrowUp' || e.key === 'w') { menuIndex = (menuIndex + n - 1) % n; e.preventDefault?.(); }
    else if (e.key === 'Enter' || e.key === ' ') { pickChoice(obj.choices[menuIndex]?.label); e.preventDefault?.(); }
    else if (e.key === 'Escape') { encounters.closeMenu('user'); }
  }
  function pickChoice(label) {
    if (!label) return;
    const res = encounters.choose(label);
    if (res.ok) {
      autosave();
      toast(describeDeltas(res.deltas));
      renderHud();
    }
  }

  // touch/mouse fallback: tap left/right half walks; double-tap jumps (SPEC §1)
  function pointerFallback(e) {
    if (encounters.active) return;
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect) return;
    const now = Date.now();
    if (now - (pointerFallback._last || 0) < 300) { keys.jumpHeld = true; setTimeout(() => { keys.jumpHeld = false; }, 250); }
    else {
      const dir = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
      keys[dir] = true;
      setTimeout(() => { keys[dir] = false; }, 400);
    }
    pointerFallback._last = now;
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
  loadEraArt(game.state.era);

  // ---- HUD ---------------------------------------------------------------------
  const hud = createHud({ root: hudRoot, el: makeEl });

  function renderHud() {
    const eraDef = game.eraDef();
    hud.render(game.state, {
      eraName: `ERA ${game.state.era} — ${eraDef?.name || ''}`,
      progress01: boundaryProgress(player.x),
      label: '',
    });
    // Keep the header in sync (same element contract as v4/v5).
    const title = document.getElementById('era-title');
    if (title) title.textContent = `ERA ${game.state.era} — ${(eraDef?.name || '').toUpperCase()}`;
    const sub = document.getElementById('era-sub');
    if (sub) sub.textContent = eraDef?.label || '';
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${Math.round(boundaryProgress(player.x) * 100)}%`;
  }

  // ---- render loop ---------------------------------------------------------------
  let raf = 0, lastT = 0, running = true;

  function frame(tms) {
    if (!running) return;
    const dt = lastT ? Math.min(0.25, (tms - lastT) / 1000) : 0;
    lastT = tms;

    const events = sim.frame(dt, inputSnapshot());
    for (const ev of events) handleEvent(ev);

    paint();
    raf = requestAnimationFrame(frame);
  }

  function handleEvent(ev) {
    if (ev.type === 'reequip') loadEraArt(game.state.era);
    if (ev.type === 'era-begin' || ev.type === 'era-done') { autosave(); renderHud(); }
    if (ev.type === 'crossing-unlocked') toast('THE CROSSING is open — the gantry stands lit.');
    if (ev.type === 'menu-open') { menuIndex = 0; }
    if (ev.type === 'menu-close') { /* menu painted from state each frame */ }
  }

  function paint() {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    fitCanvas(canvas, ctx);
    const off = camera.renderOffset();
    const eraShown = world.eraAtX(player.x + player.w / 2);

    // Parallax: four depths, seamless tiling, per-era layers (SPEC §1/§3).
    drawParallax(ctx, off, eraShown);

    ctx.save();
    ctx.translate(-Math.round(off.x), -Math.round(off.y));

    // Objects in view: props anchored to terrain surface; resolved ones keep
    // rendering (funded granaries stand for the run, SPEC §1).
    const viewL = off.x - 96, viewR = off.x + VIEW_W + 96;
    for (const o of world.objects) {
      if (o.x < viewL || o.x > viewR) continue;
      drawObject(ctx, o);
    }

    drawFigure(ctx, currentSheet, player, sim.clock, {});
    ctx.restore();

    // In-world UI overlays (prompt bubble + anchored choice menu).
    paintOverlays();
  }

  function paintOverlays() {
    // Prompt: nearest READY/PROMPT object.
    let best = null, bestD = Infinity;
    for (const o of world.objects) {
      const s = encounters.stateOf(o.id);
      if (s !== 'ready' && s !== 'prompt') continue;
      const d = Math.abs(o.x - (player.x + player.w / 2));
      if (d < bestD) { bestD = d; best = o; }
    }
    if (promptRoot) {
      hud.renderPrompt(promptRoot, {
        visible: !!best && !encounters.active,
        text: best?.inscription ? 'Read the stone' : best?.kind === 'arc' ? 'Speak with ' + best.title : 'Interact',
      });
      positionWorldElement(promptRoot, best);
    }
    if (menuRoot) {
      const act = encounters.active;
      hud.renderMenu(menuRoot, act ? {
        title: act.title || '', prompt: act.prompt || '', choices: act.choices,
        onPick: pickChoice, selectedIndex: menuIndex,
      } : { choices: [] });
      positionWorldElement(menuRoot, act);
    }
  }

  function positionWorldElement(root, obj) {
    if (!root?.style || !obj || !canvas?.getBoundingClientRect) return;
    const rect = canvas.getBoundingClientRect();
    const sx = ((obj.x - camera.x) / VIEW_W) * rect.width;
    const sy = (((surfaceFeetAt(obj.x) || 400) - camera.y) / VIEW_H) * rect.height;
    root.style.position = 'fixed';
    root.style.left = `${rect.left + sx}px`;
    root.style.top = `${rect.top + sy - 8}px`;
    root.style.transform = 'translate(-50%, -100%)';
    root.style.zIndex = '5';
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
    canvas?.addEventListener?.('pointerdown', pointerFallback);
  }
  renderHud();
  if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(frame);

  return {
    game, world, player, camera, encounters, transition, sim, hud,
    get paused() { return !running; },
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; lastT = 0; raf = requestAnimationFrame(frame); } },
    autosave, toast,
    _input: keys,
    _pickChoice: pickChoice,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        canvas?.removeEventListener?.('pointerdown', pointerFallback);
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
