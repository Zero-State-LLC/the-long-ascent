#!/usr/bin/env python3
"""Verify generated side-scroller PNGs and palette contrast; emit asset manifest."""
import json, math, struct, zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; A=ROOT/'assets'

def png_info(p):
    b=p.read_bytes()
    assert b[:8]==b'\x89PNG\r\n\x1a\n',f'{p}: invalid PNG signature'
    assert b[12:16]==b'IHDR',f'{p}: missing IHDR'
    w,h=struct.unpack('!II',b[16:24]); depth,color=b[24],b[25]
    assert depth==8 and color in (2,6),f'{p}: unexpected PNG format'
    return w,h

def rgb_rows(p):
    """Decode supported 8-bit RGB/RGBA PNG rows (filters 0-4)."""
    b=p.read_bytes(); pos=8; raw=b''; w=h=depth=color=None
    while pos<len(b):
        n=struct.unpack('!I',b[pos:pos+4])[0]; typ=b[pos+4:pos+8]; dat=b[pos+8:pos+8+n];pos+=12+n
        if typ==b'IHDR': w,h,depth,color=struct.unpack('!2I2B',dat[:10])
        elif typ==b'IDAT': raw+=dat
        elif typ==b'IEND': break
    channels=3 if color==2 else 4; stride=int(w)*channels; data=zlib.decompress(raw); rows=[]; prev=bytearray(stride); off=0
    for _ in range(h):
        f=data[off]; off+=1; cur=bytearray(data[off:off+stride]);off+=stride
        for x in range(stride):
            a=cur[x-channels] if x>=channels else 0; b0=prev[x]; c=prev[x-channels] if x>=channels else 0
            if f==1: cur[x]=(cur[x]+a)&255
            elif f==2: cur[x]=(cur[x]+b0)&255
            elif f==3: cur[x]=(cur[x]+((a+b0)//2))&255
            elif f==4:
                q=a+b0-c; pa=abs(q-a);pb=abs(q-b0);pc=abs(q-c);pr=a if pa<=pb and pa<=pc else b0 if pb<=pc else c
                cur[x]=(cur[x]+pr)&255
        rows.append(cur);prev=cur
    return w,h,channels,rows

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
        p=A/f'bg{i:02}_{layer}.png';wh=png_info(p);assert wh==(1024,540),(p,wh)
        ww,hh,ch,rows=rgb_rows(p)
        means=[sum(rows[y][x] for x in range(0,ww*ch,ch))/ww for y in range(hh)]
        assert abs(sum(means[:12])/12-sum(means[-12:])/12)>=1.0,(p,'vertical gradient below 1.0 mean RGB level')
        # All scanlines: test each channel against its 32px-shifted counterpart.
        sq=0; count=0
        for row in rows:
            for y in range(0,(ww-32)*ch):
                d=row[y]-row[y+32*ch];sq+=d*d;count+=1
        corr=sq/(count*255.0**2)
        assert corr>0.000001,(p,'32px offset has negligible color difference')
        files.append((p,wh))
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
