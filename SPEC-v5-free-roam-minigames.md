# SPEC v5 — Free-Roam Figure + Era Mini-Games

Status: DRAFT → PR before implementation. Extends SPEC v4 §2; adds §13.
Foundation: v4 shipped (PRs #20–#22): stage/ledger card, `src/ui/stageWalk.js`
controller, `src/render/stagePainter.js`, `src/core/crossing.js` minigame pattern.

## 0. Goal (user directive, 2026-10-30)

1. **Free movement**: the stick figure moves in 2D with the keys — not just
   walk-to-marker along a floor line.
2. **Something playable**: real mini-games, not just walking.
3. **Mini-games per stage (era)**: each era gets at least one themed mini-game,
   reusing The Crossing's run/seed/quality patterns.

## 1. Free-roam movement (stageWalk v2)

- Extend the controller to **normalized 2D position** `(x, y)` — x unchanged,
  y ∈ `[floorTop, 1]` band (the walkable strip between horizon and stage bottom).
- **Arrow keys / WASD** move freely; walking **up/down** uses the costume sheet's
  existing frames (no new art required — the sheet has no back-view cells; the
  figure just translates, flip x when moving left via ctx.scale(-1,1)).
- **v4 arm-on-marker is preserved** when a card has choices: markers stay on the
  floor line; walking vertically never arms/disarms (arm radius checks x only,
  and only when y is on the floor band).
- **Idle drift**: when not in a minigame, the figure eases back to the floor line
  after 4s of no input (keeps composition tidy; reduced-motion: instant snap).
- Keyboard capture rules from v4 §2 unchanged (no page scroll while card open).
- Tests: 2D movement, clamping, marker-arm unchanged on floor band, drift-back,
  reduced-motion paths. Pure module, DOM-free, as before.

## 2. Mini-game framework (§13)

New module `src/core/minigames.js` + renderer `src/render/minigameStage.js`,
following the `crossing.js` contract exactly:

```
createRun({ seed, difficulty, reducedMotion }) -> run
run.step(dt, input) -> { done, won, score, reward }
```

- **Input**: the same keyboard adapter (arrows/WASD/Space/Enter); touch/click
  parity: pointer position acts as a virtual stick where sensible.
- **Trigger**: each era defines one minigame in `eras.json` via a `minigame` key:
  `{ "type": "granary", "intervalTicks": 40, "reward": {...} }`. When it fires,
  the stage canvas becomes the play field (full stage area, ledger dims to a
  scoreboard) — **no separate screen**, the card context stays.
- **Difficulty** scales from Entropy + era index (same curve as Crossing).
- **Rewards**: score converts to era-resource deltas (capped, spec'd per game)
  + a badge per game family (reuses badge_*.png set, no new badges).
- **Reduced motion**: every game has a "calm mode" (auto-resolve with median
  expected reward, no animation) — parity with Crossing's skip.
- **Seeding**: `mulberry32(strSeed)` per run; no Math.random in game logic.
- **Persistence**: last score per game family in save state for the chronicle.

## 3. Era mini-games (launch set: 8 families covering 17 eras)

Each family = one mechanic, themed per era via palette + prop sprites already in
`assets/sprites/`. No new sheets required for v5 launch (Forge may reuse
scene/costume cells; Studio polish pass can come later as v5.1).

| # | Family | Eras | Mechanic (30–45s) |
|---|--------|------|-------------------|
| 1 | **Granary Handout** | 2, 3 | Move left/right to catch falling grain, avoid stones. Reward: sustenance. |
| 2 | **Scribe Speed** | 4, 5 | Memory: glyphs flash in a sequence, walk to the matching pillar. Reward: knowledge. |
| 3 | **Trade Winds** | 6, 7 | Steer a cargo skiff between wave rows; collect crates, dodge reefs. Reward: infrastructure. |
| 4 | **Chimney Sweep** | 8, 9 | Dodge falling soot, catch sparks to bank momentum. Reward: population. |
| 5 | **Fallout Sprint** | 10, 11 | Zigzag under falling debris; shelter gates open/close. Reward: legitimacy. |
| 6 | **Carbon Run** | 12, 13 | Sort drifting emissions into scrubber bins (3 lanes). Reward: entropy −. |
| 7 | **Signal Drift** | 14, 15 | Keep a wandering signal inside a moving band (balance mechanic). Reward: morale. |
| 8 | **The Crossing II** | 16, 17 | The existing Crossing game, now also triggered mid-era (not only at 16). |

- 1 Cave: no minigame (tutorial era; walking itself is the toy).
- Every game: max **2 triggers per era** per lineage (opportunities.js-style
  rate limit), never during crisis pulses or The Crossing screen.
- Reward caps: ≤ 8 points of one resource per win; score→reward curve in
  `minigames.js` (documented constant table, tested).

## 4. UI

- Minigame start: stage caption flips to `MINIGAME — <NAME> · ↑↓←→ MOVE · SPACE ACT`
  and a 3-2-1 countdown on the stage canvas. Esc forfeits (median reward, none
  banked). Enter confirms end screen → ledger shows delta chips (existing §9.2).
- Scoreboard in ledger while playing: score / par / time left. No new HUD chrome.
- The v4 walk mode remains the default state of the stage; minigames are an
  overlay state of the same canvas.

## 5. Routing

1. **This spec PR** merges first.
2. **Scribe** — flavor: countdown lines, end-screen quips per family, chronicle
   entry templates (`research/copy-minigames.md` → Forge integrates). Small PR.
3. **Forge** — §1, §2, §3, §4 in one PR: stageWalk v2 + framework + 8 families +
   tests (per-family step/sim tests + stageWalk v2 tests). Target ≥ 110 tests.
4. Studio: **not needed for launch** (reuse existing sheets). v5.1 art polish is
   a separate spec if the games read poorly.
5. z0D: verify (tests + browser sim of each family via synthetic keys), merge,
   deploy, cache-bust, live smoke on at least Granary Handout and Carbon Run.

## 6. Acceptance

- [ ] Figure roams the full walkable band with arrows/WASD; v4 marker-arming
      still works for choice cards; page never scrolls.
- [ ] Each of the 8 families: deterministic under seed, winnable at difficulty 0,
      unwinnable-proof (no softlock) at max difficulty, calm-mode parity.
- [ ] Rate limits: ≤2/era/lineage; never during crisis pulse or Crossing.
- [ ] Rewards land in the normal resource pools and appear as delta chips.
- [ ] npm test ≥ 110 passing, zero regressions (incl. 77 existing).
- [ ] Live smoke: two families played end-to-end with synthetic keys.
