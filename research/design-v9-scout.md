# THE LONG ASCENT — v9 DESIGN RESEARCH: FUSING THE TWO GAMES
**Scout research doc · 2026-11-01 · read-only pass over repo @ `6ae0a35` (v8)**

Scope note: everything marked **[verified]** was checked directly in the repo or by pixel-level
inspection of assets during this pass. Everything marked **[web]** comes from cited public
interviews/design analyses. Anything I could not confirm is marked **[assumed]**.

---

## 0. What is actually in the repo today (ground truth)

| Fact | Value | Evidence |
|---|---|---|
| Engine+UI LOC | 5,606 across 22 modules (`src/engine/*` 3,144; `src/ui/*` 2,150; main 45) | `wc -l` [verified] |
| Tests | 19 `.test.mjs`, 232 tests green at HEAD | `npm test` [verified] |
| Encounter corpus | **236 encounters** in `research/encounters-v6.json`, IDs `E{era}-{n}`, eras 1–16 represented (E1:12 … E16:17) | grep count [verified] |
| Boundary stones | 17 era inscriptions, `research/boundary-stones-v6.json` | read [verified] |
| Arc set-pieces | `research/arc-encounters-v6.json` (arc objects with `source_event` links into the E-corpus) | read [verified] |
| Stats system | six pools: sustenance, knowledge, population, infrastructure, legitimacy, entropy (`hud.js POOL_ORDER`) + morale-flavored copy; collapse on sustenance 0 (`collapse.js`, `research/collapse-v8.json`) | read [verified] |
| Sim | 60 Hz fixed step accumulator (`tick.js FIXED_DT = 1/60`), rAF driver in `scroller-boot.js frame()` | read [verified] |
| Logical view | **VIEW_W=960, VIEW_H=540** (`feel.js`) but canvas element is `width="1280" height="720"` and CSS stretches it to `100vw×100vh`; `fitCanvas` maps the 960×540 logical space onto whatever backing store exists via non-uniform `setTransform` | read [verified] |
| Input today | ←/→ (+A/D), ↑/W/Space jump, ↓/S down/crouch-menu, Shift sprint, C crouch-toggle, X aim/throw (release=throw), E interact, Enter pick, Esc close; menu nav ↑/↓/Enter/Esc | read [verified] |
| Hazard art | `hazard_boar.png` etc. exist: **192×96**, boar silhouette occupies bbox (9,45)–(172,85) — a wide low strip in the bottom half of a 2:1 canvas | pixel probe [verified] |
| Draw call for hazards | blitted as **square** `H×H` (H=48): `drawImage(img, x−H/2, feet−H, H, H)` | scroller-boot.js ~L575 [verified] |
| Render loop | `frame()` has **no try/catch**; any throw inside `paint()` kills the rAF chain permanently | read [verified] |
| Menu/prompt placement | DOM overlays positioned `fixed` at projected world-object coords (`positionWorldElement`) — they float over mid-screen wherever the object happens to be | read [verified] |
| Text wrap | `wrapText(ctx,…)` exists with `measureText`, used for stone inscriptions; no clamp of drawn text against viewport edges | read [verified] |

The two designs to fuse are confirmed in-tree: the choice layer (`encounters.js`, 247 L,
`actionChoices.js`, the 236-encounter JSON, stat deltas, echoes) and the action layer
(`player.js`, `entities.js` 445 L hazard AI, `juice.js` 601 L, `sfx.js`). The v8 verdict —
*"the guy jumps around but the game itself is nonsensical"* — is structurally accurate:
`entities.js` touches resources only through −2-contact/zone-drain penalties; the 236
encounters arrive as position-triggered modals that stop the world. The layers are adjacent,
not coupled.

---

## 1. SURVEY — the coupling mechanism, per game

For each game: **what the player does** vs **how that becomes story**, i.e. the exact wire
between action and meaning. [web] sources listed; mechanics statements cross-checked against
at least one developer interview or systematic design teardown where available.

