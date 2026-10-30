#!/usr/bin/env python3
"""Verify generated side-scroller PNGs and palette contrast; emit asset manifest."""
import json, math, struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; A=ROOT/'assets'

def png_info(p):
    b=p.read_bytes()
    assert b[:8]==b'\x89PNG\r\n\x1a\n',f'{p}: invalid PNG signature'
    assert b[12:16]==b'IHDR',f'{p}: missing IHDR'
    w,h=struct.unpack('!II',b[16:24]); depth,color=b[24],b[25]
    assert depth==8 and color in (2,6),f'{p}: unexpected PNG format'
    return w,h

def lum(hexv):
    vals=[int(hexv[i:i+2],16)/255 for i in (1,3,5)]
    vals=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in vals]
    return .2126*vals[0]+.7152*vals[1]+.0722*vals[2]
def contrast(a,b):
    x,y=sorted((lum(a),lum(b)),reverse=True);return (x+.05)/(y+.05)
files=[]
for i in range(1,18):
    p=A/f'player_era{i:02}.png'; wh=png_info(p); assert wh==(1152,128),(p,wh); files.append((p,wh))
    for layer in ('sky','far','near','ground'):
        p=A/f'bg{i:02}_{layer}.png';wh=png_info(p);assert wh==(1024,540),(p,wh);files.append((p,wh))
    p=A/f'palette_era{i:02}.json'; d=json.loads(p.read_text()); assert set(d)=={'sky','far','near','ground','ink','accent'}
    ratio=contrast(d['ink'],d['ground']); assert ratio>=4.5,(p,ratio)
    files.append((p,None))
props='sign npc_elder npc_child npc_merchant npc_scientist shrine ruin_column granary well market_stall factory_gate machine_wreck monument terminal antenna shelter_door launch_gantry obelisk campfire cave_mouth stone_gate world_tree monolith beacon'.split()
for n in props:
    p=A/f'prop_{n}.png';wh=png_info(p);assert wh==(192,192),(p,wh);files.append((p,wh))
assert len(files)==126,len(files)
# Include generator and validator in deliverable file inventory.
manifest=ROOT/'research/visual-assets-v6.md';manifest.parent.mkdir(parents=True,exist_ok=True)
lines=['# Visual assets v6 inventory','','Generated polished pixel-art deliverables. PNG prop sheets are two 96x96 frames side-by-side (192x192 total); player sheets are 18 frames, 64x128 (1152x128).','']
for p,wh in sorted(files,key=lambda x:x[0].name): lines.append(f'- `assets/{p.name}` — {wh[0]}x{wh[1]} PNG' if wh else f'- `assets/{p.name}` — JSON palette (sky, far, near, ground, ink, accent)')
lines += ['', 'Generator and validation tooling:', '- `tools/gen_v6_art.py` — stdlib procedural art generator', '- `tools/verify_v6.py` — PNG signature/dimension and palette contrast validator', '', 'Palette constraint: every ink/ground pair is checked against WCAG relative luminance contrast >= 4.5:1.']
manifest.write_text('\n'.join(lines)+'\n')
print(f'PASS: {len(files)} deliverables validated (17 players, 68 backgrounds, 24 props, 17 palettes); all ink/ground contrasts >= 4.5:1')
for i in range(1,18):
 d=json.loads((A/f'palette_era{i:02}.json').read_text());print(f'era{i:02} contrast {contrast(d["ink"],d["ground"]):.2f}:1')
print(f'manifest: {manifest.relative_to(ROOT)} ({len(files)} asset entries)')
