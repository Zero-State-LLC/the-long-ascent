// src/engine/tick.js — SPEC v6 §5: the game only moves when you move.
// The one and only per-frame step for the side-scroller: fixed 60 Hz sim with
// an accumulator, NO production ticks anywhere. Order is deliberate:
//   menu open → world frozen (feel §6), only HUD dwell runs inside encounters
//   era transition active → player input locked, camera + crossfade advance
//   otherwise → player physics → era-crossing detection → encounters → camera
// Returns per-frame events so the host (DOM/boot) decides what to paint/play.

import { TILE } from './feel.js';
import { unlockCrossing, CROSSING_GATE_ERA } from './crossingGate.js';

export const FIXED_DT = 1 / 60;

/**
 * @param {object} deps { world, player, camera, encounters, transition, game,
 *                        onEvent(evt) }
 */
export function createSim({ world, player, camera, encounters, transition, game }) {
  let acc = 0;
  let clock = 0; // seconds of simulated time (walk-cycle phase etc.)
  let shownEra = game.state.era || 1; // physical era underfoot (monotonic)
  const listeners = [];

  /** Feed wall-clock seconds (rAF delta). Runs whole fixed steps only. */
  function frame(dtSeconds, input) {
    acc += Math.min(dtSeconds, 0.25); // tab-switch guard
    const events = [];
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT;
      clock += FIXED_DT;
      step(FIXED_DT, input, events);
    }
    for (const fn of listeners) fn(events);
    return events;
  }

  function step(dt, input, events) {
    const menuOpen = !!encounters.active;
    const transitioning = transition.active;

    // 1) Player physics — locked during menus and the set piece (SPEC §1:
    //    "the game only moves when you move"; reading signage freezes time).
    if (!menuOpen && !transitioning) {
      const wasAirborne = !player.grounded;
      player.update(input || undefined, dt);
      if (player.landed && wasAirborne) {
        camera.shake(Math.min(0.5, Math.abs(player.vy) / 600 + 0.15));
        events.push({ type: 'land' });
      }
      if (player.jumped) events.push({ type: 'jump' });
    }

    // 2) Era boundary detection: crossing a seam line triggers the set piece.
    //    The core game state tracks the era being *experienced* (it flips at
    //    the crossfade midpoint); `shownEra` is what's physically underfoot.
    const eraUnderfoot = world.eraAtX(player.x + player.w / 2);
    if (!transitioning && !menuOpen && eraUnderfoot > shownEra) {
      if (transition.begin(eraUnderfoot)) events.push({ type: 'era-begin', toEra: eraUnderfoot });
      shownEra = eraUnderfoot; // one-way timeline: never re-trigger behind us
    } else if (eraUnderfoot > shownEra) {
      shownEra = eraUnderfoot;
    }

    // 3) Transition machine (camera hold + crossfade + sheet re-equip).
    if (transitioning) {
      const tr = transition.update(dt);
      if (tr.reequip) events.push({ type: 'reequip', era: game.state.era });
      if (game.state.era === CROSSING_GATE_ERA && !game.state.crossingUnlocked) {
        if (unlockCrossing(game.state, (text, kind) => game.chronicle(text, kind))) {
          events.push({ type: 'crossing-unlocked' });
        }
      }
      if (tr.finished) {
        transition.reset();
        events.push({ type: 'era-done', era: game.state.era });
      }
    }

    // 4) Encounters (proximity state machine handles its own menu freeze).
    const enc = encounters.update({ player, input, dt });
    if (enc.opened) events.push({ type: 'menu-open', id: enc.opened.id, object: enc.opened });
    if (enc.closed) events.push({ type: 'menu-close', ...enc.closed });
    if (enc.autoClosed) events.push({ type: 'menu-close', ...enc.autoClosed, auto: true });

    // 5) Camera follows last (reads final player position of the tick).
    camera.follow(player, dt);

    // Persist walk position for Continue-at-last-boundary (SPEC §2).
    game.state.walkX = player.x;
    const boundaryEra = world.eraAtX(player.x + player.w / 2);
    if (boundaryEra > game.state.lastBoundaryEra) game.state.lastBoundaryEra = boundaryEra;
  }

  return {
    frame,
    get clock() { return clock; },
    on(fn) { listeners.push(fn); },
    /** Place the player at an era entry pad (Continue / debug jump). */
    placeAtEra(era) {
      const x = (era - 1) * (world.worldW / 17) + 120;
      const feet = surfaceFeet(world, x);
      player.x = x;
      player.y = feet - player.h;
      player.vx = 0; player.vy = 0;
      game.state.walkX = x;
      camera.x = Math.max(camera.x, x - 300); // keep one-way monotonic
    },
  };
}

/** Ground surface y under world x (feet baseline); falls back to viewport floor. */
export function surfaceFeet(world, x) {
  for (let y = 0; y < world.worldH; y += 8) {
    if (world.collider.solidAt(x + TILE / 2, y)) return y;
  }
  return world.worldH;
}
