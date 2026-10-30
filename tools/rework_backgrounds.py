#!/usr/bin/env python3
"""Rework background layers with atmospheric depth and irregular silhouettes."""
import json, math, random
from pathlib import Path
import gen_v6_art as art
ROOT=Path(__file__).resolve().parents[1]
A=ROOT/'assets'

def mix(a,b,t):
    aa=art.hexrgb(a); bb=art.hexrgb(b)
    return '#'+''.join(f'{round(x*(1-t)+y*t):02x}' for x,y in zip(aa,bb))

def paint(i,kind):
    palette=json.loads((A/f'palette_era{i+1:02}.json').read_text())
    sky,far,near,ground,ink,acc=(palette[k] for k in ('sky','far','near','ground','ink','accent'))
    w,h=1024,540; rng=random.Random(7103+i*177+len(kind)*31)
    base={'sky':sky,'far':far,'near':near,'ground':ground}[kind]
    p=art.canvas(w,h,base)
    # Subtle vertical atmosphere, applied before scene details.
    topmix={'sky':.11,'far':.24,'near':.10,'ground':.08}[kind]
    botmix={'sky':.05,'far':.08,'near':.12,'ground':.18}[kind]
    if kind=='sky':
        # Preserve a measurable vertical atmosphere in every palette, with
        # era 9 getting a stronger dusk/dawn ramp from its own sky hue.
        topmix,botmix=.25,.14
        if i==8: topmix,botmix=.65,.45
    cool='#9ebbd0'; warm='#d9b68a'
    for y in range(h):
        t=y/(h-1); col=mix(mix(base,cool,topmix*(1-t)),warm,botmix*t)
        rgb=art.hexrgb(col)
        for x in range(w):
            k=(y*w+x)*3;p[k:k+3]=rgb
    if kind=='sky':
        # irregular stars / particulate glow, sparse and non-periodic
        for n in range(115):
            x=rng.randrange(w); y=rng.randrange(30,455)
            c=acc if n%13==0 else mix(near,sky,.3)
            art.dot(p,w,h,x,y,c)
            if n%17==0: art.dot(p,w,h,x+1,y,c)
        if i in (11,12,13,14,15,16):
            cx,cy,rad=760,145,52
            for y in range(cy-rad,cy+rad):
                for x in range(cx-rad,cx+rad):
                    if (x-cx)**2+(y-cy)**2<rad*rad: art.dot(p,w,h,x,y,acc if i>=14 else near)
    else:
        top={'far':306,'near':388,'ground':478}[kind]
        amp={'far':91,'near':72,'ground':38}[kind]
        # Random-walk silhouette with sparse anchors; nonuniform spacing and sharp variation.
        anchors=[]; x=-24; y=top
        while x<=w+32:
            anchors.append((x,y)); x+=rng.randint(17,43); y=max(top-amp,min(top+amp,y+rng.randint(-19,19)))
        profile=[]
        for x in range(w):
            j=next((q for q in range(len(anchors)-1) if anchors[q][0]<=x<=anchors[q+1][0]),len(anchors)-2)
            x0,y0=anchors[j];x1,y1=anchors[j+1];f=(x-x0)/(x1-x0)
            profile.append(round(y0+(y1-y0)*f+rng.choice((-2,-1,0,0,1,2))))
        fill={'far':mix(far,sky,.25),'near':mix(near,ground,.12),'ground':mix(ground,ink,.25)}[kind]
        highlight=mix(fill,acc,.18); shadow=mix(fill,ink,.24)
        for x,y in enumerate(profile):
            for yy in range(max(0,y),h):
                # Remove mechanical striping; restrained, stochastic geology only.
                c=fill
                if (yy-y)%rng.randint(37,71)==0 and rng.random()<.13: c=highlight
                if yy>y+12 and rng.random()<.025: c=shadow
                art.dot(p,w,h,x,yy,c)
        # Sparse varied vertical forms, highlights and cast shadows.
        x=rng.randint(12,54)
        while x<w:
            y=profile[x]-rng.randint(22,76); height=rng.randint(32,115)
            width=rng.randint(3,17); c=fill
            art.rect(p,w,h,x,y,width,height,c)
            art.line(p,w,h,(x,y),(x,y+height-2),highlight,rng.choice((1,2,3)))
            art.line(p,w,h,(x+width-1,y+5),(x+width-1,y+height),shadow,1)
            if rng.random()<.55:
                art.line(p,w,h,(x-width,y+height//3),(x+width+rng.randint(5,27),y+height//3+rng.randint(-8,9)),shadow,rng.randint(1,3))
            x+=rng.randint(63,174)
    art.png(A/f'bg{i+1:02}_{kind}.png',w,h,p)

for i in range(17):
    for kind in ('sky','far','near','ground'): paint(i,kind)
print('Reworked 68 backgrounds; left player and prop sheets untouched.')
