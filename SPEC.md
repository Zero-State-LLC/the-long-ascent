# THE LONG ASCENT — Game Design Spec v2.0
**z0D orchestration doc · 2026-10-28 · Stick-figure accelerationist RPG, inspired by Charles Stross's *Accelerando* (unaffiliated homage)***

*v2 revision: animated per-event scenes, progressive stick-figure costume/upgrade system, audio layer (soundtrack + SFX), Studio delivers sprite/audio assets; Forge animates them.*

---

## 1. Vision

One line: **You are a lineage, not a person.** From a fire in a cave to copies of
yourself crossing interstellar voids, every era you survive rewrites what "you" means.

- **Genre:** Idle-adjacent incremental RPG with branching narrative choices.
- **Tone:** *Accelerando*-adjacent — exponential dread + gallows humor.
- **Core loop:** Allocate Resources → trigger Events → make Choices → Era advances
  when its progress bar fills → inherit modifiers into next Era.
- **Visual contract (v2):** The stick figure is a *character*, not a diagram. Their
  silhouette, props, and animation change visibly as the lineage advances. Every event
  card shows an **animated scene** illustrating its situation. The player should be
  able to glance at the canvas and immediately read the era and the decision at hand.

---

## 2. The Eleven Eras (fixed spine)

| # | Era | Signature resource | Signature mechanic |
|---|-----|--------------------|---------------------|
| 1 | The Cave | Food | Fire discovery; first tool; first death (lineage, not permadeath) |
| 2 | Agriculture | Grain | Land plots; surplus → population; first "economy" |
| 3 | Bronze & Empires (Greece→Rome) | Coin | Trade routes; law; legions; empire overextension risk |
| 4 | The Dark Ages | Faith | Monasteries preserve knowledge; knowledge-decay mini-mechanic |
| 5 | Renaissance & Print | Books | Printing press; science points; plague events |
| 6 | Steam & Industry | Coal | Factories; pollution counter (persists to endgame); labor unrest |
| 7 | The American Century | Oil | Globalization; two world wars (scripted events); consumer culture |
| 8 | Atomic | Fissile | Doomsday clock (persisting stat); deterrence minigame |
| 9 | The Digital Dawn | Compute | Moore's law curve; first AI agents (hirable stick figures) |
| 10 | The Connected Age | Attention | Social media; attention economy corrupts other resources |
| 11 | The Singularity & Beyond | Compute² / Selfhood | Upload, fork copies, star-system colonization |

---

## 3. Systems

### 3.1 Resources (unified model)
Six persistent pools that re-key per era: **Sustenance** (food→grain→coin→faith→books→
coal→oil→fissile→compute→attention→selfhood), **Knowledge**, **Population** (becomes
"instances" late-game), **Infrastructure**, **Legitimacy**, **Entropy** (pollution/risk;
never goes down easily).

### 3.2 The Lineage mechanic
Your "character" is a **lineage**. Each Era, your protagonist can: die (replaced by heir,
-10% of one resource), fork (post-upload: split into copies with stat divergence), or merge
(copies recombine, +synergy, -diversity). The stick figure on screen is always "the current
carrier." Copy count is a late-game resource AND a late-game problem (copy-drift events).

### 3.3 Choices & memory
Every choice is logged to the **Chronicle**. Late-era events reference Chronicle entries.
~120 branching events across eras, each with 2–4 options, flag-gated.

### 3.4 Endings (post-Singularity, 5 endings)
1. **The Diaspora** — forks seed 3+ star systems, lineage continues.
2. **The Cathedral** — one merged self, maximally powerful, utterly alone.
3. **The Long Stutter** — entropy wins; the last copy powers down.
4. **The Bureaucracy of Ghosts** — copies spend eternity litigating inheritance.
5. **The Ascension** — the lineage becomes incomprehensible; ends in stick figures turning into pure geometry.

---

## 4. Visual System (v2 — REVISED AND EXPANDED)

### 4.1 Progressive stick-figure costumes

The carrier's silhouette **visibly evolves** through 11 era costumes. Each costume is a
distinct sprite sheet (delivered by Studio, animated by Forge) that communicates the era
at a glance:

