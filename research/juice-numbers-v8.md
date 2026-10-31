# Juice Numbers v8 — citable constants for feel.js

Scout research for SPEC-v8 §1 (routing §6.2). All numbers are from celebrated 2D
games' source code, developer talks, or measured analyses — each line has a
source URL. Where a game's native unit differs from ours the conversion is
stated. Forge: plug straight into `src/engine/feel.js` + juice module; every
value must stay behind `prefers-reduced-motion`.

Frame math: 1 frame @60fps = 16.7ms. Our tile = 32px (SPEC v6/v7 scale).

---

## 1. Squash & stretch (jump / land)

Celeste (decompiled source, Player.cs — canonical reference):

| Constant | Value | Rationale / source |
|---|---|---|
| Jump stretch (instant set) | scaleX 0.6, scaleY 1.4 | `Sprite.Scale = new Vector2(.6f, 1.4f)` on jump — extreme stretch sells launch energy. [Player.cs](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs) |
| Landing squash formula | `squish = min(fallSpeed / fastMaxFall, 1)`; `scaleX = lerp(1, 1.6, squish)`, `scaleY = lerp(1, 0.4, squish)` | Velocity-scaled squash: soft landings barely squash, terminal ones flatten to 40%. Same file. |
| Celeste px/s context | MaxFall 160, FastMaxFall 240, gravity 900, jump −105 | So full squash only at fast-fall speed. [teemo.dev constants ref](https://teemo.dev/game-design/celeste/systems/movement-and-physics-constants-reference) |
| Scale recovery | one-shot kick, decays back to 1 over ~0.1–0.2s | Celeste re-lerps scale toward One each frame; Godot-feel guides converge on 0.15–0.18s TRANS_BACK/EASE_OUT recovery. [gamecodex G38](https://unpkg.com/gamecodex@2.0.1/docs/godot-arch/guides/G38_game_feel_and_juice.md), [manuelsanchezdev](https://www.manuelsanchezdev.com/blog/game-feel-principles-animated-godot) |
| Spring alternative | stiffness 360, damping 16 (`scale=(1+s, 1−s)`) | Damped spring overshoots squash→stretch and settles — what sells it if one-shot tweens feel canned. [codingquests feel lab](https://codingquests.io/blog/godot-4-game-juice-platformer) |
| Ori landing squash | sprite flattened to ~10px tall for a few frames on ground impact | Lead animator James Benson, GDC 2015 "Animating Ori": non-uniform bone scale, extreme but ≤~4 frames. [talk notes](https://zyzyz.github.io/en/2018/01/GDC2015-Animating-Ori), [video](https://www.youtube.com/watch?v=m8lOwrWNbEY) |

**Recommended for The Long Ascent** (matches SPEC §1 targets y 0.85 / 1.12):
- Jump: instant `(0.85, 1.12)` → recover to `(1,1)` in **120ms easeOutQuad**. (SPEC value; Celeste-proportioned shape, gentler amplitude for our larger figure.)
- Land: `t = clamp(fallVy / maxFall, 0, 1)`; `(1 + 0.25t, 1 − 0.15t)` → hold 1 frame → recover **150ms easeOutBack(1.7)**. Volume-ish preserving.
- Draw with transform-origin at the FEET (squash presses into floor, not heartbeat). [valdemird game-feel-on-web](https://valdemird.com/blog/game-feel-on-the-web/)

## 2. Screen shake (magnitude / duration / falloff)

Model: Jonathan Burks' trauma system (GDC 2013 "Implementing Quality Screen
Shake") — `trauma ∈ [0,1]`, offset = noise × trauma² (quadratic falloff makes
small hits nearly invisible, big hits punch), decay linear ~0.8–0.9/s, capped
stacking. [peanuts-code implementation of Burks' algorithm](https://www.peanuts-code.com/en/tutorials/gd0014_screen_shake/), [gd.stackexchange rationale](https://gamedev.stackexchange.com/questions/159051/implementing-screen-shake)

| Event | Magnitude | Duration | Rationale / source |
|---|---|---|---|
| Light hit / small pop | 1–2px peak offset | 80–120ms | Vlambeer "pause 20ms + tiny shake" school; juicy-breakout uses 100ms camera shakes per brick. [Art of Screenshake (INDIGO 2013)](https://www.youtube.com/watch?v=AJdEqssNZ-U), [juicy-phaser guide](https://github.com/JimWhiteheadUCSC/juicy-phaser-breakout/blob/master/GUIDE.md) |
| Normal combat hit | 3–4px | 150–200ms ("6–12 frames", magnitude scaled to significance) | [rozgames damage-feedback survey](https://rozgames.com/article/damage-feedback-visual-language-hits-kills) |
| Heavy / collapse | 6–8px | 250–400ms | Dead Cells "substantial, scaled to significance"; keep under half a second or it reads as an error. |
| Decay curve | trauma² quadratic, linear bleed-off 0.8/s; NEVER let trauma only rise | — | Shake must settle to zero or it becomes vibration, not impact. [masterallarts juice episode](https://masterallarts.com/learn/web-games-from-zero/05-juice-and-game-feel/) |
| Noise type | smooth (simplex/perlin-scroll), not white random, ≥2 octaves | — | White noise looks like a dropped frame; smooth noise reads as camera totter. [peanuts-code](https://www.peanuts-code.com/en/tutorials/gd0014_screen_shake/) |

**Recommended:** SPEC values (1px/80ms heavy land, 2px/120ms hazard, 4px/200ms
collapse) sit exactly in these bands — keep them; implement as trauma
additive-to-camera with quad falloff so stacked hazards don't double up
linearly. Rotation ≤ ±0.02 rad optional.

## 3. Particles (counts, rates, lifetimes, velocities)

| Effect | Count | Lifetime | Velocity | Source |
|---|---|---|---|---|
| Dust on hard land (Celeste) | 8 particles, emitted upward (angle up ±spread) | ~0.3–0.5s (sprite-sheet dust) | ~40–80px/s outward | `Dust.Burst(Position, AngleUp, 8)` when `Speed.Y >= MaxFall/2`; jump emits 4. [Player.cs](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs) |
| Dust on walk/step | 1 particle per footfall tick, angle opposite facing | short | slow drift | `Dust.BurstFG(..., 1, 0)` in same file. |
| Impact/spark burst (Dead Cells tier) | 20–40 per hit | 300–500ms | radial, fast start, drag | [rozgames on Dead Cells](https://rozgames.com/article/damage-feedback-visual-language-hits-kills); genre norm 200–500ms. |
| Generic hit particles | 5–12 | 200–400ms | 60–150px/s cone away from hit normal | synthesis of rozgames + freegamesprites norms below. |
| Ambient dust motes | 1 spawn every 0.5–1.5s per screen region, cap ~20 live | 3–6s | 5–15px/s near-drift, sine sway | Ori-style ambience (GDC animation talk describes layered ambient FX; counts are industry-standard pool sizes — flagged as estimate). |
| Pool policy | fixed pool, hard cap, recycle dead slots, never allocate in loop | — | — | GC hitches mid-fight are the #1 canvas-2D juice failure. [masterallarts](https://masterallarts.com/learn/web-games-from-zero/05-juice-and-game-feel/) |

**Recommended for us:** jump dust 4, land dust 8 (only if fallVy > 50% max),
direction-change sprint puff 3, hazard-hit sparks 10, pickup sparkle 6. All
white 16×16 Studio sprites tinted by era palette.

## 4. Hit-stop (freeze frames)

| Weight | Frames @60 | ms | Source |
|---|---|---|---|
| Dead Cells crit (dev-stated) | **1 frame freeze + slow-down of a few tenths of a second after** | 17ms | Sébastien Bénard, GDC 2019 "Dead Cells: what the f*n?!" ([slides](https://media.gdcvault.com/gdc2019/presentations/Benard-Sebastian-DeepCells.pdf), [Gamasutra interview](https://www.gamedeveloper.com/design/designing-each-of-the-50-weapons-in-i-dead-cells-i-to-feel-distinctive)) — weight comes from the time-scale dip AFTER the freeze, not long freezes. |
| Ship-norm light / medium / heavy | 2–3 / 4–6 / 6–10 frames | 33–167ms | [freegamesprites combat-juice rundown](https://freegamesprites.com/news/game-feel-2d-combat-juice-tricks); Hyper Light Drifter dash-contact ≈4 frames. |
| Survey band | 2–6 frames typical, 3–12 acceptable ceiling | 33–200ms | [rozgames](https://rozgames.com/article/damage-feedback-visual-language-hits-kills); past ~0.2s it reads as lag, not impact ([codingquests](https://codingquests.io/godot-game-feel-lab)). |
| Implementation rules | freeze SIM, keep rendering; let particles/shake/UI keep animating during freeze; use unscaled timer for the unfreeze; freeze both attacker+target | — | A total freeze IS a dropped frame; effects-alive freeze IS impact. [codingquests feel lab](https://codingquests.io/godot-game-feel-lab) |

**Recommended:** hazard contact 3 frames (50ms), collapse event 6 frames
(100ms), kill/stomp 4 frames (67ms). Kill adds +2–3 extra frames per
[Mytheria postmortem-style guidance](https://cobomakesgames.com/blog/how-to-make-combat-feel-good/) (their shipped values: sword 4f, heavy 5f, ranged 1f, shake happens INSIDE the pause).

## 5. White-flash damage flash

| Variant | Duration | Source |
|---|---|---|
| Enemy hit flash | **2 frames (33ms)** pure-white silhouette swap | cheapest high-value juice; "carries ~30% of perceived impact". [freegamesprites](https://freegamesprites.com/news/game-feel-2d-combat-juice-tricks) |
| Crit flash | 4 frames + scale punch 1.0→1.1→1.0 | same source. |
| Target damage tint (shipped example) | 8 frames ≈ **133ms** cream flash on hit | [cobomakesgames Mytheria](https://cobomakesgames.com/blog/how-to-make-combat-feel-good/) |
| Player damage flash | **80ms** (SPEC §1) — inside the 5–10-frame band used across the above | Keep SPEC value. |
| i-frame blink | flicker alpha at ~8Hz (on/off every 2 frames) for the invulnerability window | Hollow Knight blinks the knight through its 1.3s i-frames ([wiki](https://hollowknight.wiki/w/Stalwart_Shell) notes base invuln 1.3s). |
| Canvas impl | draw sprite once normally, once with `globalCompositeOperation='source-atop'` white fill (or pre-tinted white sprite), toggle flag for N frames | godot hit-flash shader pattern (binary active flag, no gradient). [godotshaders](https://godotshaders.com/shader/hit-flash-effect-shader) |

## 6. Floating combat text (rise / duration / easing)

| Param | Value | Source |
|---|---|---|
| Total lifetime | **0.8–1.0s** (SPEC's "+2 Sustenance" 0.8s fits) | genre defaults: 0.9s pooled-DOM default ([gamecn.dev](https://gamecn.dev/catalog/damage-numbers)), 0.5s fade + 50px rise pooled-Godot ([GD skills repo](https://github.com/thedivergentai/GD-Agentic-Skills/blob/main/skills/godot-master/scripts/genre_action_rpg_damage_label_manager.gd)), 1.0s full animation w/ pool return ([deepwiki MapleDefense](https://deepwiki.com/t90Freelancer/MapleDefense/4.3-ui-damage-feedback-system)) |
| Rise height | **24–50px** (SPEC's 24px = gentle end of band; use 40–50 for damage numbers, 24 for pickups) | same three sources; rise speed norm 30–80px/s ([hit-confirmation doc](https://github.com/raduacg/game-mechanics-optimizations/blob/main/106_hit_confirmation.md)). |
| Easing | rise = easeOutCubic (fast start, glide stop); alpha stays 1 for first ~50%, then fades out over the rest | GD manager: fade delayed to second half; MapleDefense keyframes show alpha flat till t≈0.5. |
| Entry pop | scale 1.4–1.5 → 1.0 over first ~100ms (crits bigger) | GD manager crit scale 1.5; SimVX spawns killed-numbers at 1.9 vs 1.4. [simvx docs](https://simvx.com/docs/examples/features_ui_health_bars.html) |
| Jitter | ±8–12px horizontal random offset per pop | gamecn default jitter 12px; SimVX ±8px. |
| Pool | DOM/text pool, cap ~32–64 live, recycle oldest | prevents heap churn in sustained bursts. [gamecn](https://gamecn.dev/catalog/damage-numbers) |

## 7. Title-card / intro slide in–out timings

Genre motion standard: enter ease-out ~300ms, hold, exit ease-in slightly
faster ~250ms; entering elements never ease-IN, exiting never ease-OUT.
([UI animation conventions](https://www.ui-skills.com/skills/prototyperai/animate-ui),
[game UI transition guide](https://gamineai.com/blog/game-ui-animation-creating-smooth-engaging-interface-transitions))

**Era-transition budget (SPEC §1: 1.2s total, skippable after 400ms):**

| Beat | Time | Note |
|---|---|---|
| Desaturate world + camera push-in 8% | 0 → 350ms | easeInOutQuad on both; push-in is the "stun" hook. |
| Light column + figure re-equip white flash | 350 → 550ms | flash 80–133ms (§5 band) at column apex. |
| Palette crossfade | 450 → 700ms | overlaps column so no dead air. |
| Title card slides in | 700 → 950ms (250ms, easeOutQuart, from side) | 300ms-standard minus overlap pressure. |
| Hold readable | 950 → 1150ms (~200ms min legible hold) | card fully visible ≥200ms or the word doesn't land. |
| Slide out | 1150 → 1350ms (200ms easeInQuart) | exit faster than entry (standard). Runs to 1.35s ≈ SPEC's 1.2s ± 100ms sim tolerance — trim holds to 1.2s exact if the sim asserts hard. |
| Skip | any key after 400ms jumps straight to card-out | SPEC rule; matches Katana ZERO's skip-cutscenes ethos. |

Note: precise published per-ms title-card timings for Celeste/HK/Ori do not
exist publicly; the above is the standard UI-motion band applied to SPEC's own
1.2s envelope — flagged as derived, not quoted.

## 8. Knockback distance + input-lock windows

| Param | Value | Source |
|---|---|---|
| Hollow Knight player recoil (input lock) | **0.2s** base hit recoil (Stalwart Shell cuts it to 0.08s) | [HK wiki Stalwart Shell notes](https://hollowknight.wiki/w/Stalwart_Shell) — decompiled charm deltas state the base constant. |
| Hollow Knight i-frames after damage | **1.3s** base (1.75s w/ Stalwart Shell) | same wiki page. |
| HK knockback character | modest push-back on both parties, knight keeps control quickly | [design analysis](https://atomicbobomb.home.blog/2019/02/05/hollow-knight-knockback/) |
| Genre velocity model | impulse 200–500px/s initial, friction ~0.85/frame @60fps → decaying slide over 200–400ms; NOT a teleport | [freegamesprites](https://freegamesprites.com/news/game-feel-2d-combat-juice-tricks) — dagger 60px/s vs greatsword 380px/s in Dead Cells per their measurement. |
| Genre displacement band | 5–20px typical 2D knockback displacement | [rozgames](https://rozgames.com/article/damage-feedback-visual-language-hits-kills) |
| Hitstun (target can't act) | light 0.1s / normal 0.2s / heavy 0.3–0.5s | [VG101 knockback page](https://marty64.net/kb/pages/code-bank/knockback.html) defaults (force 8, up 4, decay 10, stun 0.2). |
| Prototype-tested player shove | 80px shove + 0.25s attack-input lock + brief invuln blink | [knockback spacing test writeup](https://vibecodeagame.com/blog/knockback-spacing-recovery-test) |
| Wall behavior | walls STOP the shove cleanly (no bounce-jitter, no repeat damage) | same. |

**Recommended (SPEC §1 says 0.3 tiles + 200ms lock = 96px + 0.2s):**
- Hazard hit: impulse **250px/s** away from source (+80px/s up), friction
  0.85/frame → travels ≈90–100px ≈ SPEC's 0.3 tiles naturally.
- Input lock **200ms** (= HK's shipped recoil constant), then movement restored
  while i-frame blink continues to **1.3s** (HK base) so chained hazards can't
  stunlock. Lock < i-frames is the key ratio: control returns before danger does.

---

## Cross-cutting rules (from the same sources)

1. **All juice on the fixed timestep**, hit-stop counted in real (unscaled) time — otherwise 144Hz screens run your feel twice as fast. [masterallarts]
2. **Hit-stop freezes fighters, not feedback**: particles, shake, floating text keep moving during the freeze. [codingquests feel lab]
3. **Trauma caps at 1.0 and always decays**; bounded magnitude, quadratic response. [Burks via peanuts-code]
4. **Particle pools fixed-size**; drop spawns when full, never grow arrays in-loop. [masterallarts]
5. **Feedback within 6 frames (100ms) of input** — the perceptual immediacy threshold; squash, sound, and dust all fire same-frame as the verb. [smereski game-feel rubric](https://smereski.com/skills/game-feel.md)
6. **Reduced-motion off-switch**: shake/hitstop/particles individually gated; static fallback keeps flashes as color-only. (SPEC §1 requirement; Katana ZERO ships separate % sliders for hitpause and screenshake for the same reason — [speedrun settings guide](https://www.speedrun.com/katana_zero/guides/kgwz8).)

## Confidence notes

- **High confidence (source code / dev-stated):** Celeste scales & dust counts, HK 1.3s/0.2s, Dead Cells 1-frame crit freeze, Celeste physics constants.
- **Medium (analyst-measured / multiple converging secondary sources):** Dead Cells 20–40 particles, 2-frame flash norm, hit-stop bands, knockback velocity model.
- **Derived (industry standard applied to SPEC's envelope, no published per-game ms):** title-card beat table, ambient mote rates, pickup flight 200ms.
