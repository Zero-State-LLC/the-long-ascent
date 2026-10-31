# SPEC v8 — Undeniable: Game-Feel, Juice, and Depth

Status: DRAFT → PR before implementation. Extends v7 (actions layer intact).
Goal: the difference between "features exist" and "this feels great." Every
item here is a felt-quality improvement, verified by feel tests and a
playthrough sim, not by feature count.

## 0. The bar (user directive, 2026-10-31)

"Iterate and make it better, **undeniable**." The v7 build works; now it must
*feel* undeniable: every action responds, every hit lands, every era stuns.

## 1. Game-feel juice (Forge — the core of this spec)

All effects respect `prefers-reduced-motion` (off → static, no shake).

- **Input → response:** every verb gets a visible same-frame reaction: squash
  & stretch on jump/land (scale y 0.85 landing, 1.12 rising), dust puffs on
  landing/sprint direction change, stamina bar pulse when drained to <20%.
- **Screen shake:** 2px/120ms on hazard contact, 4px/200ms on collapse,
  1px/80ms on heavy landings. Camera shake is additive to the existing camera.
- **Hit feedback:** hazard contact flashes the figure white 80ms + knockback
  0.3 tiles + 200ms input lock. Throwing plays a whoosh + arc trail (8-point
  ribbon). Projectiles spin while airborne.
- **Pickup juice:** floating "+2 Sustenance" text rising 24px over 0.8s,
  item flies to the HUD slot (200ms ease-in), soft chime per resource color.
- **Encounter feel:** menu opens with 120ms scale-in; chosen action pulses the
  object; greyed requirements shake subtly when clicked (denied feedback).
- **Era transitions (the stun moment):** 1.2s sequence — world desaturates,
  camera pushes in 8%, boundary structure emits a light column, figure re-equips
  with a white flash, palette crossfades, then a title card ("ERA VII — THE
  INDUSTRIAL AGE") slides in and out. Skippable with any key after 400ms.
- **Audio:** 12 SFX (jump, land, pickup×3 by resource class, throw, hit,
  collapse, gate-open, era-transition swell, denied-buzz, menu-click) + 3
  ambient beds crossfading by era group (1–5 acoustic, 6–11 industrial,
  12–17 electronic). WebAudio synth, no asset downloads.

## 2. Depth: systems that reward mastery

- **Combo gathering:** gather actions within 3s of each other chain (×1.2,
  ×1.4, ×1.6 yields, capped ×2) — rewards routing planning. Chain HUD shows
  the multiplier; breaks on damage or 3s idle.
- **Hazard mastery:** each hazard family has a counter-move that becomes more
  effective with use (throws stun boars 1s after your 5th boar kill — learned
  from a persistent per-family counter in the save).
- **Era scores:** per-era report card at each boundary (time, resources gained,
  encounters resolved, style points from combos) — 3 stars max, saved, shown
  on the run summary. Stars from: all encounters ≥1 choice resolved, no
  collapse, combo average ≥ ×1.3.
- **Daily walk (optional, off by default):** seeded daily modifier (one hazard
  buff + one reward buff per day) — opt-in from settings.

## 3. Content depth (Scribe)

- **Ambient world lines:** 3–5 one-line thoughts per era, shown in a whisper
  bubble above the figure every ~45s of walking ("The ice remembers nothing.")
  — Scribe writes 17×4 = 68 lines.
- **Encounter follow-ups:** for the 154 action-marked encounters, a one-line
  consequence echo that appears as a sign near the NEXT boundary ("The granary
  you funded stands empty now.") — 154 lines, id-keyed.
- **Collapse reasons:** 8 variants keyed to the damage source.

## 4. Art additions (Studio)

- 8 particle sprites (16×16, white base, tinted by code): dust, spark, leaf,
  snow, ash, star, drop, glyph.
- Era title-card background strip (1024×120 per era, palette sky+ink).
- 3-item held-state recolors (torch lit/unlit, spear thrown/plain) — small.

## 5. Verification bar (higher than prior specs)

- Forge: all juice behaviors unit-tested (shake magnitudes/durations, squash
  scale values, combo multiplier progression, star thresholds); full suite
  ≥ 200 green; **zero regressions on 179**.
- **Playthrough sim (tools/sim-playthrough-v8.mjs):** scripted full walk of all
  17 eras asserting: every encounter reachable, every gate's open path passable
  in under 30s of sim, collapse/recover works from every era, combo chain
  math exact, era transition completes in 1.2s ± 100ms.
- z0D: browser smoke in a foreground tab (real input events: jump squash,
  throw trail, pickup flight, era transition), then deploy + live check.

## 6. Routing (same stack)

1. **z0D (GLM)** — this spec. ✅
2. **Scout (Qwen)** — juice research: exact squash/stretch values, shake
   durations, particle counts/rates, and title-card timings from celebrated
   2D games (Celeste, Ori, Dead Cells) → `research/juice-numbers-v8.md`.
3. **Studio (gpt-luna)** — §4 sprites + confirm SFX names.
4. **Scribe (GLM)** — §3 copy: 68 ambient lines, 154 echo lines, 8 collapses.
5. **Forge (Qwen)** — §1, §2, §5 sim script.
6. **z0D** — verify all, deploy, live smoke.
