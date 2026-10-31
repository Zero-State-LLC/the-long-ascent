#!/usr/bin/env python3
"""Generate SPEC v8 §4 particle, title-card, and held overlay art."""
import json, math, struct, zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'assets'

def png(path,w,h,pix):
    raw=b''.join(b'\0'+bytes(pix[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t,d):
        c=t+d; return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
def canvas(w,h): return [(0,0,0,0)]*(w*h)
def put(p,w,h,x,y,c=(255,255,255,255)):
    if 0<=x<w and 0<=y<h:p[y*w+x]=c
def disk(p,w,h,cx,cy,rx,ry,c=(255,255,255,255)):
    for y in range(cy-ry,cy+ry+1):
      for x in range(cx-rx,cx+rx+1):
        if ((x-cx)/rx)**2+((y-cy)/ry)**2<=1:put(p,w,h,x,y,c)
def line(p,w,h,x0,y0,x1,y1,c=(255,255,255,255)):
    n=max(abs(x1-x0),abs(y1-y0),1)
    for i in range(n+1):put(p,w,h,round(x0+(x1-x0)*i/n),round(y0+(y1-y0)*i/n),c)
def main():
    ASSETS.mkdir(exist_ok=True)
    # All particle RGB is white; alpha defines the shape for runtime tinting.
    particles={
      'particle_dust':lambda p:[disk(p,16,16,*q) for q in [(5,10,3,3),(8,8,3,4),(11,10,3,3)]],
      'particle_spark':lambda p:(line(p,16,16,8,1,8,14),line(p,16,16,1,8,14,8),line(p,16,16,3,3,13,13),line(p,16,16,13,3,3,13)),
      'particle_leaf':lambda p:(disk(p,16,16,8,7,3,6),line(p,16,16,4,12,12,3)),
      'particle_snow':lambda p:(line(p,16,16,8,1,8,14),line(p,16,16,1,8,14,8),line(p,16,16,3,3,13,13),line(p,16,16,13,3,3,13)),
      'particle_ash':lambda p:(disk(p,16,16,8,8,2,2),put(p,16,16,10,7)),
      'particle_star':lambda p:(line(p,16,16,8,1,8,14),line(p,16,16,1,8,14,8),line(p,16,16,4,4,12,12),line(p,16,16,12,4,4,12)),
      'particle_drop':lambda p:(disk(p,16,16,8,9,3,5),line(p,16,16,8,1,5,7),line(p,16,16,8,1,11,7)),
      'particle_glyph':lambda p:(line(p,16,16,4,4,8,1),line(p,16,16,8,1,12,4),line(p,16,16,4,4,4,12),line(p,16,16,12,4,12,12),line(p,16,16,4,12,8,9),line(p,16,16,8,9,12,12)),
    }
    for n,draw in particles.items():
      p=canvas(16,16); draw(p); (ASSETS/(n+'.png')).write_bytes(png(ASSETS/(n+'.png'),16,16,[v for px in p for v in px]))
    motifs=['mountain ridge','bronze sun disk','temple columns','quill and book','sailing ship','factory stacks','watchtower','gearworks','airship','laboratory spire','branching tree','circuit traces','phone tower','broken arch','radiant ring','dissolving shards','ascending arc']
    for i,motif in enumerate(motifs,1):
      pal=json.loads((ASSETS/f'palette_era{i:02}.json').read_text()); sky=tuple(int(pal['sky'][j:j+2],16) for j in (1,3,5)); ink=tuple(int(pal['ink'][j:j+2],16) for j in (1,3,5))
      p=canvas(1024,120)
      for y in range(120):
       t=y/119
       c=tuple(round(a*(1-t)+b*t) for a,b in zip(sky,ink))+(255,)
       for x in range(1024):p[y*1024+x]=c
      # Low-contrast motif silhouette band; each era receives a distinct recognizable glyph.
      band=(*ink,205)
      if i in (1,5,9,17):
       for x in range(0,1024,80):
        if i==1: points=[(x,115),(x+35,78+(x//80%3)*7),(x+70,115)]
        elif i==5: points=[(x,116),(x+30,95),(x+32,58),(x+68,92),(x+72,116)]
        elif i==9: points=[(x,112),(x+38,76),(x+72,112),(x+38,99),(x,112)]
        else: points=[(x+15,116),(x+40,90),(x+46,70),(x+54,85),(x+75,58),(x+68,116)]
        for a,b in zip(points,points[1:]):line(p,1024,120,*a,*b,band)
      elif i in (2,3,6,8,11,12,14,15,16):
       for x in range(24,1024,112):
        if i==2: disk(p,1024,120,x,98,13,13,band)
        elif i==3: line(p,1024,120,x,116,x,74,band);line(p,1024,120,x-10,74,x+10,74,band)
        elif i==6: line(p,1024,120,x,116,x,68,band);line(p,1024,120,x-11,68,x+11,68,band)
        elif i==8: line(p,1024,120,x-20,115,x+20,115,band);line(p,1024,120,x-15,115,x-15,83,band);line(p,1024,120,x+15,115,x+15,83,band)
        elif i==11: line(p,1024,120,x,116,x,88,band);line(p,1024,120,x,98,x-16,82,band);line(p,1024,120,x,101,x+17,84,band)
        elif i==12: line(p,1024,120,x,116,x,76,band);line(p,1024,120,x-14,76,x+14,76,band)
        elif i==14: line(p,1024,120,x-18,114,x,86,band);line(p,1024,120,x,86,x+18,114,band)
        else: line(p,1024,120,x-18,114,x,82,band);line(p,1024,120,x,82,x+18,114,band)
      else:
       for x in range(32,1024,128):
        if i==4:line(p,1024,120,x,116,x,79,band);line(p,1024,120,x,79,x+12,86,band)
        elif i==7:line(p,1024,120,x,116,x,78,band);line(p,1024,120,x,83,x+17,83,band)
        elif i==10:line(p,1024,120,x,116,x,72,band);line(p,1024,120,x-10,85,x+10,85,band)
        elif i==13:line(p,1024,120,x,116,x,80,band);line(p,1024,120,x-12,80,x+12,80,band)
      f=ASSETS/f'titlecard_era{i:02}.png'; f.write_bytes(png(f,1024,120,[v for px in p for v in px]))
    # Recolor variants retain transparent canvas and a common silhouette per pair.
    for name,kind,lit in [('overlay_torch_lit','torch',True),('overlay_torch_unlit','torch',False),('overlay_spear_thrown','spear',True),('overlay_spear_plain','spear',False)]:
      p=canvas(32,32)
      if kind=='torch':
       wood=(148,103,57,255); line(p,32,32,13,27,18,11,wood); line(p,32,32,14,24,19,9,wood)
       if lit: disk(p,32,32,21,8,4,6,(255,255,255,255));disk(p,32,32,21,8,2,4,(255,205,99,255))
       else: line(p,32,32,17,12,22,8,(75,70,65,255))
      else:
       line(p,32,32,4,27,26,5,(148,103,57,255));line(p,32,32,24,7,29,2,(238,226,197,255))
       if lit: line(p,32,32,5,26,12,21,(255,255,255,255))
       else: line(p,32,32,7,24,11,20,(75,70,65,255))
      f=ASSETS/(name+'.png'); f.write_bytes(png(f,32,32,[v for px in p for v in px]))
    print('Generated 8 particles, 17 title cards, 4 overlay variants.')
if __name__=='__main__':main()
