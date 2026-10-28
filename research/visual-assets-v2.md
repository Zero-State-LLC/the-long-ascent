# The Long Ascent — Visual Asset Manifest v2

Generated asset package for the §4 visual contract. Sheet coordinates are row-major, origin top-left. PNGs are opaque sRGB except transparent badge icons. Visual motifs follow `research/visual-assets.md`; silhouettes remain bold and readable at native 128×256, 160×180, and 24×24 sizes. All in-world labels are generic; there are no source-novel proper nouns. Benthics are retained as the lobster-derived AI creditors.

## Animation contract

| Family | Frames / dimensions | Playback | Loop / outcome |
|---|---|---|---|
| Carrier costume | 4 × 128×256, sheet 512×256; order idle, action-A (work/build), action-B (threat/conflict), reaction (win/loss) | 6 fps default, 4 fps reduced motion | Loop all four as pose cycle; reaction can be held one-shot 1 cycle |
| Scene | 8 × 160×180, sheet 1280×180; first 5 frames form the loop, final 3 are choice outcome | 8 fps | Loop frames 0–4 while open; play 5–7 once on selection, then advance |
| Background | 2 × 320×180 seamless horizontal frames, sheet 640×180 | continuous translation; far 0.12× / near 0.35× era tempo | Infinite wrap; loop seam repeats motifs at strip edges |
| Badge | 24×24 transparent PNG | static overlay | Persists for milestone lifetime; replace/carry per era rules |
| BGM | 12-second synthesized ambient loop delivered OGG + MP3 for each era and title | continuous | Loop; crossfade on era transition. Source synthesized tracks are short previews of the requested ~60s mood, not 60s compositions. |
| SFX | OGG, one-shot | native duration (0.7s typical, transition 2s, ending stings 4s) | Never loop |

## Era palette mapping

| Era id | Background / ink / accent / secondary | Visual direction |
|---|---|---|
| cave | `#211A18` / `#E9D9B8` / `#FF7A32` / `#6A4130` | Ember, cave arcs, hunched carrier |
| agriculture | `#D8C58B` / `#3F4A32` / `#D49B3B` / `#71884D` | Furrow earth and grain |
| bronze | `#B87955` / `#382D32` / `#D5A64B` / `#9F3F36` | Terracotta, civic bronze and empire red |
| dark_ages | `#283344` / `#D0C8B7` / `#E5B95E` / `#68758A` | Deep blue, candle gold, manuscript cloth |
| renaissance | `#E6D7B7` / `#3D3A37` / `#8B3F3B` / `#477C78` | Parchment, print red, discovery teal |
| industry | `#4A4B4B` / `#E0D2B8` / `#D18A42` / `#899397` | Soot, iron and warning amber |
| american | `#32617A` / `#F1E5CF` / `#C84D46` / `#34383B` | Mid-century blue, cream, red and oil |
| atomic | `#202A32` / `#DCE5D5` / `#A8D879` / `#E65B4B` | Concrete, phosphor and alert red |
| digital | `#111D2B` / `#BFE8E5` / `#54D6C8` / `#F3C969` | Terminal dark, compute teal, signal gold |
| connected | `#29283F` / `#EEE8FF` / `#E779B7` / `#7D77DC` | Social violet, attention pink |
| singularity | `#090F1C` / `#DAE8FF` / `#B79CFF` / `#62E8D0` | Star-black, selfhood violet and compute cyan |

## PNG manifest

- `assets/sprites/costume_[era_id].png`: 11 carrier sheets, 512×256 RGB, four 128×256 cells each. Each era uses the prescribed palette; props/silhouette accents cue the named costume and progression.
- `assets/sprites/costume_benthic_npc.png`: extra §8 NPC sheet, 512×256, four distinct clawed Benthic poses; not counted among the 11 carrier eras.
- `assets/sprites/scene_[scene_id].png`: 31 scene sheets, 1280×180 RGB, eight 160×180 cells each. IDs exactly: `hunt_dilemma`, `fire_crisis`, `surplus_feast`, `granary_siege`, `trade_road`, `senate_vote`, `legion_march`, `monastery_copy`, `plague_cart`, `press_room`, `patron_deal`, `factory_floor`, `luddite_mob`, `crash_floor`, `war_front`, `lab_test`, `doomsday_clock`, `dot_com_frenzy`, `memory_mug`, `social_spiral`, `attention_auction`, `upload_pod`, `fork_split`, `drift_diverge`, `benthic_meet`, `star_seed`, `ending_diaspora`, `ending_cathedral`, `ending_stutter`, `ending_ghosts`, `ending_ascension`.
- `assets/sprites/bg_[era_id]_[far|near].png`: 22 strips, 640×180 RGB, two 320×180 frames; listed era order above.
- `assets/sprites/badge_[name].png`: 12 transparent 24×24 milestone PNGs: `fire`, `city`, `surplus`, `print`, `factory`, `atom`, `code`, `upload`, `fork`, `drift`, `benthic`, `star`.

## Audio manifest

- BGM: `assets/audio/bgm_[era_id].ogg` and `.mp3` for all 11 era IDs above, plus `bgm_title.ogg` and `.mp3` (24 files total).
- SFX: `click_choice.ogg`, `era_transition.ogg`, `lineage_death.ogg`, `fork.ogg`, `drift.ogg`, `entropy_tick.ogg`, `ending_diaspora.ogg`, `ending_cathedral.ogg`, `ending_stutter.ogg`, `ending_ghosts.ogg`, `ending_ascension.ogg`, `benthic_ping.ogg`, `upgrade.ogg` (13 files). `benthic_ping.ogg` is a distinctive high double claw-click.

Total deliverables: 11 carrier sheets + 1 Benthic NPC sheet + 31 scene sheets + 22 background strips + 12 badges + 37 audio files + this manifest = 115 files. Audio is synthesized, original, and royalty-free; the BGM files are compact proof-of-style loops. Forge should use graceful fallback when any optional file is unavailable.
