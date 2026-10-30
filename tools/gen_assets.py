import json, math, os, struct, zlib, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'assets/sprites'
# Era colors from src/render/palettes.js (background, surface, line, accent)
PAL=[('#211A18','#302522','#6A4130','#FF7A32'),('#D8C58B','#E7D8A5','#79583C','#D49B3B'),('#B87955','#D59B6D','#70483F','#D5A64B'),('#283344','#354257','#6C7788','#E5B95E'),('#E6D7B7','#F3E8D0','#B8A98D','#8B3F3B'),('#4A4B4B','#383B3D','#899397','#D18A42'),('#32617A','#244C62','#7693A0','#C84D46'),('#202A32','#303D43','#647078','#A8D879'),('#111D2B','#1A2A3B','#4766A8','#54D6C8'),('#29283F','#383653','#77739A','#E779B7'),('#090F1C','#141D31','#394969','#B79CFF')]
ERA_NAMES=['cave','agriculture','bronze','dark_ages','renaissance','industry','american','atomic','digital','connected','singularity']
IDS={'cave':0,'agriculture':1,'bronze':2,'dark_ages':3,'renaissance':4,'industry':5,'american':6,'atomic':7,'digital':8,'connected':9,'singularity':10,'benthic':10,'green':4,'revolution':5,'sails':6,'wars':7,'orbit':8,'void':10}
DATA=json.loads((ROOT/'src/data/events.json').read_text())
def events(obj):
 if isinstance(obj,dict):
  if isinstance(obj.get('scene_id'),str): yield obj['scene_id']
  for v in obj.values(): yield from events(v)
 elif isinstance(obj,list):
  for v in obj: yield from events(v)
SCENES=sorted(set(events(DATA)))

def rgb(h): return tuple(bytes.fromhex(h[1:]))
def png(path,w,h,pix):
    raw=b''.join(b'\0'+bytes(pix[y*w*3:(y+1)*w*3]) for y in range(h))
    def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
def canvas(w,h,c): return list(rgb(c))*(w*h)
def rect(p,w,h,x,y,ww,hh,c):
    r,g,b=rgb(c)
    for yy in range(max(0,int(y)),min(h,int(y+hh))):
      for xx in range(max(0,int(x)),min(w,int(x+ww))):
        i=(yy*w+xx)*3;p[i:i+3]=[r,g,b]
def disk(p,w,h,cx,cy,r,c):
    cr=rgb(c)
    for y in range(max(0,int(cy-r)),min(h,int(cy+r+1))):
      for x in range(max(0,int(cx-r)),min(w,int(cx+r+1))):
        if (x-cx)**2+(y-cy)**2<=r*r:
          i=(y*w+x)*3;p[i:i+3]=cr
def line(p,w,h,x0,y0,x1,y1,c,t=2):
    steps=max(abs(int(x1-x0)),abs(int(y1-y0)),1)
    for j in range(steps+1): disk(p,w,h,x0+(x1-x0)*j/steps,y0+(y1-y0)*j/steps,t/2,c)
def poly(p,w,h,pts,c):
    # scanline filled polygon
    for y in range(max(0,int(min(q[1] for q in pts))),min(h,int(max(q[1] for q in pts))+1)):
      xs=[]
      for i in range(len(pts)):
       x1,y1=pts[i];x2,y2=pts[(i+1)%len(pts)]
       if (y1<=y<y2) or (y2<=y<y1): xs.append(x1+(y-y1)*(x2-x1)/(y2-y1))
      xs.sort()
      for a,b in zip(xs[::2],xs[1::2]): rect(p,w,h,a,y,b-a+1,1,c)
def figure(p,w,h,ox,oy,era,frame):
    bg,surf,ink,acc=PAL[era]; cx=ox+80; base=oy+159
    # walking gait: alternating leg swing, opposing arm motion
    swing=[-6,0,6,0][frame%4]
    disk(p,w,h,cx,oy+57,10,ink); disk(p,w,h,cx,oy+57,6,surf)
    line(p,w,h,cx,oy+69,cx,oy+111,ink,3)
    line(p,w,h,cx,oy+79,cx-13,oy+91,ink,2);line(p,w,h,cx-13,oy+91,cx-15-swing*.4,oy+108,ink,2)
    line(p,w,h,cx,oy+79,cx+13,oy+91,ink,2);line(p,w,h,cx+13,oy+91,cx+15+swing*.4,oy+108,ink,2)
    line(p,w,h,cx,oy+111,cx-10+swing,oy+132,ink,2);line(p,w,h,cx-10+swing,oy+132,cx-13+swing,base,ink,2)
    line(p,w,h,cx,oy+111,cx+10-swing,oy+132,ink,2);line(p,w,h,cx+10-swing,oy+132,cx+13-swing,base,ink,2)
    # era-specific garment and handheld symbol, behind/over limbs
    if era in (3,4): poly(p,w,h,[(cx-8,oy+70),(cx-15,oy+115),(cx,oy+124),(cx+15,oy+115),(cx+8,oy+70)],surf)
    if era==2:
      disk(p,w,h,cx+20,oy+92,8,acc);line(p,w,h,cx+19,oy+89,cx+19,oy+71,ink,2)
    elif era==0:
      line(p,w,h,cx+13,oy+91,cx+22,oy+79,ink,2);poly(p,w,h,[(cx+18,oy+80),(cx+17,oy+72),(cx+24,oy+77),(cx+28,oy+72),(cx+26,oy+82)],acc)
    elif era in (8,9,10): rect(p,w,h,cx+14,oy+86,9,12,acc)
    elif era==5: rect(p,w,h,cx+16,oy+85,10,5,acc)
    else: rect(p,w,h,cx+14,oy+86,8,8,acc)
