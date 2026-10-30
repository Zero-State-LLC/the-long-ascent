# Minigame Copy — SPEC v5 §3 (Scribe deliverable, §5 routing step 2)

For Forge: countdown/caption lines, win/lose quips, and chronicle templates for
the 8 launch families. Tone baseline: `src/data/v3-copy.json` (crossing.win/lose,
crisis_pulses). Terse, wry, ledger-brained; the era is the joke's straight man.

Naming per SPEC.md §8: **no source-novel proper nouns.** Originals only — the
Reef, the Consortia, the Feral — plus the Benthics, who stay as deadpan
creditors. Nothing below uses anything else; generic titles only.

Placeholders: `{score}` = run score, `{reward}` = banked reward string from
`minigames.js` (e.g. `+6 Grain`). Reward strings in the win quips use the era's
`sustenanceLabel` / pool name — see the per-family notes. Badges reuse the
existing `assets/sprites/badge_*.png` set (v5 spec §2: no new badges); suggested
badge per family below, all existing files.

Caption constraint (§4): the stage caption flips to
`MINIGAME — <NAME> · ↑↓←→ MOVE · SPACE ACT`. Countdown lines replace the
3-2-1 digits on the stage canvas; keep each ≤ ~40 chars so it fits one line at
current type scale.

---

## 1. Granary Handout (Eras 2–3 · Agriculture, Bronze & Empires)

Mechanic: catch falling grain, avoid stones. Reward pool: sustenance
(Era 2 label *Grain*, Era 3 label *Coin*). Suggested badge: `badge_surplus.png`.

**Countdown / stage captions**
- `THE HANDOUT IS NOT FREE. CATCH.`
- `GRAIN UP. STONES DOWN. CHOOSE RIGHT.`
- `THE SCALES ARE WAITING. GO.`

**Win**
> The basket fills, the scales tip your way, and the scribe records it without a single asterisk — a first in this era's administration. {reward}

**Lose**
> Stone by stone, you learned which ones were heavy. The granary logs a shortfall; the granary always logs something. {reward}

**Chronicle template**
> In the handout line, the lineage caught {score} against a falling sky of grain and grievance, and left with {reward}. The stewardess called it efficiency. It was appetite, organized.

---

## 2. Scribe Speed (Eras 4–5 · The Dark Ages, Renaissance & Print)

Mechanic: glyph sequence flashes, walk to the matching pillar. Reward pool:
knowledge. Suggested badge: `badge_print.png`.

**Countdown / stage captions**
- `WATCH THE GLYPHS. REMEMBER IS CHEAP.`
- `PILLARS UPRIGHT. MEMORY OPTIONAL.`
- `THE COPY DESK OPENS NOW.`

**Win**
> Every glyph in order, every pillar walked, not one letter lost to the candle smoke. The archive grows by your handwriting. {reward}

**Lose**
> You remembered most of it. Most is how centuries get misfiled — the copy desk will do better next time, said no copy desk. {reward}

**Chronicle template**
> At the copy desk the lineage repeated {score} glyphs to the correct pillars, some from memory, all from nerve, and banked {reward}. The archivist stopped asking who taught you.

---

## 3. Trade Winds (Eras 6–7 · The Age of Sails & Empires, Revolution & Empire)

Mechanic: steer a cargo skiff between wave rows, collect crates, dodge reefs.
Reward pool: infrastructure. Suggested badge: `badge_sails.png`.

**Countdown / stage captions**
- `WIND'S UP. CRATES UP. REEFS DOWN.`
- `THE LANE IS OPEN. INSURANCE ISN'T.`
- `STEER. THE INVOICE WILL FIND YOU.`

**Win**
> The skiff comes through the rows loaded and unpunctured, which the underwriters will call luck and the crew will call steering. {reward}

**Lose**
> The reef filed its report first. Cargo light, hull opinionated, timeline intact — the ocean counts arrivals, not apologies. {reward}

**Chronicle template**
> The lineage ran the wave rows for {score}, took on crates and opinions about the weather, and delivered {reward}. The harbor log credits the wind. The crew logged otherwise.

---

## 4. Chimney Sweep (Eras 8–9 · Steam & Industry, The American Century)

Mechanic: dodge falling soot, catch sparks to bank momentum. Reward pool:
population. Suggested badge: `badge_factory.png`.

**Countdown / stage captions**
- `SOOT DOWN. SPARKS UP. DON'T MIX.`
- `THE FLUES ARE HOT. SWEEP ANYWAY.`
- `MOMENTUM BANKS TODAY. PAYS LATER.`

**Win**
> Out of the flue sootier than the chimney and twice as rich in sparks. The foreman counts heads; all of them are still yours. {reward}

**Lose**
> The soot won the argument it always wins. The shift ends early, the washwater goes gray, and the momentum account posts a withdrawal. {reward}

**Chronicle template**
> Up and down the flues the lineage banked {score} in sparks between showers of soot, and came out with {reward}. The payroll lists everyone. Barely, and on purpose, everyone.

