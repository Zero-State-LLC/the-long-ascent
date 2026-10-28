# THE LONG ASCENT — Game Design Spec v1.0
**z0D orchestration doc · 2026-10-28 · Stick-figure accelerationist RPG, inspired by Charles Stross's *Accelerando* (unaffiliated homage)***

---

## 1. Vision

One line: **You are a lineage, not a person.** From a fire in a cave to copies of
yourself crossing interstellar voids, every era you survive rewrites what "you" means.

- **Genre:** Idle-adjacent incremental RPG with branching narrative choices.
- **Tone:** *Accelerando*-adjacent — exponential dread + gallows humor. The stick
  figures get smarter, richer, stranger; the game's art never changes complexity,
  only its *vocabulary* (a stick figure with a spear, a stick figure in a suit, a
  stick figure rendered as distributed substrate).
- **Core loop:** Allocate Resources → trigger Events → make Choices → Era advances
  when its progress bar fills → inherit modifiers into next Era.

## 2. The Eleven Eras (fixed spine)

| # | Era | Signature resource | Signature mechanic |
|---|-----|--------------------|--------------------|
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
| 11 | The Singularity & Beyond | Compute² / Selfhood | Upload, fork copies, star-system colonization; the "endgame" is a management sim |

Era transitions are the *set pieces*: each is a full-screen narrative moment with 2–3
branching choices whose consequences ripple forward (e.g. skipping Fire mastery in
Era 1 locks a later "Promethean" branch).

## 3. Systems

### 3.1 Resources (unified model)
Six persistent pools that re-key per era: **Sustenance** (food→grain→coin→faith→books→
coal→oil→fissile→compute→attention→selfhood), **Knowledge**, **Population** (becomes
"instances" late-game), **Infrastructure**, **Legitimacy**, **Entropy** (pollution/
risk; never goes down easily).

### 3.2 The Lineage mechanic (the heart of the game)
Your "character" is a **lineage**. Each Era, your protagonist can: die (replaced by
heir, -10% of one resource), fork (post-upload: split into copies with stat divergence),
or merge (copies recombine, +synergy, -diversity). The stick figure on screen is
always "the current carrier." Copy count is a late-game resource AND a late-game
problem (copy-drift events: your forks develop opinions).

### 3.3 Choices & memory
Every choice is logged to the **Chronicle**. Late-era events reference Chronicle
entries (a Dark Age monastery choice resurfaces in the Digital Dawn as "you find
the digitized archive"). ~120 branching events across eras, each with 2–4 options,
flag-gated.

### 3.4 Endings (post-Singularity, 5 endings)
1. **The Diaspora** — forks seed 3+ star systems, lineage continues.
2. **The Cathedral** — one merged self, maximally powerful, utterly alone.
3. **The Long Stutter** — entropy wins; the last copy powers down.
4. **The Bureaucracy of Ghosts** — copies spend eternity litigating inheritance.
5. **The Ascension** — the lineage becomes incomprehensible; the game ends in
   stick figures turning into pure geometry.

## 4. Platforms — single codebase, three targets

**Core:** TypeScript, no frameworks for game logic. Engine: **Canvas 2D with a
DOM/HTML UI shell** (stick figures are procedurally drawn, so "art" is code +
palette swaps; this is why Studio's asset list is small and Studio's brief is
*prompt-cards + reference sheets*, not hundreds of files).

| Target | Wrapper | Notes |
|---|---|---|
| Web (primary) | Static site, PWA manifest | Deploys to zer0state.com/games/the-long-ascent/ |
| iOS | Capacitor | Same TS core; native shell, App Store icons/splash |
| Android | Capacitor | Same; Play Store listing assets |

Rules for Forge:
- `src/core/` = pure game logic, zero DOM imports (unit-testable in node)
- `src/render/` = Canvas stick-figure renderer (parametric poses, era palettes)
- `src/ui/` = DOM screens (chronicle, choices, resource bar, settings)
- `src/data/` = JSON eras/events/copy (Scribe's content lands here)
- `tests/` = node test runner: era progression, save/load, every event reachable,
  no dead-branch states
- Offline-first: all assets local; localStorage + export/import save codes

## 5. Agent Deliverables

| Agent | File(s) | Contract |
|---|---|---|
| **Scout** (bosgame Qwen3.8) | `research/source-digest.md` | ≤120 lines: the source novel's actual plot beats/terminology (Manfred, the Lobsters, the Vile Offspring, economic aliens, the router), historical-era flavor hooks worth stealing, and 10-15 concrete event ideas mapped to eras. Practical, no fluff. |
| **Studio** (gpt-6-luna) | `research/visual-assets.md` | Complete asset map: parametric stick-figure pose list per era (prop + palette), background/style tokens per era, UI element inventory, icon set, app icons/splash for iOS/Android. Deliver as structured markdown tables; NO image files yet. |
| **Scribe** (GLM) | `research/copy-deck.md` | Full copy deck keyed by era: 11 era intro cards (80-120w each), 12+ event texts each era (title+body+2-4 choices w/ flavor), Chronicle line templates, UI strings, 5 ending texts (150-200w), store listings (App Store + Play, 400w). Voice: dry wit, Stross-adjacent. |
| **Forge** (GLM) | the codebase | Implements §4 exactly; era data driven by `src/data/eras.json` + `events.json` so Scribe's deck drops in without code edits. Test suite must exit 0. |

## 6. Orchestration plan (z0D)

1. ✅ This spec (now)
2. Repo: `Zero-State-LLC/the-long-ascent` (public, MIT, TS skeleton by z0D)
3. Parallel dispatch: Scout + Studio + Scribe (independent)
4. Scribe content → Forge integrates via JSON (no rewrites)
5. Forge: tests exit 0 → z0D verifies → web deploy to zer0state.com/games/the-long-ascent/
6. iOS/Android Capacitor shells built, not shipped to stores yet (no certs on hand)
7. Post build + link to #aspire

## 7. Working name
**THE LONG ASCENT** — final name. Repo: `the-long-ascent`.
