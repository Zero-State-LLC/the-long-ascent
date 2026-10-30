#!/usr/bin/env python3
"""Generate polished procedural pixel-art assets for the v6 side-scroller."""
import json, math, os, random, struct, zlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'assets'
# era palettes: sky, far, near, ground, ink, accent
PALETTES=[
('#1c2938','#526071','#907958','#b8aa92','#101010','#f4bd68'),
('#271d27','#694b42','#a97650','#c8b494','#101010','#eab46c'),
('#253b55','#6c8795','#a77e5c','#b9c6cb','#101010','#f1ca79'),
('#37303b','#777080','#b9a47d','#c2b9a9','#101010','#e9ca87'),
('#23354b','#526d83','#987b64','#bdc9cb','#101010','#e2bd78'),
('#554437','#a48156','#d0ae77','#c4b69c','#101010','#f2d08c'),
('#3d4a50','#758176','#9a8a67','#c2c3b8','#101010','#d3bd78'),
('#3b4b68','#77849a','#bd9c73','#c8c3b9','#101010','#edc77e'),
('#758fa5','#c2ced2','#6e7e6b','#bfc6b2','#101010','#f6d48b'),
('#273b53','#587a86','#849c8a','#c1c7b5','#101010','#b2d79a'),
('#648c9a','#a3b7a5','#728a64','#c0c8b6','#101010','#e4d88d'),
('#22344e','#53647c','#876c58','#c2c6c9','#101010','#bd9b6f'),
('#46305e','#7765a1','#b19acb','#c3b7d3','#101010','#f1a6d5'),
('#1e2b39','#465261','#67645e','#c3c5bd','#101010','#c0b590'),
('#14283c','#304f67','#5b7890','#c3c7cb','#101010','#79e2e1'),
('#231d39','#493c74','#7964a9','#c1becd','#101010','#b6a0ff'),
('#080d25','#1c2550','#383d81','#bdbed2','#050505','#9efbff'),]
ERAS=['cave','bronze','classical','scholar','sails','industrial','soldier','business','flight','lab','green','digital','mobile','survival','glow','dissolve','upload']
GEAR=['hide wrap','bronze sword and armor','classical drape and scroll','scholar robe and book','sails-era coat and sextant','industrial waistcoat and hammer','soldier kit','business suit and briefcase','flight suit','lab coat','outdoor gear','hoodie and laptop','smartphone and headphones','hooded survival coat','subtle glow','partial-dissolve luminous','full luminous upload']

def png(path,w,h,pixels):
    raw=b''.join(b'\0'+bytes(pixels[y*w*3:(y+1)*w*3]) for y in range(h))
    def chunk(t,d): return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
    data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
    path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)

def hexrgb(c): return tuple(bytes.fromhex(c[1:]))

def shade(p,w,h,top_k=0.88,bot_k=1.10):
    # vertical ramp: darken zenith, lighten horizon (keeps hues, adds depth)
    for y in range(h):
        k=top_k+(bot_k-top_k)*(y/(h-1))
        for x in range(w):
            o=(y*w+x)*3
            p[o]=min(255,int(p[o]*k)); p[o+1]=min(255,int(p[o+1]*k)); p[o+2]=min(255,int(p[o+2]*k))
def canvas(w,h,c): return list(hexrgb(c))*(w*h)
def dot(p,w,h,x,y,c):
    x=int(x); y=int(y)
    if 0<=x<w and 0<=y<h: p[(y*w+x)*3:(y*w+x)*3+3]=hexrgb(c)