---

## 5. Fallout Sprint (Eras 10–11 · The World Wars, Atomic)

Mechanic: zigzag under falling debris, shelter gates open/close. Reward pool:
legitimacy. Suggested badge: `badge_mobilize.png`.

**Countdown / stage captions**
- `DEBRIS INBOUND. GATES HAVE HOURS.`
- `ZIGZAG IS A STRATEGY. USE IT.`
- `RUN THE STREET. MIND THE SKY.`

**Win**
> Every gate threaded, every headcount accounted for at the far end. The wardens file it clean; the Chronicle files it louder. {reward}

**Lose**
> The street kept some of its people this round. The sirens end, the roll gets read twice, and the line still holds — thinner, holding. {reward}

**Chronicle template**
> Under a falling sky the lineage crossed the block for {score}, trusting gates that closed for reasons, and returned with {reward}. The wardens' report says orderly. The Chronicle says close.

---

## 6. Carbon Run (Eras 12–13 · The Space Age, The Green Transition)

Mechanic: sort drifting emissions into three scrubber lanes. Reward pool:
entropy − (this is the counter that never goes down; treat the minus sign as the
punchline). Suggested badge: `badge_carbon.png`.

**Countdown / stage captions**
- `SORT THE PLUME. ALL THREE LANES.`
- `THE COUNTER NEVER GOES DOWN. TRY.`
- `EMISSIONS DRIFTING. BINS OPEN.`

**Win**
> The plume sorts cleaner than any committee managing it, and for one run the impossible counter moves the wrong way — downward. {reward}

**Lose**
> Some of the plume finds the lane you didn't watch. The counter notes your effort in its own handwriting: still up. {reward}

**Chronicle template**
> The lineage sorted {score} loads of drifting emission into bins that arrived too late to be elegant, and got {reward}. The Benthics credited the attempt anyway. Their interest rate did not.

---

## 7. Signal Drift (Eras 14–15 · The Digital Dawn, The Connected Age)

Mechanic: keep a wandering signal inside a moving band (balance). Reward pool:
morale — render as Attention/Morale per era label (*Compute*, *Attention*);
Forge maps to whichever pool morale uses. Suggested badge: `badge_drift.png`.

**Countdown / stage captions**
- `HOLD THE BAND. IT WON'T HOLD BACK.`
- `SIGNAL WANDERING. ATTENTION? YOURS.`
- `STAY INSIDE. THE BAND MOVES FIRST.`

**Win**
> The signal stays in the band so long the band starts following it. Somewhere a feed mistakes consistency for content and celebrates. {reward}

**Lose**
> The signal wanders out mid-cheer and the audience reboots onto something worse. The carrier hums politely. The carrier always hums. {reward}

**Chronicle template**
> For {score} seconds of held tone the lineage kept the signal inside a band that wanted it out, and collected {reward}. The network logged it as engagement. It was attention, which is rarer and worse-priced.

---

## 8. The Crossing II (Eras 16–17 · The Long Silence, The Singularity & Beyond)

The existing game (v3 `crossing.copy`), now also triggered mid-era. Keep the v3
copy verbatim where the full-screen event fires; the lines below are for the
mid-era trigger only, so the two contexts don't collide. Reward pool: sustenance
+ knowledge (per v3 §11). Badge: `badge_void_pilot.png` (existing).

**Countdown / stage captions**
- `THE LANE AGAIN. YOU KNOW THE DEBRIS.`
- `TAKE THE STICK. IT WAS ALWAYS YOU.`
- `GATES ARMED. VOID INDIFFERENT. GO.`

**Win**
> Clean through, again — the lane has started recognizing you, which in this corridor counts as a reputation. {reward}

**Lose**
> Debris accumulates opinions faster than warranties. The ship reaches the gate minus a rounding error the Benthics will itemize. {reward}

**Chronicle template**
> Mid-crossing, because the void does not schedule appointments, the lineage threaded the lane for {score} and arrived with {reward}. The payment schedule remains confident of your arrival.

---

## Integration notes for Forge

- Esc-forfeit (§4) needs no copy beyond the shared caption `FORFEITED. NOTHING
  BANKED. THE LEDGER FORGETS NOTHING.` if a toast is wanted; median-reward
  calm-mode can reuse each family's win line with the reward substituted — or
  stay silent, your call, nothing here blocks it.
- End screen (§4): show win/lose quip + `{reward}` delta chips (§9.2). Quips are
  written to stand alone at ≤ 2 lines in the card width.
- Chronicle: one entry per play (§2 persistence keeps last score per family);
  templates above are single-sentence-plus, chapter-card compatible.
- All 8 win lines and lose lines verified against §8: no source-novel proper
  nouns; only Reef / Consortia / Feral / Benthics appear as originals, and only
  Benthics are used above (families 6 and 8, their creditor voice).
- Rate limits (§3: ≤2 triggers/era) mean repeat plays within one era should vary
  nothing — copy is static per family; variance lives in `{score}`/`{reward}`.
