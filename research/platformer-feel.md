# Platformer Feel Numbers — THE LONG ASCENT v6

Research deliverable for `src/engine/player.js` + `src/engine/camera.js` (SPEC-v6 §5, §6.2).
All numbers are px/second and seconds at a **fixed 60 Hz sim step** (`dt = 1/60`, accumulator;
render interpolation optional). Celeste runs its sim exactly this way — speeds in px/s, timers
in s, never per-frame velocities (teemo.dev Celeste reference, §Units).

Primary calibration source: **Celeste's published `Player.cs`** (MIT, Noel Berry copyright,
released in the official issue repo) — gravity 900, jump −105, max run 90, coyote 0.1 s,
variable jump 0.2 s. Celeste's native tile is ~8 px with a 10×24 hitbox, so absolute px values
are rescaled ×~3.3 below to fit our 32-px tile / 64×128 cell contract (SPEC §3); *ratios* are
kept intact wherever possible. Where a number can be copied unscaled (timers, buffers, cut
multipliers), it is.

---

## 1. Jump curve

Reference set (Celeste Player.cs lines 23–52 via teemo.dev constants reference):

| Constant | Celeste | Recommended (this game) | Rationale |
|---|---|---|---|
| `GRAVITY` | 900 px/s² | **820 px/s²** | ~2.5× tile/s² keeps Celeste's arc shape at 32-px tiles; apex hang comes from half-grav, not low g |
| `JUMP_SPEED` (initial vy) | −105 px/s | **−410 px/s** | Derived: held jump target 3.2 tiles (102 px) with t_apex ≈ 0.5 s → v0 = 2h/t = 408 |
| Apex height (held) | ~4 tiles (~128 px incl. var-jump clamp) | **≈102 px = 3.2 tiles** | SPEC needs "mantle"-reachable ledges; 3+ tiles lets era terrain breathe without double-jump |
| Apex height (tapped) | ~1–2 tiles | **≈45–55 px ≈ 1.5 tiles** | Tap/hold ratio ≈ 1:2 is the genre standard (see byteatatime derivation) |
| `MAX_FALL` | 160 px/s | **600 px/s** | Terminal velocity ≈ 3.3× run speed; caps long-fall nausea, keeps landings readable |
| Half-gravity window | \|vy\| < 40 while jump held → g × 0.5 | **\|vy\| < 155 while held → g × 0.5** | The single biggest "feel" knob (teemo.dev lists it #5); scales with v0 to keep the same hang time (~0.1 s float at apex) |
| Variable-jump release damping ("jump cut") | release zeroes the var-jump clamp; Godot demo multiplies vy × 0.6 | **on release while vy < 0: `vy *= 0.45`** | Instant, deterministic short-hop; 0.45 → tap ≈ 20% of held rise if released early, matching the 1.5-tile tap target |
| Alt. variable jump (sustain style) | clamp vy ≤ −105 for 0.2 s while held | **clamp vy ≤ −410 for up to 0.14 s while held** | Celeste-style alternative; pick ONE mechanism, not both. Sustain feels better for a walking game; cut-multiplier is simpler to test |
| Fast fall (hold ↓ airborne) | MaxFall → 240 at 300 px/s² | **MaxFall → 900 px/s, approached at 900 px/s²** | Gives ↓ a second job besides interact ONLY when airborne; on ground ↓ stays pure interact |
| Landing "snap" | dash snaps 3 px onto floors | **coyote-equivalent: snap down onto floor within 6 px of feet when falling & grounded input absent** | Prevents hover-at-ledge jitter; Celeste DashVFloorSnapDist pattern |
| Upward corner correction | nudge 4 px sideways / 1 px up on ceiling clip | **nudge up to 10 px sideways when rising into a corner** | Free-feel forgiveness; cheap with tile collision |

Derived checks (computed, not guessed): held jump airtime ≈ 1.0 s (0.5 up + 0.5 down from 102 px
at 820 px/s²); at full run 180 px/s that's a **~180 px (5.6-tile) gap maximum** — design terrain
gaps ≤ 4.5 tiles so jumps feel winnable with margin.

## 2. Coyote time + jump buffering

Measured windows (frame-stepped counts; rozgames column + celeste.ink via teemo.dev + Makone feel doc):

| Game | Coyote | Buffer | Band | Note |
|---|---|---|---|---|
| Celeste | 0.10 s (6 ticks, 5 usable) | 4 frames (~67 ms) | ~10 f | JumpGraceTime = 0.1 s in Player.cs line 48 |
| Hollow Knight | 4 f (~67 ms) | 4 f | 8 f | "punishing precision" ethos |
| Super Mario Odyssey | 5 f | 6 f | 11 f | modern Nintendo consensus band |
| Hades II | 5 f | 5 f | 10 f | |
| Sonic Mania | 3 f | 3 f | 6 f | retro-inflected |
| Super Mario Bros (NES) | 0 | 0 | 0 | why its deaths feel cheap now |

**Recommended: `COYOTE_MS = 100`, `JUMP_BUFFER_MS = 100`.**
Rationale: THE LONG ASCENT is a narrative walk, not a precision platformer — generous end of the
consensus band (100/100 ≈ 12-frame total tolerance) forgives the casual player without changing
physics. General guidance agrees: 100–150 ms standard, <50 ms imperceptible, >200 ms floaty
(Makone quantified standards). Implementation notes that matter:
- Refill coyote to full **every grounded tick**, decrement otherwise; zero it on jump consume
  (prevents free double-jump).
- Decrement BEFORE the jumpability test if you want Celeste's exact frame accounting, else quote
  6 usable frames instead of 5 — pick one and write the test to it.
- Buffer fires the jump on the first grounded tick after an air press; consume on fire.
- Human-latency floor: response must reach the screen in ≤100 ms to feel instantaneous (Swink,
  *Game Feel*, ch. 1 thresholds: 10 fps motion floor, 100 ms response floor, continuous loop).

## 3. Camera (camera.js)

Framework from Itay Keren's **Scroll Back** (GDC 2015/2017 talk + original blog post): camera-window,
position-locking, lerp-smoothing, look-ahead, region anchors. Concrete numbers:

| Parameter | Recommended | Source / rationale |
|---|---|---|
| Horizontal deadzone | **±80 px (2.5 tiles)** around the anchor point | LittleJS FollowCamera uses a dead-zone box (`deadZone : Vector2`, default small); SMB-family camera-windows are ≈ ¼ screen wide; ⅙ of 960 keeps motion smooth without dead drift |
| Vertical deadzone | **±56 px (~1.75 tiles)** | Rastan Saga lesson (Scroll Back): vertical window ≈ one standard jump height so ordinary jumps cause zero camera motion |
| Follow smoothing | exponential critically-damped, close **63 % of remaining gap in 0.15–0.2 s** (`pos += (target-pos) * (1 - exp(-dt/τ))`, τ = 0.18 s) | LittleJS `FollowCamera` default `smoothing = 0.1` s ("seconds to close most of the gap", frame-rate independent); 0.18 for our slower walk pace |
| Lookahead lead | **+140 px (≈15 % of 960-wide viewport) toward facing/movement direction**, applied only while moving | Scroll Back lookahead section (Cave Story two-position camera, NSMB right-biased camera); LittleJS `lookAhead` vector |
| Lookahead transition | glide between left/right leads over **0.4–0.5 s**; require **≥40 px of true reverse movement (or full stop + turn) before flipping** — hysteresis | LittleJS `lookAheadSmoothing` + `lookAheadTurn` ("a jiggle does not flip it"); Cave Story "slowly glides" on direction swap |
| Idle behavior | lead eases back to **centered** (offset → 0) over ~0.5 s when speed < 20 px/s | Swink: don't move the camera more than you have to; Keren target-focus "when controller is released, focus centers back on player" |
| Vertical anchor bias | anchor at player **feet + 120 px** (player sits low-third of screen) | Genre-standard framing: shows ground detail + upcoming terrain; matches NSMB/SMB low-player framing |
| Screen shake | trauma model: intensity = trauma², decay 1.0/s, max offset **≤8 px**, duration ≤0.3 s | LittleJS `cameraShake` (decay default 1/s); honor `prefers-reduced-motion`: shake OFF, pans ×0.5 (SPEC §3) |
| Era-boundary hold | freeze follow (lock position) for **2.0 s** during crossfade + re-equip anim | SPEC §2 set piece; Swink: camera interference breaks intent→result mapping |
| One-way scroll | camera x is monotonic non-decreasing (no backtracking) | SPEC §2 one-way timeline; SMB right-edge lock |

## 4. Acceleration / friction (ground vs air)

Celeste model (`Calc.Approach` toward target, clamped, never overshoots) — copy the pattern, scale the units:

| Constant | Celeste | Recommended | Rationale |
|---|---|---|---|
| `MAX_RUN` | 90 px/s | **180 px/s** (5.6 tiles/s) | Crosses a 960-px screen in 5.3 s — brisk but walkable-feeling for a 50-screen pilgrimage (~20 min straight-through target, SPEC §2) |
| Ground accel `RUN_ACCEL` | 1000 px/s² | **1800 px/s²** | Reaches max run in 0.1 s (6 f) — crisp start; Celeste reaches max in ~5 f, keep the ratio |
| Ground decel `RUN_REDUCE` | 400 px/s² (+ RunReduce when over-speed pushing) | **1400 px/s² toward 0 on input release** | Stops in ~0.13 s; a narrative walker wants near-on-a-dime stops (Mega Man X school: no slide-past-encounters); slower-than-accel would overshoot prompts |
| Air control multiplier | 0.65× on accel/reduce | **0.7×** | Enough authority to commit/adjust mid-jump, still reads as "air"; Celeste's AIR_MULT is the canonical value |
| Turn-around boost | implicit via JumpHBoost | **instant velocity flip allowed in air (set, not approach, when input sign ≠ velocity sign while airborne, cap at MAX_RUN)** | Full air steering on direction reversal is standard in Celeste-class games; ground turning uses normal accel |
| Jump horizontal boost | +40 px/s in held direction | **+70 px/s on jump** | Scale-matched JUMP_H_BOOST; makes running jumps visibly longer than standing ones |
| Landing retention | EndDashSpeed 160 (2/3 dash) | **preserve horizontal velocity on landing (no friction spike)** | Momentum carry = flow; killing vx on land is the #1 "stiff" tell |
| Snap-to-stop threshold | — | **zero velocity below 5 px/s** | Avoids infinite asymptotic creep |

Alternative school for reference: Hollow Knight has **no horizontal acceleration at all** — full
speed or still, instantly (Mega Man X lineage; ludonauta devlog reproduction uses flat `speed`
set, no ramp). If playtesting says the ramp feels "swampy" for reading signage while walking,
flip `RUN_ACCEL` to effectively infinite (set velocity directly) — everything else in this doc
survives that change.

## 5. Sprite size vs screen vs tile

Contract already fixed by SPEC §3 (64×128 cells) — these are the on-screen ratios that make it read:

| Metric | Recommended | Source |
|---|---|---|
| Tile size | **32 px** | Mid-point between NES 16 px (SMB) and modern HD 48–64 px; at 960 wide = 30 tiles across — enough lookahead for a 5.6-tile jump plus margin |
| Player collision box | **24 × 56 px** (narrower than sprite) | Hitboxes smaller than art = forgiving corridors (Celeste UpwardCornerCorrection philosophy); stick figure is thin-limbed, art overhangs |
| Drawn sprite height | **96–112 px on screen** (cell 64×128, feet-anchored) | ≈3 tiles tall; on a 540-px-tall viewport that is ~20 % — but the viewport is integer-scaled UP to fill e.g. an 850-px laptop window, and what matters is world-space ratio: hero = 3 tiles of a 17-tile-high view ≈ 1/6 visible height, matching NSMB-era framing where ~1/5–1/6 of screen height is hero |
| Screen fraction rule | hero height = **1/5 – 1/6 of viewport height** (world-space) | NSMB DS analysis (critical-gaming blog): Mario ≈ 1/12 of screen on DS vs 1/16 on TV — smaller screens want a relatively bigger hero; SMB NES is the arcade extreme at 16 px of 224 (~1/14). Our laptop audience sits nearer the DS end, so 1/6 of a 17-tile view is right |
| Viewport logical size | **960 × 540** (16:9), integer-scaled to fit window, `image-rendering: pixelated` | 960/32 = 30 tiles, 540/32 ≈ 17 tiles; integer scale avoids shimmer |
| Camera zoom during encounters | none (no zoom-in) | Zoom breaks the seamless-world promise of SPEC §1; use prompt UI instead (§6) |
| Encounter object drawn height | 1.5–2.5 tiles (48–80 px), always ≥ 4.5:1 ink-vs-ground contrast | SPEC §3 palette contract; readability at 32-px scale needs strong silhouettes (Miyamoto principle: constraints define identity — cometatomic Miyamoto essay) |

## 6. Encounter proximity + interaction affordances

No single authoritative datamine exists for 2D-adventure prompt radii, so this section combines
engine-default evidence (Roblox ProximityPrompt's three-distance model), latency science (Swink),
and genre convention. Flagged accordingly.

| Parameter | Recommended | Rationale / source |
|---|---|---|
| Trigger radius (interaction valid) | **48 px (1.5 tiles) from object center-x, horizontally; any vertical overlap ±64 px** | Slightly wider than player body; Roblox ProximityPrompt defaults MaxActivationDistance = 4 studs ≈ one character-height-plus — i.e., ~1.5–2 character heights (create.roblox.com docs) |
| Prompt appear distance | **80 px (2.5 tiles)** — prompt fades in at 80, stays active to 48, fades out 0.15 s after leaving 48 | Two-threshold model = Roblox's MaxActivationDistance vs MaxIndicatorDistance split (docs: indicator "hints an interaction is nearby before the prompt becomes active"); fade-out grace prevents prompt flicker at the boundary |
| Far hint (non-text sparkle/glow on object) | **160 px (5 tiles)** faint glow, no button text | Scroll Back foreshadowing principle (Wonder Boy camera-path): show challenges before they demand action; keeps the path legible while walking |
| Interaction key | **↓ per SPEC §1; also accept E / Enter / Space-while-standing-still** | Multi-key = accessibility; note conflict: jump is ↑/Space — Space-as-interact ONLY when grounded AND inside trigger, else jump wins (priority: jump > interact for Space) |
| Input buffer on interact press | **100 ms**: pressing ↓ within 100 ms before entering the radius fires on entry | Same human-latency argument as jump buffering (rozgames 11-frame band; Swink 100 ms simultaneity threshold) — players pre-press what they see coming |
| Choice-menu input | arrow keys + Enter, each choice accepts buffered repeat; menu open pauses world sim but NOT audio | SPEC §1 "small in-world menu anchored to the object"; pausing sim while choosing honors "the game only moves when you move" (SPEC §1) |
| Prompt dwell before dismiss | auto-dismiss menu after **8 s idle**, object remains re-triggerable | No fail state; re-walk 48 px to reopen |
| Cooldown after resolve | **0.4 s** before the same or adjacent object can re-trigger | Prevents accidental chain-triggers when walking past a cluster of objects (Roblox CooldownTime property exists for exactly this reason) |
| Proximity check cost | squared-distance test against objects within current camera x-range only (spatial bucket by 30-tile chunk) | Perf: 60 fps budget with ~240 encounter objects (SPEC §4: 236 events) |

---

## Priority tuning order (what Forge should tune first, in order)

1. `COYOTE_MS` / `JUMP_BUFFER_MS` (responsiveness floor — invisible until missing)
2. Release-cut multiplier `0.45` and half-grav window (arc personality)
3. `RUN_ACCEL` vs air-control `0.7` (crispness vs drift)
4. Camera τ `0.18 s` + lookahead `140 px` + hysteresis `40 px` (readability)
5. Prompt radii 80/48/160 (encounter rhythm)

## Sources

- Celeste `Player.cs` constants (published MIT source, NoelFB/Celeste issue-repo release) — catalogued with line numbers: https://teemo.dev/game-design/celeste/systems/movement-and-physics-constants-reference (cross-checked vs celeste.ink figures; controls summary: https://teemo.dev/game-design/celeste/systems/controls-and-movement )
- Celeste values mirrored in a tunable GDScript port: https://github.com/eguneys/celeste-jumping
- Coyote/jump-buffer frame measurements across Celeste / Hollow Knight / Mario Odyssey / Hades II / Sonic Mania: https://rozgames.com/article/jump-input-buffering-other-invisible-window ; corroborating standards (100–150 ms windows): https://github.com/wormholeportal/Makone/blob/main/skills/game/feel/coyote-time.md ; implementation patterns: https://shaggydev.com/2022-06-29/platformer-tips
- Side-scroller camera vocabulary + techniques (camera-window, lookahead, lerp-smoothing, position-lock): Itay Keren, *Scroll Back*, GDC 2015 Vault: https://www.gdcvault.com/play/1022243/Scroll-Back-The-Theory-and ; original post: https://www.gamedeveloper.com/design/scroll-back-the-theory-and-practice-of-cameras-in-side-scrollers ; written recap w/ lookahead/damping survey (Cave Story, NSMB U, Sonic): https://gmtk.substack.com/p/how-to-make-a-good-2d-camera
- Frame-rate-independent follow camera defaults (smoothing 0.1 s, deadZone box, lookAhead + lookAheadTurn hysteresis, trauma shake decay 1/s): LittleJS FollowCamera docs: https://killedbyapixel.github.io/LittleJS/docs/Camera.FollowCamera.html
- Jump math derived from height + time-to-apex (v0 = 2h/t, g = 2h/t²): https://byteatatime.dev/posts/jumping
- Latency/perception thresholds (10 fps floor, 100 ms instant-response, continuity): Steve Swink, *Game Feel* ch. 1 PDF: http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf ; thresholds Q&A: https://gamedev.stackexchange.com/questions/203106/what-does-continuity-of-response-mean-in-the-book-game-feel
- Player-size-as-screen-fraction (NSMB Mario = 1/12 screen vs SMB 1/16): http://critical-gaming.blogspot.com/search/label/Structuralism
- Proximity interaction three-distance model (activation vs indicator vs hold, cooldown): Roblox ProximityPrompt docs: https://create.roblox.com/docs/reference/engine/classes/ProximityPrompt
- Engine baseline sanity-check (velocity px/s, jump −400 @ default gravity 980, release cut `velocity.y *= 0.6`): Godot CharacterBody2D docs: https://docs.godotengine.org/en/stable/tutorials/physics/using_character_body_2d.html ; official platformer demo: https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.gd
- Hollow Knight zero-acceleration school + pogo/dash reuse: https://ludonauta.itch.io/platformer-essentials/devlog/1069670/hollow-knight-inspired-movement-with-the-moving-character-recipe ; Hollow Knight tight 8-frame assist band: rozgames table above
- Silksong/HK control bindings (context): https://hollowknight.wiki/w/Controls_(Silksong)

Caveats: Dead Cells' physics constants are not publicly datamined — excluded rather than
guessed; its relevant lesson is qualitative (attack cancels preserve momentum — replicate §4's
landing-retention rule). Rozgames' frame tables are frame-step measurements, not dev-published
numbers; Celeste's own constants corroborate its coyote/var-jump entries exactly, which raises
confidence in the rest.