def line(p,w,h,a,b,c,th=2):
    x0,y0=a; x1,y1=b; n=max(1,int(math.hypot(x1-x0,y1-y0)*2))
    for i in range(n+1):
        t=i/n; x=round(x0+(x1-x0)*t); y=round(y0+(y1-y0)*t)
        for dy in range(-th//2,th//2+1):
            for dx in range(-th//2,th//2+1): dot(p,w,h,x+dx,y+dy,c)
def rect(p,w,h,x,y,ww,hh,c):
    for yy in range(y,y+hh):
        for xx in range(x,x+ww): dot(p,w,h,xx,yy,c)

def player(i):
    sky,far,near,g,ink,acc=PALETTES[i]; w,h=1152,128; p=canvas(w,h,'#000000')
    # transparent via RGB PNG not available: key out black is made transparent using RGBA writer below
    for f in range(18):
        ox=f*64; phase=(f%6)/6*math.tau if 6<=f<12 else (f-12)/4*math.pi if 12<=f<16 else f*.2
        walk=6<=f<12; jump=12<=f<16; mantle=f>=16
        bob=round(math.sin(phase)*2) if walk else (round(math.sin(phase)*2) if f<6 else 0)
        cx=ox+32; heady=25+bob-(5 if jump else 0)
        skin='#d7a77d'; cloth=['#817052','#b47737','#9d7556','#6d5f77','#52687b','#6d5843','#58606a','#45536c','#4f697a','#e1e7df','#607b59','#4c596f','#403859','#52555a','#80d6dc','#8de9eb','#d5fdff'][i]
        light=acc
        # luminous late-era edge aura
        if i>=14:
            for rr in range(8 if i==14 else 12):
                dot(p,w,h,cx+(-rr//2),heady-rr//2,light)
        # head/neck
        rect(p,w,h,cx-5,heady-8,10,12,ink); rect(p,w,h,cx-4,heady-7,8,9,skin); rect(p,w,h,cx-1,heady+3,3,5,skin)
        # hair/hood/headgear
        if i in (13,14,15,16): rect(p,w,h,cx-5,heady-9,10,4,cloth)
        else: rect(p,w,h,cx-5,heady-9,8,3,ink)
        # torso gear silhouette
        torso_top=heady+8; rect(p,w,h,cx-7,torso_top,14,27,ink); rect(p,w,h,cx-5,torso_top+2,10,23,cloth)
        # gear-specific readable motif
        if i==1: line(p,w,h,(cx-5,torso_top+2),(cx+4,torso_top+19),acc,2); line(p,w,h,(cx+8,torso_top+6),(cx+15,torso_top-2),ink,2)
        elif i in (2,3): line(p,w,h,(cx-5,torso_top+3),(cx+5,torso_top+20),acc,2)
        elif i==4: rect(p,w,h,cx-2,torso_top+6,4,10,acc); line(p,w,h,(cx+7,torso_top+10),(cx+14,torso_top+4),acc,1)
        elif i in (5,6): rect(p,w,h,cx-5,torso_top+8,10,3,acc)
        elif i==7: line(p,w,h,(cx,torso_top+2),(cx,torso_top+18),acc,1); rect(p,w,h,cx+5,torso_top+9,4,8,ink)
        elif i in (8,9,10): line(p,w,h,(cx-4,torso_top+3),(cx+4,torso_top+22),acc,2)
        elif i==11: rect(p,w,h,cx-2,torso_top+4,5,8,ink); rect(p,w,h,cx-1,torso_top+5,3,5,acc)
        elif i==12: rect(p,w,h,cx+7,torso_top+8,4,6,acc); line(p,w,h,(cx-4,heady+1),(cx+5,heady+1),acc,1)
        elif i>=14: line(p,w,h,(cx-4,torso_top+2),(cx+5,torso_top+22),light,1)
        # arms, natural alternating stride
        swing=math.sin(phase)*8 if walk else (8 if mantle else 1)
        line(p,w,h,(cx-5,torso_top+5),(cx-12,torso_top+14+swing),skin,3); line(p,w,h,(cx+5,torso_top+5),(cx+12,torso_top+14-swing),skin,3)
        # lower body and stride/jump/mantle poses
        hip=(cx,torso_top+25)
        if jump:
            line(p,w,h,hip,(cx-9,hip[1]+12),(ink),4); line(p,w,h,(cx-9,hip[1]+12),(cx-16,hip[1]+17),cloth,4)
            line(p,w,h,hip,(cx+9,hip[1]+13),ink,4); line(p,w,h,(cx+9,hip[1]+13),(cx+15,hip[1]+18),cloth,4)
        elif mantle:
            line(p,w,h,hip,(cx-5,hip[1]+15),ink,4); line(p,w,h,(cx-5,hip[1]+15),(cx-7,hip[1]+22),cloth,4)
            line(p,w,h,hip,(cx+9,hip[1]+7),ink,4); line(p,w,h,(cx+9,hip[1]+7),(cx+16,hip[1]+7),cloth,4)
        else:
            stride=math.sin(phase)*9 if walk else 0
            line(p,w,h,hip,(cx-5+stride,hip[1]+14),ink,4); line(p,w,h,(cx-5+stride,hip[1]+14),(cx-7+stride*1.5,hip[1]+25),cloth,4)
            line(p,w,h,hip,(cx+5-stride,hip[1]+14),ink,4); line(p,w,h,(cx+5-stride,hip[1]+14),(cx+7-stride*1.5,hip[1]+25),cloth,4)
        # props book/scroll/briefcase held in hands
        if i in (2,3,7,11): rect(p,w,h,cx+12,torso_top+12,8,8,acc); rect(p,w,h,cx+13,torso_top+13,6,6,near)
        # lower body dissolve/upload treatment
        if i==15:
            for k in range(7): dot(p,w,h,cx-7+k*2,torso_top+47+(k%3)*2,light)
        if i==16:
            for yy in range(torso_top+30,min(128,torso_top+55)):
                for xx in range(cx-9,cx+10):
                    if (xx+yy)%3: dot(p,w,h,xx,yy,light)
    # convert black key to RGBA transparent
    rgba=bytearray();
    for j in range(0,len(p),3): rgba.extend((p[j],p[j+1],p[j+2],0 if p[j:j+3]==[0,0,0] else 255))
    write_rgba(ASSETS/f'player_era{i+1:02}.png',w,h,rgba)

def write_rgba(path,w,h,rgba):
    raw=b''.join(b'\0'+bytes(rgba[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t,d): return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
    path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))

def layer(i,kind):
    sky,far,near,ground,ink,acc=PALETTES[i]; w,h=1024,540; base={'sky':sky,'far':far,'near':near,'ground':ground}[kind]; p=canvas(w,h,base); rng=random.Random(i*71+len(kind))
    # seamless tile composition via periodic x positions
    if kind=='sky':
        for n in range(90):
            x=rng.randrange(w); y=rng.randrange(25,430); dot(p,w,h,x,y,acc if n%9==0 else near)
        # sunset/planet arcs
        if i in (12,13,14,15,16):
            cx=760; cy=145; rad=52
            for y in range(cy-rad,cy+rad):
                for x in range(cx-rad,cx+rad):
                    if (x-cx)**2+(y-cy)**2<rad*rad: dot(p,w,h,x,y,acc if i>=14 else near)
    else:
        top={'far':300,'near':385,'ground':475}[kind]
        amp={'far':90,'near':70,'ground':35}[kind]
        pts=[]
        for x in range(-16,w+17,16):
            y=top+int(math.sin((x/w*math.tau)+i*.7+len(kind))*amp*.45+math.sin(x*.031+i)*amp*.2)
            pts.append((x,y))
        fill=near if kind=='far' else ground if kind=='near' else ink
        for x in range(w):
            y=top+int(math.sin((x/w*math.tau)+i*.7+len(kind))*amp*.45+math.sin(x*.031+i)*amp*.2)
            for yy in range(max(0,y),h):
                # ground stripe pattern and near/far atmospheric bands
                c=fill if (yy-y)%18>2 else acc
                dot(p,w,h,x,yy,c)
        # era motifs: cave stalactites, architecture, industrial silhouettes, trees, towers
        motif=i%6
        for x in range(18,w,120):
            y=top-30-rng.randrange(30)
            if motif==0:
                rect(p,w,h,x,y,18,55,fill); rect(p,w,h,x-7,y+45,32,8,acc)
            elif motif==1:
                rect(p,w,h,x,y,8,80,fill); rect(p,w,h,x-14,y,36,9,acc); rect(p,w,h,x-9,y+80,26,8,acc)
            elif motif==2:
                rect(p,w,h,x,y+20,35,70,fill); rect(p,w,h,x+7,y+32,7,14,acc); rect(p,w,h,x+21,y+32,7,14,acc)
            elif motif==3:
                line(p,w,h,(x,y+38),(x+18,y),fill,5); line(p,w,h,(x+18,y),(x+38,y+38),fill,5); rect(p,w,h,x+14,y+38,8,55,fill)
            elif motif==4:
                rect(p,w,h,x,y+5,5,90,fill); line(p,w,h,(x+2,y+10),(x+40,y-6),fill,3); line(p,w,h,(x+2,y+18),(x-23,y+4),fill,2)
            else:
                rect(p,w,h,x,y+8,24,80,fill); rect(p,w,h,x-7,y+24,38,6,acc)
    # vertical depth ramp: sky strongest, far medium, near/ground subtle
    sk={'sky':(0.80,1.22),'far':(0.88,1.10),'near':(0.93,1.06),'ground':(0.96,1.04)}[kind]
    shade(p,w,h,*sk)
    png(ASSETS/f'bg{i+1:02}_{kind}.png',w,h,p)

def prop(name,idx):
    palette=PALETTES[idx%17]; sky,far,near,g,ink,acc=palette; w=h=192; # 2x 96 frames
    p=[0,0,0,0]*(w*h); rng=random.Random(idx*333+len(name))
    def d(x,y,c):
        if 0<=x<w and 0<=y<h:
            k=(y*w+x)*4;p[k:k+4]=[*hexrgb(c),255]
    def r(x,y,ww,hh,c):
        for yy in range(y,y+hh):
            for xx in range(x,x+ww): d(xx,yy,c)
    def l(a,b,c,t=2):
        x0,y0=a;x1,y1=b;n=max(1,int(math.hypot(x1-x0,y1-y0)*2))
        for j in range(n+1):
            q=j/n;x=round(x0+(x1-x0)*q);y=round(y0+(y1-y0)*q)
            for yy in range(-t//2,t//2+1):
                for xx in range(-t//2,t//2+1): d(x+xx,y+yy,c)
    for frame in range(2):
        ox=frame*96; cx=ox+48; active=frame==1
        # crafted silhouettes grouped by semantic family, with distinct glyph and trim
        if name.startswith('npc_'):
            r(cx-10,34,20,20,ink);r(cx-8,36,16,16,acc if active else near);r(cx-13,55,26,35,ink);r(cx-10,58,20,27,far)
            l((cx-9,67),(cx-18,82),ink,4);l((cx+9,67),(cx+17,81),ink,4);l((cx-6,82),(cx-11,94),ink,4);l((cx+6,82),(cx+11,94),ink,4)
            if 'elder' in name: l((cx+17,75),(cx+19,94),acc,2);r(cx-9,31,18,3,acc)
            if 'child' in name: r(cx-5,41,3,3,ink);r(cx+3,41,3,3,ink)
            if 'merchant' in name: r(cx-14,52,28,5,acc);r(cx+9,66,8,9,near)
            if 'scientist' in name: l((cx-7,57),(cx+7,81),acc,2);r(cx+7,64,7,9,ink)
        elif name in ('sign','terminal','antenna','beacon','monolith','obelisk'):
            if name=='sign': r(cx-3,42,6,52,ink);r(cx-25,37,50,28,near);r(cx-21,41,42,20,acc if active else far);l((cx-13,49),(cx+12,49),ink,2)
            elif name=='terminal':r(cx-23,38,46,42,ink);r(cx-18,43,36,29,near);r(cx-14,48,28,16,acc if active else sky);r(cx-16,83,32,7,ink);r(cx-7,90,14,5,ink)
            elif name=='antenna':r(cx-4,37,8,57,ink);l((cx,43),(cx-19,30),acc,2);l((cx,43),(cx+20,30),acc,2);r(cx-25,25,50,3,acc if active else near);r(cx-16,52,32,3,ink)
            else:r(cx-18,30,36,65,ink);r(cx-12,35,24,55,acc if active else near);l((cx-10,85),(cx+10,45),sky,2)
        elif name in ('shrine','ruin_column','monument','stone_gate','world_tree','granary','well'):
            if name=='ruin_column':r(cx-17,36,34,57,ink);r(cx-12,41,24,47,near);r(cx-22,33,44,8,acc);r(cx-21,91,42,7,ink);r(cx-6,42,3,46,acc)
            elif name=='stone_gate':r(cx-29,40,12,54,ink);r(cx+17,40,12,54,ink);r(cx-29,33,58,12,near);r(cx-19,43,38,51,sky)
            elif name=='world_tree':r(cx-5,56,10,39,ink);r(cx-24,39,48,30,near);r(cx-18,33,36,30,acc if active else far);r(cx-17,36,4,4,sky)
            else:r(cx-26,54,52,40,ink);r(cx-20,58,40,32,near);r(cx-24,49,48,8,acc);r(cx-5,61,10,26,sky)
        elif name in ('campfire','cave_mouth','shelter_door','launch_gantry'):
            if name=='campfire':l((cx-20,91),(cx+18,82),ink,5);l((cx-15,82),(cx+20,91),ink,5);r(cx-5,62,10,22,acc if active else near);r(cx-2,68,4,11,'#fff0a8')
            elif name=='cave_mouth':r(cx-35,40,70,55,ink);r(cx-24,53,48,42,sky);r(cx-31,38,62,12,near);r(cx-27,43,6,7,acc)
            else:r(cx-29,37,8,58,ink);r(cx+21,37,8,58,ink);r(cx-32,34,64,8,acc);l((cx-18,42),(cx+18,89),near,2);l((cx+18,42),(cx-18,89),near,2)
        else:
            # distinctive object badge/structure silhouettes
            r(cx-26,53,52,39,ink);r(cx-21,58,42,29,near);r(cx-15,63,30,17,acc if active else far);r(cx-8,67,16,8,sky)
            if name in ('machine_wreck','factory_gate'):l((cx-27,42),(cx+25,87),acc,4);l((cx+26,42),(cx-24,85),ink,3)
            if name=='market_stall':r(cx-31,43,62,7,acc);l((cx-26,50),(cx-26,91),ink,3);l((cx+26,50),(cx+26,91),ink,3)
        # active sparkle / idle secondary indicator
        if active:
            for x,y in ((cx-30,33),(cx+28,39),(cx+24,80)): d(x,y,acc)
    write_rgba(ASSETS/f'prop_{name}.png',w,h,p)

props=['sign','npc_elder','npc_child','npc_merchant','npc_scientist','shrine','ruin_column','granary','well','market_stall','factory_gate','machine_wreck','monument','terminal','antenna','shelter_door','launch_gantry','obelisk','campfire','cave_mouth','stone_gate','world_tree','monolith','beacon']
for i in range(17):
    player(i)
    for kind in ('sky','far','near','ground'): layer(i,kind)
    vals=PALETTES[i]; names=('sky','far','near','ground','ink','accent')
    (ASSETS/f'palette_era{i+1:02}.json').write_text(json.dumps(dict(zip(names,vals)),indent=2)+'\n')
for j,name in enumerate(props): prop(name,j)
print(f'generated {17} player sheets, {68} backgrounds, {24} props, {17} palettes')
