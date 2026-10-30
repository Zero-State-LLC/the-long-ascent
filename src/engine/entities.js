// src/engine/entities.js — SPEC v7 §2: world entities (hazards, pickups, terrain).
// Pure module (no DOM): builds per-era spawn instances from research/spawn-tables-v7.json
// (same fraction layout every run; instance state lives in game.state.v7 so saves
// carry depletion), runs hazard AI (chasers, choke-point guards, zone hazards),
// simulates thrown projectiles (gravity ×0.8, 0.6 s torch fuse), and applies the
// resource/hand consequences. tick.js drives update() once per fixed step.
//
// AI contracts (SPEC §2 verbatim numbers):
//   chasers (boar/wolf/stray_dog): pursue within 3 tiles (96 px) at 0.7× MAX_RUN;
//     contact −2 sustenance; a thrown spear kills (drops meat); a torch scares.
//   bandit/soldier_patrol: block a choke point — pay coin/credit, sneak past
//     crouched within radius, or throw to distract; failure costs legitimacy/infra.
//   zones (smog/radiation_zone/datastorm): −1 of the era's drained resource per
//     second while inside unless holding the counter-item.
//   stone piles: infinite restock (E). One-shot finds (spear/torch) respawn never.

import { TILE, MAX_RUN, GRAVITY, VIEW_H } from './feel.js';
import { THROW_GRAV_MULT } from './actions.js';

export const CHASE_R = 3 * TILE;          // 96 px pursuit radius
export const CHASE_SPEED = 0.7 * MAX_RUN; // 126 px/s
export const CONTACT_COST = 2;            // −2 sustenance on chaser contact
export const CONTACT_COOLDOWN_S = 1.0;    // per-hazard re-hit grace
export const SNEAK_R = 2.5 * TILE;        // must be crouched inside this to slip past
export const PAY_ITEMS = { bandit: 'coin', soldier_patrol: 'credit' };
export const PAY_AMOUNT = 5;
export const DISTRACT_THROW_BONUS_S = 4;  // thrown item buys this many seconds of attention

// zone hazards: pool drained per second + the item that cancels the drain
export const ZONE_DRAIN = {
  smog: { pool: 'sustenance', counter: 'mask' },
  radiation_zone: { pool: 'knowledge', counter: 'rad_chip' },
  datastorm: { pool: 'knowledge', counter: 'faraday_scarf' },
};
export const ZONE_W = 4 * TILE;           // half-width of the zone footprint

// pickup → effect table (SPEC §2)
export const PICKUP_EFFECTS = {
  grain: { pool: 'sustenance', amount: 3 },
  berry: { pool: 'sustenance', amount: 2 },
  meat: { pool: 'sustenance', amount: 4 },
  scroll: { pool: 'knowledge', amount: 3 },
  book: { pool: 'knowledge', amount: 4 },
  chip: { pool: 'knowledge', amount: 3 },
  coin: { countable: 'coin', amount: 2 },
  invoice: { countable: 'coin', amount: 1 },
  credit: { countable: 'credit', amount: 2 },
};
// items that go into the hand instead of a pool/pocket
export const HAND_PICKUPS = new Set(['stone', 'torch', 'spear', 'fruit', 'tool']);

export const CLIMBABLE = new Set(['ledgevine', 'rubble_ramp']);
export const GATHERABLE = new Set(['fruit_tree', 'berry_bush', 'grain_stalk']);
// gather yield per interact vs. knock-down burst via throw
export const GATHER_YIELD = { fruit_tree: 'fruit', berry_bush: 'berry', grain_stalk: 'grain' };

const CEILING = 1000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * @param {object} deps { world, game, actions, surfaceFeet(x)→y, toast(msg),
 *                        spawnTables }  spawnTables = parsed spawn-tables-v7.json
 */
