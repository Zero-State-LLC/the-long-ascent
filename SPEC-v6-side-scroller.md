# SPEC v6 — THE LONG ASCENT: Reborn as a Side-Scroller

Status: DRAFT → PR before implementation. SUPERSEDES the idle/quiz game loop.
Keeps: the 17-era spine (v3), the arcs (Custodian/Benthic/Rival), the costume-
per-era idea, The Crossing minigame, save concept. Kills: dialog-box events,
idle meters, production ticks, opportunity/crisis overlays.

## 0. The verdict that triggered this (2026-10-30)

The v1–v5 game was an idle quiz with decoration. The game the user wanted:
**"a cool stick figure game where you move around and the stick figure graphics
get cooler and cooler as you progress."** That is the product now.

## 1. Core loop (the whole game)

A **side-scrolling walk through time**. You control one stick figure — the
current lineage — walking rightward through a continuous, evolving world.

- **Movement:** ←/→ walk, ↑/Space jump (a real jump: arc, landing, coyote time),
  ↓ interact when a prompt is shown. Mouse/touch: tap-to-move as fallback.
- **The world is the timeline:** terrain, props, weather and palette shift
  through the 17 eras as you walk. Era boundaries are physical places —
  a cave mouth, a stone gate, a launch gantry — not menus.
- **The figure upgrades as you progress:** same stick-figure language, but the
  silhouette gains era-true gear (hide wrap → bronze sword → scholar's robe →
  business suit → flight suit → exosuit → upload glow), better animation
  frames per era, and richer motion (walk → run → mantle → glide). By the late
  eras the figure visibly glows/dissolves into the Upload.
- **Story happens IN the world:** the 236 events become **world objects** —
  signs, NPCs, ruins, shrines, machines, wrecks — with a short prompt when you
  approach and press ↓. The choice UI is a small in-world menu anchored to the
  object (never a full-screen dialog box). Consequences modify the world
  (a granary you funded stands there for the rest of the run) and the figure's
  gear/meters.
- **Meters ride with you, HUD-minimal:** Sustenance / Knowledge / Population /
  Infrastructure / Legitimacy / Entropy exist but display as a thin top strip
  (the v4 purple-bar language). No production ticks: resources change only
  through choices and minigames. **No idle. The game only moves when you move.**
- **Arcs (Custodian/Benthic/Rival)** appear as recurring NPCs/structures on the
  path — encounter them by walking, not by event rolls.
- **The Crossing stays** as the era-16 set piece (unlock keeps its own screen).

## 2. Structure

- **Continuous world, 17 segments.** Each era = ~3 screens of hand-placed
  terrain + 6–10 interactive objects. Total path ≈ 50 screens; walkable in
  ~20 min straight through, 60–90 min with all encounters.
- **Era transition = set piece:** walk through the boundary structure; the
  camera holds; the palette/terrain crossfades; the figure re-equips with a
  short 2s animation. The old save's `OLD_TO_NEW_ERA` migration still maps.
- **No backtracking** within a run (one-way timeline — thematically correct),
  but era entry points persist: Continue restarts at the last boundary.

## 3. Rendering & art contract (Studio — "make them awesome")

- **Canvas 2D**, camera-anchored side view, 60fps target, `prefers-reduced-motion`
  honored (slower pans, no screen shake).
- **Parallax layers per era (4):** sky, far, near, ground. Seamless tiling.
- **Figure sheets:** 6 frames idle + 6 walk + 4 jump + 2 mantle, 64×128 cells,
  one sheet per era (17). Consistent skeleton across eras; gear drawn on.
- **Prop objects:** one 2-frame sprite per interactive object type (~24 types),
  era-tinted via palette, not per-era redrawing.
- **Palette:** one JSON per era (sky/far/near/ground/ink/accent) — the "weird
  colors" complaint dies here; Studio delivers tested palettes with contrast
  ratios ≥ 4.5:1 for ink-on-ground.
- **Audio:** 3 loop beds (early/agricultural/modern) + 6 SFX. No per-era music.

## 4. Content mapping (Scribe)

- Each v3 event → an **encounter object**: `type, x, era, prompt, choices`
  (choices keep effects verbatim). Scribe rewrites each prompt to ≤ 2 sentences
  of in-world signage/NPC speech and each choice to ≤ 1 line.
- Era intros become **boundary-stone inscriptions** (1 line each).
- Arc beats become scripted NPC encounters at fixed positions.

## 5. Code architecture (Forge)

- New: `src/engine/` — `world.js` (terrain gen from era definitions),
  `camera.js`, `player.js` (physics: accel, friction, jump, coyote),
  `encounters.js` (proximity + interaction state machine), `hud.js`.
- Reuse: palettes, save/migration, `crossing.js`, audio manager.
- Delete: `game.js` idle tick paths, opportunities/crisisPulses overlays,
  event-card UI. Keep the modules' choice/effects data contracts.
- Tests: physics (jump arcs, coyote, landing), encounter triggers, era
  transitions, save migration, crossing unlock. Target ≥ 90 tests.

## 6. Routing (user directive, 2026-10-30)

1. **z0D (orchestrator, GLM)** — this spec + PR + dispatch + verify + deploy.
2. **Scout (Qwen)** — platformer feel research: jump curves, coyote-time
   values, camera lead/lag numbers from well-regarded 2D platformers →
   `research/platformer-feel.md` (numbers Forge plugs into player.js).
3. **Studio (gpt-luna)** — all art per §3, PR `studio-v6`.
4. **Scribe (GLM)** — content mapping per §4, PR `scribe-v6`.
5. **Forge (Qwen)** — §1, §2, §5, PR `forge-v6`.
6. Deploy + cache-bust + live smoke: walk, jump, encounter, era transition.

Old idle game stays deployed at the current URL until v6 ships, then the new
build replaces it (same URL). Old saves migrate per v3 mapping.
