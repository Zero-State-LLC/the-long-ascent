# SPEC v7 — Actions: Make It Playable

Status: DRAFT → PR before implementation. Extends SPEC v6 (side-scroller).
Keeps the engine, era spine, encounter system, save migration. Adds the verbs,
stakes, and progression that make it a game instead of a walking tour.

## 0. Problem (user verdict, 2026-10-30)

v6 is playable but passive: you walk, you read, you pick a dialog option.
Nothing to do with your hands. This spec adds **actions** — things you do with
the world that can succeed, fail, or cost you — and **stakes**: hazards that
take resources, pickups that give them, and paths gated on gear.

## 1. New player verbs (input map)

| Input | Action | Notes |
|---|---|---|
| Shift (hold) | **Sprint** | 1.6× run speed, drains stamina; stamina refills when not sprinting. No stamina = no sprint (walk). |
| ↓ (hold, near climbable) | **Climb** | Vine/ladder/rubble props marked climbable; up/down movement on them. |
| C | **Crouch** | Half height; required for some encounters (crawlspaces) and to stay hidden from hazards. |
| X (hold to aim, release to throw) | **Throw** | Throws a held item (stone/torch/spear) in an arc; hits hazards, knocks fruit from trees, rings distant bells. Consumes the held item; press E near piles to restock. |
| E (tap) | **Interact** | Existing encounter prompt (v6). Doubles as "pick up" when near a pickup. |
| Q | **Drop held item** | Frees the hand; held item renders above the figure's head. |
| Esc | close menu (existing) | |

- **One hand.** The figure can hold ONE item (stone/torch/spear/fruit/tool).
  HUD shows it as a small icon next to the resource strip. Throwing/freeing
  the hand is a real decision — torches light caves, spears kill boars, stones
  are free but weak.
- All verbs work with the existing feel constants (no new physics; throw = a
  projectile entity with gravity ×0.8 and a 0.6s fuse).

## 2. World entities (Studio art + Forge code)

- **Pickups** (render from existing prop sheet + a small overlay dot):
  - `grain`, `berry`, `meat` → +Sustenance on pickup (auto-eat).
  - `stone` (infinite piles near rubble), `spear`, `torch` (era ≥1 torches;
    required to enter dark caves), `scroll`/`book`/`chip` → +Knowledge.
  - `coin`, `invoice`, `credit` → +Infrastructure or currency for merchants.
- **Hazards** (2-frame animated, damage on contact unless crouched/dealt with):
  - `boar`, `wolf`, `stray_dog` (eras 1–9): chase within radius 3 tiles;
    contact −2 Sustenance; a thrown spear kills (drops `meat`), a torch scares.
  - `bandit`, `soldier_patrol` (eras 6–14): stand between you and a choke
    point; pay `coin`/`credit`, sneak past (crouch), or throw — each has
    different odds; failure −Legitimacy or −Infrastructure.
  - `smog`, `radiation_zone`, `datastorm` (eras 12–17): zone hazards — walking
    through costs Sustenance/Knowledge per second unless you hold the era's
    counter-item (mask, rad-suit chip, faraday scarf — purchasable from
    merchants or found in wrecks).
- **Terrain interactions:**
  - `fruit_tree`, `berry_bush`, `grain_stalk`: throw to knock loot down, or
    interact to gather (slower, depletes the bush for the run).
  - `ledgevine`, `rubble_ramp`: climbable; some ledges need them placed first
    (throw a rope at marked `anchor` points — one-time, persists in save).
  - `crawl_gap`: crouch-only passage hiding a pickup or a shortcut.
  - `dark_cave` (eras 1–3): pitch black beyond the mouth without a torch.

## 3. Progression gating (the "cooler figure" payoff)

- Each era's choke point (the boundary structure) now has **two doors**: the
  open path (free) and the **advantage path** — a shortcut, a cache, or an arc
  scene — gated by an era-appropriate requirement:
  - era-gear item (bronze sword opens the legion cache),
  - a resource threshold (Infrastructure ≥ 10 buys the merchant's map),
  - a completed action (rung the bell in era 5 → the era-6 merchant stocks
    torches you couldn't afford otherwise).
- Requirements are visible at the door (sign text), so failure is informed,
  not random. The open path always exists — gating grants advantage, never
  hard-blocks progress.

## 4. Encounters gain verbs

- Existing 236 encounters keep prompts/choices, but Scribe marks up to 2
  choices per encounter as **action-choices**: instead of pure dialog they
  demand a verb at the object (`[Climb the granary roof]`, `[Throw the ledger
  into the fire]`, `[Sneak past the guard — Crouch]`). If the player lacks the
  required item/stamina, the choice renders greyed with the requirement text.
- Effects unchanged; action-choices just route through the verb system.

## 5. Death & stakes

- Sustenance ≤ 0 → **collapse**: screen fades, you wake at the last boundary
  with −1 era progress worth of walk-back (no death, no reset — a timeline
  walk shouldn't erase 40 minutes) and lose one non-entropy resource point.
  The collapse reason is shown ("The boar got you").
- Entropy stays the long-leash meter it is; no new fail state.

## 6. Routing (same pipeline, same models)

1. **z0D** — this spec, merged first. ✅
2. **Studio (gpt-luna)** — sprites per §2: hazards ×8, pickups ×10,
   terrain-interaction props ×6, 2-frame each, existing palette contract;
   plus held-item overlays (stone/torch/spear/fruit/tool) 32×32.
3. **Scribe (GLM)** — §4 action-choice markup for 236 encounters (a JSON
   patch: encounter id → up to 2 choices marked `{action: {...}}`), gate/door
   sign lines, collapse lines.
4. **Forge (Qwen)** — verbs, entities, gating, collapse, throw physics, HUD
   hand-slot; integrate Scribe's patch; tests ≥ 140 total.
5. **z0D** — verify (including a full playthrough sim script), deploy, smoke.

## 7. Acceptance

- [ ] Sprint/climb/crouch/throw all work and are testable headlessly.
- [ ] A thrown spear kills a boar → meat drops; a thrown stone does not.
- [ ] Dark cave without torch: screen darkens past the mouth; with torch: lit.
- [ ] Every era's advantage door shows its requirement; open path always open.
- [ ] Action-choices grey out with requirement text when unmet.
- [ ] Collapse at 0 Sustenance wakes at the last boundary with the shown cost.
- [ ] All 236 encounters still resolve; effects unchanged; saves migrate.
- [ ] npm test ≥ 140, zero regressions (117 existing).