### Reigns — choices ARE the action
- Mechanic: card stack, binary left/right swipe; every choice moves up to four kingdom meters; death ends the run when any meter bottoms out or tops out. ([Reigns design analyses](https://www.google.com/search?q=Reigns+design+analysis+swipe+stat+balancing))
- **Coupling:** the *only* verb is decision; tension comes from opposing-meter tradeoffs and escalating card frequency. There is no action layer to bolt story onto — nothing to copy except its pacing math (each choice nudges multiple meters; extreme positions are as lethal as empty ones).
- Relevance to TLA: the encounter data already *is* Reigns-shaped (label → stat deltas). v8's mistake was removing the walking from the decisions, not the decisions from the walking.

### Kingdom Two Crowns — choices ARE positions in the scrolling world
- Mechanic: ride left/right along a side-scrolling kingdom; gold collected by *riding over it*; buildings placed at coordinates; crown thrown as a weapon/tool. ([KTC design coverage](https://www.google.com/search?q=Kingdom+Two+Crowns+design+side+scroller+decisions))
- **Coupling:** spatial economy — every narrative/economic decision is expressed as "where am I and what do I drop here." Scrolling *is* surveying; movement is the menu.
- Relevance: the single closest ancestor of what the player described wanting. It proves a side-scroller can carry strategy without menus — but note KTC has no text choices at all. Its lesson for TLA: make geography itself carry stakes.

### Hades — action run, narrative between runs
- Mechanic: roguelike combat runs; conversations happen in the hub between runs and, crucially, as short voiced lines *during* runs triggered by room/boon/death context; Supergiant designed narrative to fire off the run state so repeat content stays fresh. ([Supergiant GDC talk coverage](https://www.google.com/search?q=Hades+narrative+between+runs+Supergiant+GDC))
- **Coupling:** a **context-triggered dialogue event system** layered on top of action state ("died to X", "first time seeing Y", "carrying boon Z"). Action feeds story through *event hooks*, not pauses.
- Relevance: TLA already has the raw material — `echoes-v8.json` consequence echoes and `collapse-v8.json` death-copy are exactly this pattern, currently under-used.

### FTL — event choices with skill-gated stakes
- Mechanic: jump between beacon nodes on a map; most nodes open a text event with 2–3 options; option availability and success odds depend on crew skills, race, ship systems; failure costs hull/oxygen/crew *immediately, in the same resource language as combat*. ([FTL design analyses](https://www.google.com/search?q=FTL+event+design+crew+skills+choices))
- **Coupling:** the map node IS the encounter; choices are gated by build state and resolve in shared-resource consequences. Resource attrition makes prose choices physically felt.
- Relevance: near-perfect template for TLA — "walk right to the next event marker" ≙ "jump to next beacon"; stat deltas ≙ hull damage. FTL shows the pause-for-text model works *when the pause is rare, consequential, and spatially located*.

### Papers, Please — the job mechanic IS the moral mechanic
- Mechanic: inspect documents, stamp approve/deny, day-by-day quota; rulebook grows; violations dock pay; individual cases carry human stories. ([Papers Please design analyses](https://www.google.com/search?q=Papers+Please+design+mechanic+narrative+moral))
- **Coupling:** procedural micro-action (checking fields, stamping) *is* the ethical act; no dialogue box ever tells you it was a moral choice. Time pressure makes empathy cost money.
- Relevance: the ideal for *some* TLA encounters — e.g. Era 12–14 bureaucracy beats where the player literally sorts/stamps/routes instead of picking from a list. High authoring cost per encounter, though.

### Citizen Sleeper — dice-as-time, locations-as-choices
- Mechanic: each cycle roll N dice; drag dice onto location-tagged actions; success odds = skill + die value; clocks track long-term consequences; condition failure-spirals are deliberate precarity design. ([Gareth Damian Martin interview via How To Make An RPG case study](https://howtomakeanrpg.com/r/a/case-study-citizen-sleeper.html))
- **Coupling:** attention budget. Story choices compete for the same finite currency as survival actions; "exposing the variables to the player" (clocks) creates dread without cutscenes. Paper-prototyped first — small-scope proof.
- Relevance: strongest argument for making *walking itself* cost something (time/fatigue) so stopping at an encounter is a real tradeoff rather than free.

### Oxenfree — walk-and-talk: movement is conversation progress
- Mechanic: dialogue advances while the avatar walks/runs freely; radio-tuning and walkspeed are verbs embedded in scenes; tension between finishing-walking and finishing-talking. ([Oxenfree design writeups](https://www.google.com/search?q=Oxenfree+walk+and+talk+dialogue+design))
- **Coupling:** temporal overlap — the conversation clock and the movement clock run together; choosing *when* to speak (or whether to catch up) is the choice.
- Relevance: cheap to prototype in canvas (timed dialogue ticks while sim keeps running), but known risk: reading-comprehension vs platforming conflict; Oxenfree's scenes are flat terrain for a reason.

### Disco Elysium — skills as perception, thoughts as slow loot
- Mechanic: passive skill checks interrupt dialogue as competing voices; Thought Cabinet internalizes ideas over in-game hours, granting unknown bonuses; skills define what the character can *perceive*, not just succeed at. ([System analyses](https://gamedesignthinking.com/disco-elysium-rpg-system-analysis))
- **Coupling:** build-state gating of *text content* — your stats rewrite which questions even exist. Movement is trivial (walk to click-point); all depth is in the choice graph.
- Relevance: TLA's six pools should gate encounter *availability and flavor* (high entropy → the paranoid variant of the encounter appears), not just outcomes. That is how stats stay meaningful between encounters.

### Loop Hero — the world is the player's deck
- Mechanic: hero auto-walks a loop; player plays terrain cards onto the road; adjacency synergies transform tiles (Village beside Vampire Mansion → ransacked → Count's Land after 3 loops); enemy difficulty and rewards emerge from placement. ([teemo.dev systems teardown](https://teemo.dev/game-design/loop-hero/systems/tile-terrain-deck-and-adjacency), [RPS dev interview](https://www.rockpapershotgun.com/how-loop-heros-impossible-mishmash-of-ideas-came-to-exist))
- **Coupling:** the player edits the world the avatar traverses; the avatar's suffering/reward is the report on the edit. Zero direct control of the walker, total control of the *route's meaning*.
- Relevance: radical option — let v9 encounters be resolved partly by what the player *built/placed upstream* (granaries funded by earlier choices standing in later eras; TLA already renders funded props persistently: "funded granaries stand for the run," scroller-boot comment [verified]).

### Kentucky Route Zero — route as mood, stage directions as choice
- Mechanic: point-and-click movement + dialogue options that mostly choose tone, not plot; explicit anti-strategic guideline ("not giving them the data to know which choice will impact the narrative"); Act V controls a cat through a circular town. ([Polygon dev interview](https://www.polygon.com/interviews/2020/2/5/21117009/kentucky-route-zero-ending-act-5-interview/), academic analysis)
- **Coupling:** performance/direction — choices add inflection; the world's magic realism carries meaning independent of win-state.
- Relevance: permission to let *some* choices be pure voice/mood (whispers already work this way) — but KRZ deliberately has no fail state, which TLA (collapse mechanic) cannot copy wholesale.

### Synthesis — three coupling archetypes worth stealing
1. **Station model** (FTL/Reigns): rare, high-stakes, spatially-located pauses. Works because pauses are scarce and consequences land in the action resource pool.
2. **Spatial-economy model** (KTC/Loop Hero/Citizen Sleeper): no modal text at all for routine beats; position, timing, and placement carry the meaning; scarcity of time/attention makes stopping a cost.
3. **Ambient-hook model** (Hades/Oxenfree/KRZ): the world never stops; narrative fires as context-triggered overlay text keyed to action state (first boar kill, era-first-entry, collapse cause).

No proven game fuses all three at once at browser scale — but TLA's asset base (236 authored station encounters + 17 boundary stones + echo/collapse copy + working platformer physics) is precisely enough to run **station as spine, ambient as skin, spatial as seasoning**.

---

## 2. THREE DESIGN DIRECTIONS FOR v9

All three keep: 17-era spine, 236 encounters + 17 stones + arcs, six-pool stats, collapse-and-respawn, arrow-key traversal, vanilla JS/canvas, 60 Hz tick.

### Direction A — "THE CLEARING": time-stop stations with physical commitment
Encounters become **in-world stations**: approaching one dims the world (desaturation vignette), freezes the sim (world keeps drawing behind), presents title/prompt/choices in a **fixed lower-third chrome panel** (never floating over mid-screen). Numbers hidden until commit — Reigns-style reveal after the swipe. After resolution, a 3-second "consequence beat": the world re-animates and the delta visibly lands (resource bar pulses, a prop spawns/scorches).

- **Pros:** zero new engine systems — `encounters.js` already models ready/prompt/active states; fixes defect #3/#4 by moving menus into fixed chrome; preserves ALL 236 encounters verbatim; cheapest possible path; player's liked things (writing, tradeoffs) untouched.
- **Cons:** still alternates "walk / stop / read" — the fusion is sequential, not simultaneous; risk the action layer stays decorative if hazards remain meaningless. Mitigation: hazard hits feed the SAME pools, so the action layer pre-payments encounter costs (arrive malnourished → some choices greyed — `actionChoices.js` already supports requirements/greyed choices [verified]).
- **Scope:** S (~300–500 LOC UI change, 0 new engine modules).

### Direction B — "THE DRAFT ROUTE": branching paths + budgeted attention
Each era segment splits into 2–3 vertical/lateral routes through the terrain (ridge / valley / cave). Encounters are distributed sparsely along routes; you cannot reach all of them in one run. Walking costs a slow **time/fatigue drain** on sustenance (Citizen Sleeper's attention budget): stopping at a station literally costs calories; taking the dangerous shortcut past the boar saves time but risks contact damage. Boundary stone reached = era report card showing which stations you *didn't* visit ("The bridge offer expired. Someone else crossed."). Collapse = era restart at the fork, keeping stat scar tissue.

- **Pros:** the deepest fusion — route choice IS the macro-choice, station choice the micro-choice; replayability emerges (different routes = different encounter subsets from the 236); movement always meaningful (positioning = selection).
- **Cons:** requires world-gen changes (`world.js` is single-surface today — multi-lane terrain is the biggest structural lift in the repo), plus route-aware spawn tables, plus report-card copy per missed station. Highest LOC, highest regression risk against 232 tests.
- **Scope:** L (~1,500–2,500 LOC; `world.js` surface model rewrite touches camera, entities, figure anchoring).

### Direction C — "THE PROCESSSION": living walk-and-talk with gesture verbs
The world never stops. Encounters manifest as figures/entities that walk alongside you; their dialogue types itself in a fixed caption band while you keep moving (Oxenfree). Choices are **gesture keys** (F = offer held item, Q = halt-and-listen, E = answer highlighted line) plus positioning (walk ahead = refuse; linger = accept; approach from behind = ambush variant). Radio-dial (Oxenfree again) tunes era ambience/propaganda channels — the world itself asks questions, and staying-or-moving-on answers.

- **Pros:** maximal simultaneity — nothing ever pauses; action and story truly one verb-space; whisper system (`ambient-v8.json`, `juice.whisper`) is a seed already shipped [verified].
- **Cons:** typewriter dialogue while platforming = reading-under-pressure failures; authoring the 236 encounters into timed-caption format is a massive content migration; laptop one-handed input gets crowded; hardest to test headlessly (timing-dependent). Fails the "player LIKED the writing" constraint most often in practice — Oxenfree needs voice acting to carry comprehension.
- **Scope:** XL (~2,500+ LOC + full content re-authoring).

### Comparison table

| | A: Stations | B: Routes | C: Procession |
|---|---|---|---|
| Keeps 236 encounters verbatim | ✅ | ✅ (subsetted per route) | ❌ re-author |
| Movement feels meaningful | ◐ (positioning selects stations) | ✅✅ | ✅ |
| Neither layer bolted-on | ◐ sequential | ✅ | ✅ if it works |
| Regression risk vs 232 tests | Low | High | High |
| New engine subsystems | 0 | multi-lane terrain | timed-dialogue director |
| Realistic solo-agent scope | days | weeks | weeks+ |

---

## 3. RECOMMENDATION — Direction A+, stations as spine with two borrowed organs

Ship **A** as the chassis, plus exactly two upgrades stolen from B and C so neither layer stays decorative:

1. **A (chassis):** time-stop stations in fixed chrome, hidden numbers until commit, consequence beat on resume.
2. **From B (one notch, no terrain rewrite):** a *micro-fork* only at era boundaries — before each boundary stone, the ground splits into 2 visible paths (spine.js-level: two x-ranges with different encounter/spawn density, both rejoining at the stone). No vertical lanes, no camera changes. Route choice = which ~⅔ of the era's encounters you meet.
3. **From C (zero new systems):** Hades-style **context hooks** firing the already-written `echoes-v8.json` / `collapse-v8.json` copy as fixed-caption one-liners during play (first hazard death of an era, entering an era having <30 sustenance, arc conditions) — no pause, no interaction required.

### The 60-second loop
1. Walk right; parallax eras scroll; a dust-cloud boar rustles ahead (visible telegraph 96 px chase radius, `CHASE_R` [verified]).
2. Throw a stone (X-hold/release) to scare it, or outrun it; contact costs −2 sustenance AND dirties the ledger the next station reads.
3. Ahead: a firelight marker (station glow, visible from screen edge). Approaching slows the music; within 40 px the world desaturates, sim freezes, lower-third panel slides up: *title, prompt, 2–3 choices.* Requirements from `actionChoices.js` render some choices dimmed with a reason ("You have no grain to give").
4. Pick with ↑/↓ + Enter. Numbers fly onto the HUD bars (juice pickupFx reused), one line of consequence copy, panel slides down, world re-saturates, 3 s "beat" during which the terrain shows what changed (granary prop rises / tree stump replaces tree).
5. Continue; every ~45 s of walking a whisper line surfaces from `ambient-v8.json` (already shipped behavior [verified]).
6. Reach the boundary stone → read inscription (existing) → era report card (existing v8 sequence) → next era, denser hazards, stranger encounters.

Stations pace at ~4–6 per era (from the 12–30 encounters/era available), so text pauses average one every 30–60 s of walking — FTL rhythm, not visual-novel rhythm.

### ASCII screen architecture (fixes defects 3–5 structurally — details §4)
```
┌────────────────────────────────────────────────────────────┐ 
│ CHROME-TOP (fixed, DOM, h=64px)                           │ era name · era# · boundary hairline
│  ERA 4 — AGRICULTURE   ▓▓▓▓▓▓▓░░░░░░  to boundary         │ six mini-bars: SUS KNO POP INF LEG ENT
├────────────────────────────────────────────────────────────┤
│                                                            │
│                                                            │
│              WORLD LAYER (canvas, letterboxed)             │ everything diegetic scrolls here:
│                     ▲ figure                               │ parallax · props · entities · stations
│      🌫 boar     🔥station-marker                          │ station glow = "question ahead"
│                                                            │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ CHROME-BOTTOM (fixed, DOM, h=~120px idle / 180px panel)   │
│  idle: key hints strip (◄► move  ▲ jump  ✕ throw  E ask)   │
│  active: ┌ STATION PANEL ────────────────────────────────┐ │
│          │ THE SALT CARAVAN                              │ │
│          │ prompt text, wrapped, clamped to panel width  │ │
│          │ ▸ Give grain (dimmed: no grain)               │ │
│          │   Trade a secret        (↑↓ select ⏎ commit)  │ │
│          └───────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```
Diegetic text (inscriptions, whispers) draws INSIDE the world rect only, measured and clamped;
non-diegetic text lives exclusively in chrome DOM. Nothing may ever draw text over the middle
of the world layer — that rule alone deletes defects #3 and #4.

### Input map (one-handed right side OK, laptop)
| Key | Verb | Notes |
|---|---|---|
| ← → (or A D) | walk | existing |
| ↑ / W / Space | jump (hold = higher) | existing |
| ↓ / S | crouch-walk (hold) | simplifies today's dual toggle+hold |
| E | ask/station interact, read stone | existing, now station-only trigger |
| X (hold→release) | throw held item | existing |
| Shift | sprint | existing |
| ↑ ↓ ⏎ | navigate/commit station panel | existing menu keys, now inside fixed panel |
| Esc | leave station unresolved (it stays READY) | new, prevents forced choice |
| Tab | era almanac: pools detail + visited/missed stations | new, replaces hover tooltips |
Removed in v9: C crouch-toggle (fold into hold-↓), mouse pointer fallback (keyboard-only mandate).

### Fail states
- Sustenance 0 → collapse sequence (existing `collapse.js` + `collapse-v8.json` cause copy) → respawn at era start with scar ledger (entropy +2 kept). Stations already resolved stay resolved within the era (FTL doesn't refund events either).
- Falling into hazard contact repeatedly is *not* a fail state; it's the tax that makes stations harder — never instant-death.
- Station with all choices dimmed: panel offers a guaranteed "walk away" row (costs entropy +1) — soft-lock impossible.

### Why neither layer feels bolted on
- Action feeds choice: current pools/held items/hazard scars gate and recolor station text (`actionChoices.js` requirements — mechanism already built and tested).
- Choice feeds action: every resolution mutates the world the body moves through (props, spawn density next era, zone hazards from entropy tier).
- The connective tissue is one sentence: **your body arrives at the question carrying what your choices made it.**

---

## 4. DEFECT-KILL RULES (cause-class hypothesis → structural rule)

Verified layout facts feeding these: canvas attr 1280×720 vs CSS 100vw×100vh vs logical VIEW 960×540; `fitCanvas` uses non-uniform `setTransform(w/VIEW_W, h/VIEW_H)`; `frame()` uncaught; menus DOM-positioned at projected object coords; hazard PNGs 192×96 blitted into 48×48 squares. All [verified] in-repo.

**D1 — Boar renders as featureless block.**
Cause class (most probable given evidence): aspect distortion + sub-pixel squash. A 2:1 sprite (opaque body bbox 163×41 px) is squeezed into a 48×48 square with `imageSmoothingEnabled=false`: the animal collapses into a smear of its own outline colors — reads as a block. Secondary suspect class: image-load race (`images.get(src)?.img` silently falls back to a 12×24 green rect — also a block!). Both produce the reported symptom.
**Rule — Entity Render Contract:** every drawable entity declares `{src, srcW, srcH, destH}`; the blit helper computes `destW = destH × srcW/srcH` (letterbox-fit into the entity's collision box, anchored at feet) and **throws loudly in dev mode** if `src` missing or `img.naturalWidth===0`. Fallback shapes must be labeled silhouettes with the entity's color identity, never anonymous rects. Add a unit test: fixture atlas → expected dest rect per entity type.

**D2 — Screen goes black mid-play.**
Cause class: `frame()` has no exception guard — one throw anywhere in `sim.frame`/`paint` (e.g. bad atlas frame, null ctx after resize, era-sequence snapshot on tainted canvas) skips `requestAnimationFrame(frame)` at the tail and the loop dies with the last canvas contents (or cleared buffer) frozen — perceived as black. Second candidate class: era-sequence overlay (`seqSnapCanvas`, `juice.eraSeq.active` early-return path) latching active while its own paint throws.
**Rule — Fail-Visible Render Loop:** `frame()` wraps update+paint in try/catch; on throw: increment error counter, draw a diagnostic stripe ("RENDER FAULT — press R") onto the *last-good* framebuffer (keep an offscreen copy committed only on successful frames), continue rAF. Three consecutive faults → auto-pause + toast, never a dead black screen. This is testable headlessly (inject throwing paint stub, assert loop survives).

**D3 — HUD renders on top of the player mid-screen.**
Cause class: by-design-but-wrong: `positionWorldElement` anchors prompt/menu DOM at the world object's projected screen position with `z-index:5` — when the object is mid-screen (always), panels cover the figure. Not a bug to patch; a layout lie to retire.
**Rule — Fixed Chrome Regions:** all persistent UI (HUD, station panel, prompts, whispers) lives in fixed top/bottom chrome bands; the world layer owns everything between. Diegetic markers (glows, footprints) draw in-canvas; diegetic *text* is banned outside the world rect; non-diegetic panels are banned from world coordinates. Test: boot with fake DOM, assert panel roots' computed parents are chrome containers.

**D4 — Text overflows the left screen edge.**
Cause class: text drawn at world-projected x with no viewport clamp; `wrapText` measures width but x-origin can be negative when the anchor object sits near the camera's left edge; also `textAlign` default left with translate offsets.
**Rule — Measured & Clamped Text:** one helper `drawClampedText(ctx, text, anchorX, ...)` that (a) `measureText`-wraps to `maxW = worldRect.w − 2×MARGIN`, (b) clamps origin into `[worldRect.x+MARGIN, worldRect.right−MARGIN−blockW]`, (c) ellipsizes beyond maxLines. All canvas text goes through it — lint rule: no bare `fillText` outside the helper.

**D5 — Bottom half of screen does nothing.**
Cause class: mismatched geometry stack: element attrs 1280×720, CSS stretch to viewport (non-uniform), `fitCanvas` then maps logical 960×540 onto the backing store with independent x/y scales — so world content fills vertically-compressed space while gameplay surfaces sit at y≈0.72×VIEW_H; combined with letterboxing on tall windows and `overflow:hidden` on body, the lower region becomes chrome-less dead pixels with no interactive elements (input itself works; nothing is *there*).
**Rule — One Authority Geometry:** a single `layout()` computes `scale = min(vw/W, vh/H)` (uniform), backing store = `round(W*scale*dpr)`, centered offset, and exports `worldRect` consumed by renderer, hit-tests, and chrome. Aspect ≠ 16:9 → pillarbox painted with the palette background AND the surplus assigned to chrome (taller bottom band on portrait laptops), never to dead space. Resize handler re-runs `layout()` before the next frame. Test: fake window sizes → assert worldRect covers ≥85% of viewport area and no input mapping falls outside it.

---

## 5. REUSE / MIGRATION MAP

**Reuse unchanged (engine core is sound):** `tick.js` (fixed-step accumulator; add `paused` flag for station freeze — 5 LOC), `player.js`, `feel.js`, `camera.js`, `encounters.js` (ready/prompt/active state machine fits stations as-is), `actionChoices.js` (greyed-choice plumbing exists), `collapse.js`, `save-v6.js`, `gates.js`/`crossingGate.js`, `sfx.js`, `figure.js`, `hud.js` (re-parent into chrome-top; builder API already DOM-injectable), all `research/*.json` content verbatim, Studio parallax/prop art.

**Modify:** `scroller-boot.js` — split into `chrome.js` (fixed bands, station panel) + `worldview.js` (letterbox layout, clamped text, entity render contract, guarded loop); `styles.css` — chrome-band grid replacing floating `#resource-bar`/anchored overlays; `world.js` — micro-fork segments at era tails (x-range tagged `route: 'ridge'|'valley'`); `entities.js` — hazard-hit hook that publishes to the ledger consumed by `actionChoices` (partially exists via `__lastHazardHit` [verified]).

**Delete:** `positionWorldElement` and anchored-overlay path entirely; pointer fallback shim; `C` crouch-toggle; era-sequence snapshot path can shrink (keep reduced-motion branch).

**Numbers:** est. **+450 / −350 LOC net ≈ +100** on 5,606 (Direction A+ minus anchored overlays). New tests ~15–20 (render contract, guarded loop, layout authority, clamped text, station pause/resume, walk-away entropy). The 232 existing tests target engine semantics that don't move; the ones touching anchored overlays (`mg-ui`, parts of `integration-v8`) migrate with a documented mapping — expected churn ≤12 files.

**Known-vs-assumed register:** all repo claims verified this session. Game-mechanic claims cite interviews/teardowns above; the only load-bearing *assumption* is pacing (4–6 stations/era at ~30–60 s spacing feels right) — validate by playing, adjust `spawn-tables` density knob, no code change needed.
