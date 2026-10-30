# SPEC v4 — Scene Stage Rework: Walkable Figure, Right-Stage Layout, Art Pass

Status: DRAFT → PR for review before implementation. Amends §4.2, §5, §6; adds §12.

## 0. Problem statement (user-reported, 2026-10-29)

1. **Stick figure art is terrible** — costume and scene sheets read as scribbles at
   current sizes; needs a full redraw pass at the same sheet geometry.
2. **Background needs improvement** — the parallax backdrops are flat and repeat.
3. **Scene art sits behind the choices box** — on common viewports the card column
   (560px, scene 480×270 above choices) forces the scene under/behind the choice
   buttons; boxes also drift off-screen instead of holding a standard place.
4. **Scene box can be empty** — e.g. "Debt Is Invented" (scene_id `granary_siege`,
   era 2) shows a blank picture box even though
   `assets/sprites/scene_granary_siege.png` exists. The sheet loads but nothing
   draws: silent failure with no fallback.
5. **The stick character should be playable** — walk the figure with **arrow keys**
   inside the scene; he walks over to a choice and that choice becomes selected;
   Enter (or click) confirms. Keyboard-first, mouse-click still works.

## 1. Layout: two-stage card (§4.2 amendment)

The event card becomes a **stage + ledger** layout on wide screens, stacked on
narrow ones. The scene is no longer squeezed above the choices.

- **≥ 900px viewport:** card grid `1.1fr 0.9fr`, two columns:
  - **LEFT (ledger):** title → body → choices. Choices are the standard place —
    always inside the viewport, `max-height` with internal scroll if > 4 choices.
  - **RIGHT (stage):** the scene canvas, full card height, `min-height 270px`,
    object-fit style letterboxing. **The stage is never overlapped by the choices
    box.** Card max-width rises to 960px, centered with `margin-inline:auto`,
    `max-height: calc(100vh - 96px)`, `overflow:auto` — the card can never push
    boxes off-screen.
- **< 900px:** stack: stage on top (16:9), ledger below. Same behavior as today
  but the stage keeps its own fixed aspect and never hides behind choices.
- `.card-scene` canvas keeps `aria-hidden`; the stage gets a visible 1px frame and
  caption line (era + scene name) so an empty stage is obvious.
- The full-viewport `#scene` parallax canvas stays as the page backdrop.

## 2. Walkable figure (§4.2 new behavior)

The stage is a **playable mini-stage**, not a passive GIF:

- The **lineage figure** (current era costume sheet) stands in the stage by
  default, idle animation at 6 fps, positioned at stage-x 25%.
- **Arrow keys ←/→ (and A/D):** the figure walks across the stage floor line
  (walk cycle frames from the costume sheet, 10 fps). Movement is clamped to the
  stage bounds; he can't leave the picture.
- **Choice markers:** each choice gets a small flag/portal marker placed along the
  floor at evenly spaced x positions (max 4). The figure walks to a marker and
  **pauses on it** — that choice becomes *armed* (highlight ring + the matching
  choice button gets `.armed` styling). Walking away disarms it.
- **Enter/Space (or click the armed button):** confirms the armed choice.
  Clicking any button directly still works at all times (mouse parity).
- **Focus/scroll rule:** arrow keys never scroll the page while the event card is
  open; the card consumes them. When the card closes, keys return to normal
  (The Crossing minigame keeps its own handler — no conflict, different screen).
- **Reduced motion:** `prefers-reduced-motion` disables walk cycles (figure
  teleports to the marker, no walk animation). Keyboard selection still works.
- **No figure in stage = no walk mode:** if the costume sheet for the current era
  is missing, markers are still rendered and keyboard 1–4 selects choices; stage
  shows the fallback art (§3).

Forge owns: stage input controller (`src/ui/stageWalk.js`), choice-marker
positioning, armed-choice state, tests. The controller must be a pure module
(position/state machine) so tests drive it without a DOM.

## 3. Scene render fix + fallback (bug: empty picture box)

Root cause hypothesis for blank stage: `cachedSheet` resolves the image but
`AnimScene.play()` silently no-ops when the sheet's geometry doesn't match the
assumed `160×180 ×8` cells (or draw is off-canvas after the v3 `drawFrame`
cell-width change). **Forge must:**

1. Add a diagnostic: log (console.debug) sheet naturalWidth vs expected cells on
   every scene start; if `totalFrames` computes to 0 or the image fails to
   decode, treat the scene as **unavailable**.
2. **Fallback art:** when a scene sheet is unavailable, draw the era **background
   layer + idle costume figure** into the stage instead of leaving it blank.
   The stage is never empty.
3. Verify `granary_siege` (era 2) specifically renders — add a test that loads
   the sheet and asserts `drawFrame` produces non-blank pixels for at least one
   frame (`getImageData` alpha sum > 0).
4. Audit **all 35 used scene_ids** against the sheet geometry check in the test
   suite; any sheet that fails the blank-pixel check gets listed in the PR body.

## 4. Art pass (Studio)

Keep **all sheet geometry contracts unchanged** (scene sheets 8 × 160×180,
costume sheets 4 × 128×256, backgrounds 2 layers) so Forge's renderer keeps
working. What changes is the drawing quality:

- **Costumes (18):** redraw each era costume with clear silhouettes, 2px limbs,
  era-distinct props and fabric; walk cycle in frames 3–4 must read as actual
  left/right steps (this matters now that the figure walks).
- **Scenes (35 used):** redraw with real depth: foreground/midground/background
  bands, consistent horizon at ~62% height (the floor line the figure walks on),
  era palette from `src/render/palettes.js`. The figure's floor line must be
  unobstructed across at least 70% of the width so walk mode reads.
- **Backgrounds (2 layers per era):** raise contrast between far/near layers,
  add era-appropriate parallax details (structures, weather, terrain), keep
  seamless horizontal tiling.
- Style stays the stick-figure language (SPEC §8 naming rules apply to any
  in-art text: none).

Studio PR delivers: overwriting `assets/sprites/` PNGs + a
`research/visual-assets-v4.md` manifest listing every file changed and any
sheet whose frame count changed (should be none).

## 5. Routing (per multi-agent-pipeline)

1. **This spec PR** merges first (z0D).
2. **Studio** — art pass (§4). Merge before Forge (Forge's blank-stage test uses
   the new sheets' quality bar).
3. **Forge** — §1 layout, §2 walkable figure + controller/tests, §3 render fix.
   Merge, then z0D deploys with cache-bust and browser-smokes:
   granary scene visible, arrow-key walk arms a choice, Enter confirms, card
   never overflows viewport at 1280×800 and 1440×900.
4. Scribe: no copy changes needed this round.

## 6. Acceptance

- [ ] Card at 1280×800: stage right, choices left, nothing off-screen; at 800px
      width: stacked, stage above choices.
- [ ] Granary "Debt Is Invented" shows a rendered stage (sheet or fallback).
- [ ] Arrow keys walk the figure; reaching a marker arms its choice; Enter
      confirms; clicks still work.
- [ ] All 35 scene sheets pass the non-blank pixel test.
- [ ] Full test suite green; no regression in save migration or Crossing.
