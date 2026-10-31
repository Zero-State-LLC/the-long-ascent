#!/usr/bin/env python3
"""Verify required v8 §4 PNG inventory, dimensions, signatures and alpha."""
import json, struct, zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; ASSETS=ROOT/'assets'
PARTICLES=['dust','spark','leaf','snow','ash','star','drop','glyph']
def decode(path):
    data=path.read_bytes()
    assert data[:8]==b'\x89PNG\r\n\x1a\n', f'{path.name}: bad PNG signature'
    pos=8; w=h=depth=ctype=None; raw=b''
    while pos<len(data):
      n=struct.unpack('>I',data[pos:pos+4])[0]; typ=data[pos+4:pos+8]; block=data[pos+8:pos+8+n]
      assert zlib.crc32(typ+block)&0xffffffff==struct.unpack('>I',data[pos+8+n:pos+12+n])[0],f'{path.name}: CRC error'
      if typ==b'IHDR':w,h,depth,ctype,_,_,_=struct.unpack('>IIBBBBB',block)
      elif typ==b'IDAT':raw+=block
      elif typ==b'IEND':break
      pos+=12+n
    assert depth==8 and ctype==6, f'{path.name}: expected RGBA8'
    pixels=zlib.decompress(raw); stride=w*4
    out=[]; prev=[0]*stride; off=0
    for _ in range(h):
      ft=pixels[off]; row=list(pixels[off+1:off+1+stride]); off+=stride+1
      for i in range(stride):
       a=row[i-4] if i>=4 else 0; b=prev[i]; c=prev[i-4] if i>=4 else 0
       if ft==1:row[i]=(row[i]+a)&255
       elif ft==2:row[i]=(row[i]+b)&255
       elif ft==3:row[i]=(row[i]+((a+b)//2))&255
       elif ft==4:
        p=a+b-c; pa=abs(p-a);pb=abs(p-b);pc=abs(p-c);pr=a if pa<=pb and pa<=pc else b if pb<=pc else c;row[i]=(row[i]+pr)&255
       elif ft!=0:raise AssertionError(f'{path.name}: unknown PNG filter {ft}')
      out.extend(row);prev=row
    return w,h,out
def main():
    expected=[]
    expected += [(f'particle_{n}.png',(16,16)) for n in PARTICLES]
    expected += [(f'titlecard_era{i:02}.png',(1024,120)) for i in range(1,18)]
    expected += [(n+'.png',(32,32)) for n in ['overlay_torch_lit','overlay_torch_unlit','overlay_spear_thrown','overlay_spear_plain']]
    assert len(expected)==29
    for name,size in expected:
      p=ASSETS/name; assert p.is_file(),f'missing {name}'
      w,h,px=decode(p); assert (w,h)==size,f'{name}: {(w,h)} != {size}'
      assert any(px[i] for i in range(3,len(px),4)),f'{name}: no visible pixels'
    for n in PARTICLES:
      _,_,px=decode(ASSETS/f'particle_{n}.png')
      assert all((px[i],px[i+1],px[i+2])==(255,255,255) for i in range(0,len(px),4) if px[i+3]),f'{n}: non-white visible pixels'
    for i in range(1,18):
      pal=json.loads((ASSETS/f'palette_era{i:02}.json').read_text())
      assert all(k in pal for k in ('sky','ink')),f'era{i:02}: missing palette hue'
    print('PASS: 29/29 PNGs verified; signatures, CRCs, RGBA8, dimensions, transparency and particle white base OK; all 17 palette files have sky+ink.')
if __name__=='__main__':main()
