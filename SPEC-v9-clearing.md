# SPEC-v9: THE CLEARING — Hybrid Narrative/Action Fusion

**z0D orchestration doc · 2026-11-01 · based on Scout research `research/design-v9-scout.md` (this PR)**
**Supersedes:** nothing — v8 juice layer ships as-is and is preserved. v9 re-architects presentation & coupling.

## 0. Verdict being fixed

Player on v8: *"the guy jumps around but the game itself is nonsensical."* Structural cause
[verified]: `entities.js` touches resources only via contact penalties; the 236 encounters
arrive as position-triggered modals. The layers are adjacent, not coupled. Additionally five
presentation defects (boar-block, black screen, HUD-over-player, left-edge text overflow,
dead bottom half) are root-caused in the research doc §0/§4 with verified evidence.

**v9 thesis (one sentence): your body arrives at the question carrying what your choices made it.**

## 1. Design: Direction A+ (Scout §3) — normative

1. **Stations as spine.** Encounters become in-world stations (firelight glow visible from
   screen edge). Approaching within 40px: world desaturates, sim freezes (tick paused, world
   keeps painting), fixed **lower-third chrome panel** shows title/prompt/choices. Stat deltas
   hidden until commit; consequence beat (≤3s) plays on resume — delta lands visibly (bar
   pulse + prop spawn/scorch). All 236 encounters reused verbatim from
   `research/encounters-v6.json`. `encounters.js` ready/prompt/active FSM is the contract.
2. **Micro-fork at era tails.** Before each boundary stone the ground splits into two
   x-ranges (`route: 'ridge'|'valley'` tags in world segments) with different encounter/spawn
   density, rejoining at the stone. No vertical lanes, no camera changes. Route choice =
   which ~⅔ of the era's stations you meet. Era report card lists missed stations.
3. **Ambient hooks (zero new systems).** `echoes-v8.json`/`collapse-v8.json` copy fires as
   fixed-caption one-liners on context triggers (first hazard death of an era, era entry with
   <30 sustenance, arc conditions). No pause, no interaction.

**Pacing:** 4–6 stations per era → a text pause every 30–60s of walking (FTL rhythm, not
visual-novel rhythm). Density is a data knob (`spawn-tables-v7.json`), not code.

## 2. Coupling requirements (the anti-"nonsensical" clause)