export function createEntitySystem({ world, game, actions, surfaceFeet, toast = () => {}, spawnTables }) {
  const v7 = game.state.v7;

  // ---- instance materialisation ----------------------------------------------
  // Static defs derived from the tables (fraction → px); runtime state keyed by
  // id lives in v7 so depletion/death survives saves. Segment width is derived
  // from consecutive segStart() values, not worldW/17 (world.js pads a tail).
  const defs = [];
  const SEG = world.segStart(2) - world.segStart(1);
  const tableEras = (spawnTables && spawnTables.eras) || {};
  for (let era = 1; era <= 17; era++) {
    const t = tableEras[era];
    if (!t) continue;
    const seg = world.segStart(era);
    const put = (kind, list, suffix) => {
      for (let i = 0; i < (list || []).length; i++) {
        const item = list[i];
        defs.push({
          id: `${kind}-${era}-${i}`,
          kind, // 'hazard' | 'pickup' | 'terrain' | 'stone_pile'
          type: item.type,
          era,
          x: Math.round(seg + item.f * SEG),
          suffix,
        });
      }
    };
    put('hazard', t.hazards);
    put('pickup', t.pickups);
    put('terrain', t.terrain);
    put('stone_pile', t.stones);
  }

  // Runtime record per def (alive/taken/depleted flags ride on v7 lists + maps).
  const rt = new Map();
  for (const d of defs) {
    rt.set(d.id, { taken: false, dead: false, depleted: false, contactCd: 0, distracted: 0, vx: 0 });
  }
  // hydrate from save
  const asSet = (arr) => new Set(Array.isArray(arr) ? arr : []);
  const takenSet = asSet(v7.takenPickups);
  const deadSet = asSet(v7.deadHazards);
  const depletedSet = asSet(v7.depletedBushes);
  for (const id of takenSet) { const r = rt.get(id); if (r) r.taken = true; }
  for (const id of deadSet) { const r = rt.get(id); if (r) r.dead = true; }
  for (const id of depletedSet) { const r = rt.get(id); if (r) r.depleted = true; }
  const persistSets = () => {
    v7.takenPickups = [...takenSet];
    v7.deadHazards = [...deadSet];
    v7.depletedBushes = [...depletedSet];
  };
  // collapse-reason hook (§5): remember the last hazard that touched the player
  const state_lastHit = (type) => { game.state.__lastHazardHit = type; };

  // Choke-point guards stand at 92% of their own segment — just before the era
  // seam, "between you and a choke point" (SPEC §2).
  for (const d of defs) {
    if (d.kind === 'hazard' && (d.type === 'bandit' || d.type === 'soldier_patrol')) {
      d.x = Math.round(world.segStart(d.era) + 0.92 * SEG);
    }
  }

  const byId = new Map(defs.map((d) => [d.id, d]));
  const projectiles = []; // live thrown entities

  // ---- helpers -----------------------------------------------------------------
  const playerCenter = (player) => player.x + player.w / 2;

  function applyPool(pool, amount) {
    const res = game.state.resources;
    if (!(pool in res)) return 0;
    const before = res[pool];
    res[pool] = clamp(before + amount, pool === 'entropy' ? 0 : -CEILING, CEILING);
    return Math.round((res[pool] - before) * 100) / 100;
  }

  // ---- throwing ------------------------------------------------------------------
  /** Launch a projectile spec produced by actions.releaseThrow(). */
  function throwProjectile(spec) {
    projectiles.push({
      id: `proj-${spec.item}-${projectiles.length}-${Math.round(spec.x)}`,
      item: spec.item,
      x: spec.x, y: spec.y,
      vx: spec.vx, vy: spec.vy,
      fuseLeft: spec.fuse ?? null,
      done: false,
    });
  }

  /** What a landing/hit does, per thrown item (SPEC §2 + acceptance list). */
  function resolveImpact(proj, hitHazard) {
    proj.done = true;
    if (hitHazard) {
      const h = hitHazard;
      if (proj.item === 'spear') {
        // spear kills a chaser → drops meat (acceptance: stone does NOT).
        h.rt.dead = true;
        deadSet.add(h.def.id);
        spawnDrop(h.def.x, 'meat');
        toast(`${h.def.type} down. Meat on the ground.`);
      } else if (proj.item === 'torch') {
        // torch scares chasers off (flees; not killed) and distracts guards.
        if (isChaser(h.def.type)) {
          h.rt.distracted = 1e9; // flees for the rest of the run
          h.rt.fleeing = true;
          toast(`${h.def.type} flees the flame.`);
        } else {
          h.rt.distracted = DISTRACT_THROW_BONUS_S;
        }
      } else {
        // stone/fruit/tool: no kill; a stone rings bells / knocks terrain (below),
        // guards get briefly distracted by any thrown object.
        if (!isChaser(h.def.type)) h.rt.distracted = DISTRACT_THROW_BONUS_S;
        else toast(`The ${h.def.type} barely notices the ${proj.item}.`);
      }
    }
    // terrain knock-down: a projectile passing a gatherable knocks loot loose.
    for (const d of defs) {
      if (d.kind !== 'terrain' || !GATHERABLE.has(d.type)) continue;
      const r = rt.get(d.id);
      if (r.depleted) continue;
      if (Math.abs(d.x - proj.x) <= TILE * 1.5) {
        spawnDrop(d.x, GATHER_YIELD[d.type]);
        break;
      }
    }
    persistSets();
  }

  // transient dropped items (meat from a kill etc.) — same contract as pickups
  const drops = [];
  function spawnDrop(x, type) {
    drops.push({ id: `drop-${type}-${drops.length}-${Math.round(x)}`, kind: 'drop', type, x });
  }

  // ---- interaction (E near entity) ------------------------------------------------
  /** Nearest interactable entity within trigger distance, or null. */
  function nearestInteractable(player) {
    const cx = playerCenter(player);
    let best = null, bestD = Infinity;
    const consider = (d, ok) => {
      if (!ok) return;
      const dd = Math.abs(d.x - cx);
      if (dd <= TILE * 1.5 && dd < bestD) { bestD = dd; best = d; }
    };
    for (const d of defs) {
      const r = rt.get(d.id);
      if (d.kind === 'pickup') consider(d, !r.taken);
      else if (d.kind === 'stone_pile') consider(d, true); // infinite
      else if (d.kind === 'terrain' && GATHERABLE.has(d.type)) consider(d, !r.depleted);
      else if (d.kind === 'terrain' && d.type === 'anchor') consider(d, !v7.placedRopes.includes(d.id));
    }
    for (const dr of drops) consider(dr, true);
    return best;
  }

  /** E press against the nearest entity. Returns an event describing what happened. */
  function interact(player) {
    const d = nearestInteractable(player);
    if (!d) return { ok: false };
    if (d.kind === 'pickup' || d.kind === 'drop') return takePickup(d);
    if (d.kind === 'stone_pile') {
      // infinite restock: fills an empty hand with stone only (hand stays one-item).
      if (v7.held !== null) return { ok: false, reason: 'hand busy' };
      actions.pickup('stone');
      return { ok: true, took: 'stone' };
    }
    if (d.kind === 'terrain' && GATHERABLE.has(d.type)) {
      const r = rt.get(d.id);
      // interact gathers slower: one unit per press, depletes the bush for the run
      if (v7.held !== null) return { ok: false, reason: 'hand busy' };
      const direct = PICKUP_EFFECTS[GATHER_YIELD[d.type]];
      if (GATHER_YIELD[d.type] === 'fruit') actions.pickup('fruit');
      else if (direct?.pool) applyPool(direct.pool, direct.amount);
      depletedSet.add(d.id);
      r.depleted = true;
      persistSets();
      return { ok: true, gathered: d.type, depleted: true };
    }
    if (d.kind === 'terrain' && d.type === 'anchor') {
      // rope placement requires a held item? SPEC: throw rope at anchors. We accept
      // any held item as the "rope" proxy; persists in save (SPEC §2).
      if (v7.held === null) return { ok: false, reason: 'need something to tie' };
      v7.placedRopes.push(d.id);
      return { ok: true, roped: d.id };
    }
    return { ok: false };
  }

  function takePickup(d) {
    const r = d.kind === 'drop' ? null : rt.get(d.id);
    if (HAND_PICKUPS.has(d.type)) {
      if (v7.held !== null) return { ok: false, reason: 'hand busy' };
      actions.pickup(d.type);
    } else {
      const eff = PICKUP_EFFECTS[d.type];
      if (!eff) return { ok: false, reason: 'unknown pickup' };
      if (eff.pool) applyPool(eff.pool, eff.amount);
      else actions.addCountable(eff.countable, eff.amount);
    }
    if (d.kind === 'drop') { drops.splice(drops.indexOf(d), 1); }
    else { r.taken = true; takenSet.add(d.id); persistSets(); }
    return { ok: true, took: d.type };
  }

  // ---- per-tick update -----------------------------------------------------------
  /**
   * @param {object} ctx { player, dt, era }
   * @returns {{events:[{type,...}]}} events for boot/toast/HUD layer.
   */
  function update({ player, dt, era }) {
    const events = [];
    const cx = playerCenter(player);
    const py = player.y + player.h; // feet

    // 1) projectiles: gravity ×0.8, fuse countdown, hazard hits, ground hit.
    for (const p of projectiles) {
      if (p.done) continue;
      p.vy += GRAVITY * THROW_GRAV_MULT * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.fuseLeft != null) {
        p.fuseLeft -= dt;
        if (p.fuseLeft <= 0) { resolveImpact(p, null); events.push({ type: 'fuse-out', item: p.item, x: p.x }); continue; }
      }
      // hazard hit test (point vs body box around the hazard standing spot)
      const hit = hazardAt(p.x, p.y);
      if (hit) { resolveImpact(p, hit); events.push({ type: 'throw-hit', item: p.item, hazard: hit.def.type, hazardId: hit.def.id }); continue; }
      // terrain/gone: landed on ground or left the world. Landing samples just
      // below the point so a projectile resting exactly on the surface registers.
      if (world.collider.solidAt(p.x, p.y + 1) || p.x < 0 || p.x > world.worldW) {
        resolveImpact(p, null);
        events.push({ type: 'throw-land', item: p.item, x: Math.round(p.x) });
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].done) projectiles.splice(i, 1);

    // 2) hazards
    for (const d of defs) {
      const r = rt.get(d.id);
      if (r.dead) continue;
      r.contactCd = Math.max(0, r.contactCd - dt);
      r.distracted = Math.max(0, r.distracted - dt);
      const dx = Math.abs(d.x - cx);

      if (isChaser(d.type)) {
        // chase within 3 tiles at 0.7× MAX_RUN; flee overrides
        if (r.fleeing) {
          d.x -= Math.sign(cx - d.x) * CHASE_SPEED * dt; // run away
        } else if (dx <= CHASE_R && r.distracted === 0) {
          d.x += Math.sign(cx - d.x) * CHASE_SPEED * dt;
        }        // contact damage
        if (!r.fleeing && dx <= TILE * 0.75 && Math.abs(py - (surfaceFeet ? surfaceFeet(d.x) : py)) <= TILE * 2 && r.contactCd === 0) {
          applyPool('sustenance', -CONTACT_COST);
          r.contactCd = CONTACT_COOLDOWN_S;
          events.push({ type: 'contact', hazard: d.type, cost: CONTACT_COST });
          state_lastHit(d.type); // collapse-reason hook (§5)
        }
      } else if (d.type === 'bandit' || d.type === 'soldier_patrol') {
        // choke-point guard: pressure when in range and not dealt with.
        if (dx <= TILE * 1.5 && r.distracted === 0) {
          if (actions.crouching) {
            // sneaking past: quiet passage while crouched (SPEC §2)
            events.push({ type: 'sneak-ok', guard: d.type, id: d.id });
          } else if (!r.shakedowned) {
            applyPool('legitimacy', -2);
            applyPool('infrastructure', -2);
            r.shakedowned = true;
            events.push({ type: 'shakedown', guard: d.type, id: d.id });
            state_lastHit(d.type);
          }
        }
      } else if (ZONE_DRAIN[d.type]) {
        // zone hazard: continuous drain unless holding the counter-item
        const inside = Math.abs(d.x - cx) <= ZONE_W;
        if (inside) {
          const counter = ZONE_DRAIN[d.type].counter;
          const protectedBy = v7.inventory[counter] > 0 || v7.held === counter;
          if (!protectedBy) {
            const z = ZONE_DRAIN[d.type];
            applyPool(z.pool, -1 * dt); // 1 per second (fractional accrual)
            events.push({ type: 'zone-drain', zone: d.type, pool: z.pool });
            state_lastHit(d.type);
          }
        }
      }
    }

    // 3) dark cave lighting (SPEC §2: pitch black beyond the mouth without torch)
    const light = caveLight(player, era);
    if (light !== lastLight) { lastLight = light; events.push({ type: 'light-change', level: light }); }

    return { events };
  }
  let lastLight = 1;

  /** Screen light level 0..1 at the player (dark_cave eras 1–3). */
  function caveLight(player, era) {
    const cx = playerCenter(player);
    for (const d of defs) {
      if (d.kind !== 'terrain' || d.type !== 'dark_cave') continue;
      if (Math.abs(d.x - cx) <= TILE * 3) {
        return v7.held === 'torch' ? 1 : 0.12;
      }
    }
    return 1;
  }

  /** Body box lookup for a projectile point. Returns {def, rt} or null. */
  function hazardAt(px, py) {
    for (const d of defs) {
      const r = rt.get(d.id);
      if (r.dead || ZONE_DRAIN[d.type]) continue; // zones are not hittable bodies
      const feet = surfaceFeet ? surfaceFeet(d.x) : py;
      if (Math.abs(d.x - px) <= TILE * 0.75 && py >= feet - TILE * 2 && py <= feet) return { def: d, rt: r };
    }
    return null;
  }

  function isChaser(t) { return t === 'boar' || t === 'wolf' || t === 'stray_dog'; }

  /** Pay a guard off (SPEC §2: pay coin/credit). */
  function payGuard(id) {
    const d = byId.get(id);
    if (!d || (d.type !== 'bandit' && d.type !== 'soldier_patrol')) return { ok: false, reason: 'not a guard' };
    const item = PAY_ITEMS[d.type];
    if (!actions.spendCountable(item, PAY_AMOUNT)) return { ok: false, reason: `need ${PAY_AMOUNT} ${item}` };
    rt.get(id).distracted = 1e9; // satisfied for the run
    return { ok: true, paid: { item, amount: PAY_AMOUNT } };
  }

  return {
    defs, projectiles, drops,
    update, interact, nearestInteractable, throwProjectile, payGuard, caveLight,
    byId,
    entityAt: (id) => byId.get(id),
    runtimeOf: (id) => rt.get(id),
  };
}