| Era | Carrier silhouette | Prop / upgrade visual |
|-----|-------------------|-----------------------|
| 1 — The Cave | Hunched, rough loincloth | Wooden spear; firebrand |
| 2 — Agriculture | Upright, simple tunic | Grain sheaf; hoe |
| 3 — Bronze & Empires | Armored, cape | Short sword; shield; laurel |
| 4 — Dark Ages | Hooded cloak | Illuminated manuscript; candle |
| 5 — Renaissance | Coat and collar | Quill; printed page |
| 6 — Steam & Industry | Top hat, goggles | Wrench; gear badge; steam puff |
| 7 — American Century | Suit and tie | Briefcase; small oil drum |
| 8 — Atomic | Lab coat | Geiger counter; distant mushroom cloud |
| 9 — Digital Dawn | Hoodie, cable trailing | Floating cursor; terminal slab |
| 10 — Connected Age | Phone-face (phone replaces head) | Notification orbit |
| 11 — Singularity | Distributed / partly transparent | Copy-nodes; star-system in palm |

Each costume is a **set of 4-frame looping sprite images** (PNG sprite sheet, 4 cols × 1 row,
each cell 128×256 px): idle, action-A (working/building), action-B (conflict/threat),
reaction (win/loss moment). Studio delivers PNG sprite sheets. Forge slices and plays them
on the canvas via `drawImage` with `requestAnimationFrame`.

**Upgrades are visible:** milestones (first surplus, first city, first factory, etc.) add
a persistent small badge/aura to the figure — a flame icon above the head in Era 1 after
Fire is discovered, a halo in Era 4 if the monastery was funded. These persist until the
next costume change, then are carried forward as small glyphs on the new costume.

### 4.2 Per-event animated scenes

Every event card shows a **small animated scene** in a 320×180 canvas inset above the
event text. The scene illustrates the event's situation — NOT generic background art.

Scene system:
- Each event has a `scene_id` key in `events.json` (e.g. `"hunt_dilemma"`, `"fire_crisis"`).
- Studio delivers a set of **scene sprite sheets** (PNG, 4-8 frames, 320×180 px each cell):
  one per scene category (see §5 Studio contract for the full list — ~30 scene categories
  covering all 11 eras). A scene category is reused across similar events in the same era.