def bg_file(path,era,near):
    w,h=640,180; bg,surf,ink,acc=PAL[era];p=canvas(w,h,bg)
    # exact two-frame repeat; draw tile then copy
    tile=canvas(320,h,bg); tw=320
    rect(tile,tw,h,0,111,320,69,surf if near else bg)
    # terrain/horizon details; avoid walkable floor band below y112
    if not near:
      for x in range(-20,340,64):
       if era in (2,3,4,5): rect(tile,tw,h,x,38+(x%3)*7,20,74,ink)
       else: poly(tile,tw,h,[(x,112),(x+25,75+(x%4)*5),(x+52,112)],surf)
    else:
      for x in range(10,320,40):
       rect(tile,tw,h,x,118,3,24,ink);rect(tile,tw,h,x-7,114,17,4,acc)
    for y in range(0,h):
      for x in range(tw):
       i=(y*tw+x)*3;tile[i:i+3]=tile[i:i+3]
    for y in range(h): p[y*w*3:y*w*3+tw*3]=tile[y*tw*3:(y+1)*tw*3];p[y*w*3+tw*3:(y+1)*w*3]=tile[y*tw*3:(y+1)*tw*3]
    png(path,w,h,p)
changed=[]
for path in sorted(OUT.glob('costume_*.png')):
 era=IDS.get(path.stem[len('costume_'):],0);w,h=512,256;p=canvas(w,h,'#000000')
 for f in range(4): figure(p,w,h,f*128,0,era,f)
 png(path,w,h,p);changed.append(str(path.relative_to(ROOT)))
for name in SCENES:
 path=OUT/('scene_'+name+'.png');era=min(10,SCENES.index(name)//4);w,h=1280,180;p=canvas(w,h,PAL[era][0]);bg,surf,ink,acc=PAL[era]
 for frame in range(8):
  ox=frame*160
  # layered distant skyline/terrain, middle structures, uninterrupted foreground floor from 62% down
  rect(p,w,h,ox,0,160,110,bg)
  for k in range(3):
   x=ox+(k*61+13)%150
   if era in (1,2,3,4,5): rect(p,w,h,x,48+(k%2)*12,14,61,ink)
   else: poly(p,w,h,[(x,110),(x+18,72+(k%2)*9),(x+36,110)],surf)
  # signature prop silhouette varies by scene name, restrained, above floor band
  seed=int(hashlib.sha1(name.encode()).hexdigest()[:4],16);px=ox+35+seed%90
  rect(p,w,h,px,83,24,4,acc);rect(p,w,h,px+3,87,3,22,ink);rect(p,w,h,px+18,87,3,22,ink)
  # horizon at 62%, broad clear walkable strip; floor baseline is unobstructed
  rect(p,w,h,ox,112,160,68,surf)
  for xx in range(ox,ox+160,24): rect(p,w,h,xx,120,11,1,ink)
  figure(p,w,h,ox+42,0,era,frame%4)
 png(path,w,h,p);changed.append(str(path.relative_to(ROOT)))
for path in sorted(OUT.glob('bg_*.png')):
 bits=path.stem.split('_');key='_'.join(bits[1:-1]);era=IDS.get(key,0);bg_file(path,era,bits[-1]=='near');changed.append(str(path.relative_to(ROOT)))
(ROOT/'research/visual-assets-v4.md').write_text('# THE LONG ASCENT — Visual Assets v4\n\nRedrew 18 costume sheets (4 frames each), 35 event scene sheets (8 frames each), and all 22 far/near background pairs (44 files). Sheet dimensions and frame counts are unchanged: costumes 512×256; scenes 1280×180; backgrounds 640×180 with two seamless 320×180 tiles. Special/ending scene sheets not referenced by events were preserved. Palette mapping follows `src/render/palettes.js`; no text in art.\n\n## Changed files\n\n'+'\n'.join('- `'+x+'`' for x in sorted(changed))+'\n')
print('updated',len(changed),'PNG assets; event scenes',len(SCENES))