- **Action feeds choice:** current pools, held items, and hazard scars gate/recolor station
  choices. `actionChoices.js` requirements render dimmed-with-reason ("You have no grain to
  give"). A station whose every choice is dimmed offers a guaranteed **"Walk away"** row
  (entropy +1) — soft-lock impossible.
- **Choice feeds action:** every resolution mutates the traversed world (funded granary prop
  persists, spawn density next era shifts with legitimacy, entropy tier re-colors zones).
- Hazard contact drains the same six pools the stations read. Never instant-death.

## 3. Input map (normative; one-handed laptop)

←/→ or A/D walk · ↑/W/Space jump (hold=higher) · ↓/S crouch-hold (C toggle **removed**) ·
E ask/interact (station-only trigger) · X hold→release throw · Shift sprint · ↑↓⏎ station
panel nav/commit · Esc leave station unresolved (stays READY) · Tab era almanac (pools +
visited/missed stations). **Mouse fallback removed — keyboard-only mandate.**

## 4. Defect-kill rules (each with an acceptance test)

| # | Rule | Acceptance test |
|---|------|-----------------|
| D1 | **Entity render contract:** every entity declares `{src, srcW, srcH, destH}`; blit computes `destW = destH×srcW/srcH`, feet-anchored; missing/broken src throws loudly in dev; fallback = labeled silhouette, never anonymous rect | fixture atlas → expected dest rect per entity type; boar destW ≈ 2×destH |
| D2 | **Fail-visible render loop:** `frame()` wraps update+paint in try/catch; paints diagnostic stripe on last-good framebuffer (offscreen copy committed per successful frame); 3 consecutive faults → auto-pause + toast. Loop never dies | inject throwing paint stub → loop survives, stripe visible, rAF continues |
| D3 | **Fixed chrome regions:** all persistent UI (HUD/era strip, station panel, prompts, whispers) in fixed top/bottom DOM bands; diegetic text only inside world rect; `positionWorldElement` **deleted** | fake-DOM boot → panel roots' parents are chrome containers |
| D4 | **Measured & clamped text:** single `drawClampedText` helper (wrap to worldRect−2·MARGIN, clamp origin, ellipsize). No bare `fillText` in render paths | helper unit tests incl. negative-x anchor case |
| D5 | **One authority geometry:** single `layout()` → uniform `scale=min(vw/W,vh/H)`, dpr-aware backing store, centered, exports `worldRect`; surplus on non-16:9 goes to chrome, never dead space; resize re-runs layout before next frame | fake window sizes → worldRect ≥85% viewport area; no input maps outside it |

## 5. Screen architecture

Scout §3 ASCII map is normative: CHROME-TOP (era, progress hairline, six mini-bars) /
WORLD LAYER (letterboxed canvas; everything diegetic) / CHROME-BOTTOM (idle: key-hint strip;
active: station panel with wrapped/clamped prompt, dimmed choices with reasons, ↑↓⏎ hint).

## 6. Fail states (unchanged mechanics, new presentation)

Sustenance 0 → collapse (existing `collapse.js` + cause copy) → respawn at era start with
scar ledger (entropy +2 kept); resolved stations stay resolved within the era.

## 7. Reuse / migration (Scout §5 normative)

**Unchanged:** tick.js (+`paused` flag, ~5 LOC), player.js, feel.js, camera.js,
encounters.js, actionChoices.js, collapse.js, save-v6.js, gates/crossingGate, sfx.js,
figure.js, hud.js (re-parented into chrome-top), all research/*.json verbatim, all v8 art.
**Modify:** scroller-boot.js → split `src/ui/chrome.js` + `src/ui/worldview.js`; styles.css
chrome-band grid; world.js micro-fork segments; entities.js hazard-hit→ledger hook.
**Delete:** positionWorldElement path, pointer shim, C crouch-toggle.
**Budget:** ≈ +450/−350 net on 5,606; ≤12 test files migrate with documented mapping;
15–20 new tests (one per acceptance row in §4 + station pause/resume + walk-away).

## 8. Verification bar (merge gate)

1. `node --test tests/*.test.mjs` — all existing migrated + new v9 tests, 0 skipped.
2. `tools/sim-playthrough-v9.mjs` — bot traverses era 1→2 end-to-end: passes a station
   (commits a choice), leaves one unresolved via Esc, takes both fork routes across runs,
   survives an injected paint exception (D2 live check).
3. Asset audit: every entity blit passes the render contract against its actual PNG.
4. Live browser smoke (orchestrator): 60s of real arrow-key play in foreground tab — station
   opens/closes, no black screen, no text overflow, HUD in chrome, boar is a boar.
5. Banned-noun scan (SPEC §8 rule) on all new copy.

## 9. Pipeline assignments

- **Scribe (v9 copy pack):** missed-station report lines (per era, 2–3 variants), walk-away
  row strings, dimmed-reason templates, almanac labels, render-fault copy. →
  `research/v9-copy.json` + PR.
- **Studio (v9 art):** station glow marker frames, consequence-beat prop deltas if missing,
  entity manifest (`{src,srcW,srcH,destH}` per entity) validated against actual PNGs,
  chrome styling tokens. → assets + `research/visual-assets-v9.md` + PR.
- **Forge (v9 engine, Spark GLM):** everything in §7 Modify + §4 rules + §8 gates 1–3. → PR.

Standing rules hold: spec-PR-first, every turn a PR, no #aspire pings, no self-approval,
Pawl gates apply.