- Scenes use the **era palette** (colors from Studio's existing visual-assets.md) so every
  era feels distinct even if the action is similar.
- The scene plays as a 4-8 frame loop at 8 fps while the event card is open; on choice
  selection it plays a **one-shot outcome frame** (3 extra frames, does not loop) before
  advancing.
- **Forge animates all scenes** using the `AnimScene` module (see §4 code rules).

### 4.3 Audio layer (NEW)

Studio delivers all audio. Forge integrates via the `AudioManager` module.

**Soundtrack:**
- 11 era themes (looping ambient tracks, ~60s loops): one per era, crossfades on era transition.
  Style: minimal, generative-feeling, era-appropriate (cave = bone percussion; atomic = theremin
  drone; digital = lo-fi glitch; singularity = reverbed choir). Delivered as `.ogg` + `.mp3`.
- 1 title screen ambient track.

**SFX (one-shot, short):**
- `click_choice.ogg` — button click
- `era_transition.ogg` — era advance fanfare (~2s)
- `lineage_death.ogg` — carrier dies, heir takes over
- `fork.ogg` — copy created (post-upload)
- `drift.ogg` — copy-drift event fires
- `entropy_tick.ogg` — entropy increases
- `ending_[diaspora|cathedral|stutter|ghosts|ascension].ogg` — 5 ending stings (~4s each)
- `benthic_ping.ogg` — Benthic appears (distinctive claw-click sound)
- `upgrade.ogg` — milestone badge earned

**Audio contract rules:**
- All audio plays through `AudioManager.play(id)` and `AudioManager.playBgm(era)`.
- User can mute; preference stored in localStorage.
- No audio auto-plays before a user gesture (Web Audio API rule).
- First gesture anywhere on the page unlocks audio context.

### 4.4 Background environments (revised)

The canvas background is no longer a flat color. Each era has a **scrolling parallax
background** (2 layers):
- Layer 1 (far, slow): environmental silhouette — cave wall; wheat field; colosseum columns;
  monastery arch; printing house; factory skyline; city at night; missile silo; server farm;
  social feed tiles; star field.
- Layer 2 (near, faster): atmospheric detail — sparks; pollen; smoke; candle moths; paper
  scraps; coal dust; oil slick; fallout particles; data packets; notification bursts; stellar
  material.

Both layers are looping sprite strips (320×180 px, delivered by Studio). Forge loops them
with `ctx.translate(offset, 0)` and wraps. Scroll speed tied to era "tempo": slow in early eras,
imperceptibly fast in era 11.

---

## 5. Agent Deliverables (v2)

| Agent | File(s) | Contract |
|---|---|---|
| **Scout** (bosgame Qwen3.8) | `research/source-digest.md` | *Unchanged from v1.* |
| **Studio** (gpt-6-luna) | `research/visual-assets-v2.md` + `assets/sprites/` | **New v2 contract — see below.** |
| **Scribe** (GLM) | `research/copy-deck.md` | *Add `scene_id` key to each event JSON object (drawn from the scene category list Studio provides). Otherwise unchanged.* |
| **Forge** (GLM) | the codebase | **Implements §4 fully.** New modules: `AnimScene`, `SpriteAnimator`, `AudioManager`, `ParallaxBg`. See §6. |

### Studio v2 contract
Deliver the following files to `research/visual-assets-v2.md` (structured markdown) and
`assets/sprites/` (PNG + audio):

1. **Costume sprite sheets** (11 × PNG, 512×256 px each — 4 cells × 128×256):
   `sprites/costume_[era_id].png` — 4-frame loop: idle, action-A, action-B, reaction.
2. **Scene sprite sheets** (~30 × PNG, 1280×180 px — 8 cells × 160×180 — *see category list below*):
   `sprites/scene_[scene_id].png`. Categories: `hunt_dilemma`, `fire_crisis`, `surplus_feast`,
   `granary_siege`, `trade_road`, `senate_vote`, `legion_march`, `monastery_copy`, `plague_cart`,
   `press_room`, `patron_deal`, `factory_floor`, `luddite_mob`, `crash_floor`, `war_front`,
   `lab_test`, `doomsday_clock`, `dot_com_frenzy`, `memory_mug`, `social_spiral`, `attention_auction`,
   `upload_pod`, `fork_split`, `drift_diverge`, `benthic_meet`, `star_seed`, `ending_diaspora`,
   `ending_cathedral`, `ending_stutter`, `ending_ghosts`, `ending_ascension`.
3. **Background layer pairs** (11 × 2 = 22 × PNG, 640×180 px — 2 seamless strips side-by-side for looping):
   `sprites/bg_[era_id]_far.png`, `sprites/bg_[era_id]_near.png`.
4. **Upgrade badges** (12 × PNG, 24×24 px): `sprites/badge_[name].png` for fire, city, surplus,
   print, factory, atom, code, upload, fork, drift, benthic, star.
5. **Audio files** as listed in §4.3: `audio/bgm_[era_id].ogg` + `.mp3`, and all SFX `.ogg` files.
6. **`research/visual-assets-v2.md`**: asset manifest + animation specs (frame count, fps, loop/one-shot).

*Style constraint:* All sprites use the era palettes from `research/visual-assets.md`. Stick figures
are expressive but remain clearly stick-figure — think Nitrome / Thomas Was Alone gesture at
sophistication without photorealism. Scenes should be readable at 320×180; silhouettes > detail.

---

## 6. Architecture — v2 additions to §4 code rules

New modules Forge must build, in `src/render/`:

- **`AnimScene.js`** — loads a scene sprite sheet (PNG), slices frames by pixel offset,
  plays loop or one-shot. API: `new AnimScene(ctx, spriteEl, frameW, frameH, fps)`;
  `.play(loop=true)`, `.playOnce(onDone)`, `.stop()`.
- **`SpriteAnimator.js`** — same pattern for costume + badge layers on the carrier figure.
  Replaces the v1 parametric-point figure: Forge draws the base figure programmatically
  (still parametric) and *overlays* sprite frames for costume detail.
- **`AudioManager.js`** — Web Audio API wrapper. `AudioManager.init()` on first user gesture;
  `.play(sfxId)`, `.playBgm(eraId)`, `.mute()`, `.unmute()`. Falls back silently if files missing.
- **`ParallaxBg.js`** — two-layer looping strip. Tracks scroll offset per era, resets on era change.

**Graceful degradation** (Forge must implement):
- If a sprite PNG fails to load → fall back to parametric drawing (v1 figure stays).
- If an audio file fails → silent; game continues unaffected.
- All new features optional-enhance, never gate gameplay.

Tests must cover: `AnimScene` frame cycling, `SpriteAnimator` costume swap, `AudioManager` init
guard (no context before gesture), `ParallaxBg` wrap. Overall suite must stay at ≥ 18 passing.

---

## 7. Platforms (unchanged from v1)

Web (primary, PWA) · iOS via Capacitor · Android via Capacitor.

---

## 8. Original-names rule + the Benthics (unchanged)

All proper nouns from the source novel are OFF LIMITS in shipped content.
Originals: **the Reef** (distributed person-uploads), **the Consortia** (post-human corps),
**the Feral** (incomprehensible fast-thinkers).

**The Benthics stay** — lobster-derived AI, deadpan creditors, Greek chorus with claws.
Studio asset: `sprites/scene_benthic_meet.png` (8-frame scene), `sprites/costume_benthic_npc.png`
(4-frame NPC, distinct from carrier), `audio/sfx_benthic_ping.ogg`.

---

## 9. v2.1 — Feel, Readability & Depth (2026-10-28)

Playtest feedback drove this revision: visuals now work (sprites render, backgrounds
anchor, cards fit) but the game is hard to *read* and mechanically shallow. v2.1
targets comprehension first, then depth.

### 9.1 UI legibility (Forge)

- **Label the purple bar.** The era progress meter (`#progress-fill`) gets a visible
  caption: `ERA PROGRESS — 43% → next: Agriculture`. Always visible; not only on hover.
- **Explain idle production.** Resource chips show per-second deltas: `Food 182 +1.2/s`.
  While an event card is open, production **pauses by default** (Setting: "Pause during
  choices" — on by default) so reading isn't taxed and meters don't creep mysteriously.
- **Entropy is visible.** The Entropy pool gets a red-tinted chip and a one-line tooltip:
  "Pollution, risk, debt. Never goes down easily. At 100, the lineage ends."
- **First-run primer.** Three-line intro card before Era 1 (skippable, remembered):
  1) Resources tick every second. 2) Events need choices. 3) Fill the bar to advance era.
