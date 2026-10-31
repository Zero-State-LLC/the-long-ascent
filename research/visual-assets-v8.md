# THE LONG ASCENT — v8 visual assets manifest

Branch: `studio-v8` (based on `b4e230f`, origin/main)

Generated assets for SPEC-v8-undeniable.md §4:

- 8 tintable, single-frame, transparent RGBA8 white-base particles at 16×16: `particle_dust`, `particle_spark`, `particle_leaf`, `particle_snow`, `particle_ash`, `particle_star`, `particle_drop`, `particle_glyph`. RGB is white on every visible pixel; alpha carries the silhouette for runtime code tinting.
- 17 title-card strips `titlecard_era01.png`–`titlecard_era17.png`, each 1024×120 RGBA8. Each strip uses that era's `palette_eraNN.json` sky and ink colors in a horizontal gradient, with a subdued motif silhouette band. Motifs in order: mountain ridge, bronze sun disk, temple columns, quill/book, sailing ship, factory stacks, watchtower, gearworks, airship, laboratory spire, branching tree, circuit traces, phone tower, broken arch, radiant ring, dissolving shards, ascending arc.
- Four transparent 32×32 held-state recolors: `overlay_torch_lit`, `overlay_torch_unlit`, `overlay_spear_thrown`, `overlay_spear_plain`.

Reproducibility: `python3 tools/gen_v8_fx.py`
Verification: `python3 tools/verify_v8.py` — checks expected count, PNG signature/CRC, RGBA8 encoding, exact dimensions, visible alpha, white particle pixels, and sky+ink palette availability.

Verification result: PASS, 29/29 outputs. SFX names are outside §4's visual-asset contract; no audio assets were added.
