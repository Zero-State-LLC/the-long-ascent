# Visual Assets v7 — World Entities (SPEC §2)

Generator: `tools/gen_v7_entities.py` (stdlib; matches prop-sheet style, era-agnostic neutral palette).

## Hazards (8) — 192x96, 2 frames (idle | active)
hazard_boar, hazard_wolf, hazard_stray_dog, hazard_bandit, hazard_soldier_patrol,
hazard_smog, hazard_radiation_zone, hazard_datastorm

## Pickups (12) — 192x96, 2 frames
pickup_grain, pickup_berry, pickup_meat, pickup_stone, pickup_spear, pickup_torch,
pickup_scroll, pickup_book, pickup_chip, pickup_coin, pickup_invoice, pickup_credit

## Terrain interactables (8) — 192x96, 2 frames
terr_fruit_tree, terr_berry_bush, terr_grain_stalk, terr_ledgevine, terr_rubble_ramp,
terr_crawl_gap, terr_dark_cave, terr_anchor

## Held-item overlays (5) — 32x32 single frame, transparent bg
held_stone, held_torch, held_spear, held_fruit, held_tool

Total new: 33 files. Verified: PNG signatures, exact dimensions (192x96 / 32x32), both frames
non-blank. z0D visual inspection: boar idle/active frames read correctly (red-eye aggression cue).