- **Tooltips on every stat.** Knowledge, Population, Infrastructure, Legitimacy get
  one-line explanations (hover on desktop, long-press on touch).

### 9.2 Depth: systems that make choices matter (Forge)

- **Resource sinks & urgency.** Entropy now *does* things: above 50, random events
  fire more often; above 80, resources decay 2%/tick. Choices that reduce entropy
  (cleanup, reform, retreat) become strategically vital, not cosmetic.
- **Choice consequences visible.** After choosing, the outcome card shows deltas:
  `+12 Food, −3 Legitimacy, +1 badge: Fire`. The Chronicle logs them.
- **Era goals.** Each era has a named goal (Era 1: "Master Fire"; Era 6: "Electrify")
  shown under the progress bar. Hitting it grants a badge + resource bonus; skipping
  locks the associated late-era branch (already flagged in events).
- **Legacy modifiers pane.** A "Lineage" tab shows accumulated modifiers from past
  choices (e.g. "Promethean: fire events +20%") so the player sees their build.

### 9.3 Visual upgrades (Studio)

- **Scene canvas is the star.** 320×180 → **480×270**, placed ABOVE the event title
  (not between text and choices), with a subtle vignette + drop shadow. The card
  layout reorders: scene → title → body → choices.
- **Backgrounds get depth.** Each era's far layer gains a slow vertical drift
  (2-3px bob) to feel alive; near layer gets a slight blur (1px) for depth of field.
  Both are Forge-side effects — no new assets needed.
- **Carrier animation states tied to game state:** producing → action-A loop;
  event open → idle; entropy > 60 → reaction frame flashes occasionally.
- **Choice hover previews.** Hovering a choice dims the scene and shows the delta
  forecast (from §9.2 data) as small floating chips.

### 9.4 Audio additions (Studio)

- 3 ambient loops: `bgm_choice.ogg` (soft, under event cards), `bgm_high_entropy.ogg`
  (tense drone, replaces era BGM when entropy > 70), `bgm_ending.ogg` bed for endings.
- 3 new SFX: `resource_milestone.ogg`, `era_goal_complete.ogg`, `choice_deltas.ogg`
  (soft tick on consequence reveal).

### 9.5 Deliverables & routing

- **Forge**: §9.1 + §9.2 + scene canvas repositioning (§9.3 item 1) + background
  depth effects (§9.3 items 2-3). Tests for: pause-during-choices, entropy decay
  threshold, era goal grant/lock, delta rendering. Suite ≥ 37 passing, exit 0.
- **Studio**: §9.3 hover-preview spec additions + §9.4 three loops + three SFX.
  Update `research/visual-assets-v2.md` manifest.
- **Scribe**: era goal names + descriptions (11), first-run primer copy, tooltip
  strings, choice-delta flavor lines. Drop into `src/data/` via JSON.

*Rule from z0D: every turn is a PR. Spec changes PR first, then implementation PRs.*
