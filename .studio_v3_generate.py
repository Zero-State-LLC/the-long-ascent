import os, math, random, wave, subprocess, struct
import numpy as np
from PIL import Image, ImageDraw
R='/Users/luna/.hermes/work/accelerando/repo'; S=R+'/assets/sprites'; A=R+'/assets/audio'
os.makedirs(S,exist_ok=True); os.makedirs(A,exist_ok=True)
# era palettes: background, ink, accent, secondary
pal={'sails':('#32617A','#F1E5CF','#D49B3B','#C84D46'),'revolution':('#E6D7B7','#3D3A37','#8B3F3B','#477C78'),'wars':('#202A32','#DCE5D5','#E65B4B','#647078'),'orbit':('#111D2B','#BFE8E5','#54D6C8','#F3C969'),'green':('#D8C58B','#3F4A32','#71884D','#D49B3B'),'void':('#090F1C','#DAE8FF','#B79CFF','#62E8D0')}
# existing palette mapping
old={'cave':('#211A18','#E9D9B8','#FF7A32','#6A4130'),'agriculture':('#D8C58B','#3F4A32','#D49B3B','#71884D'),'bronze':('#B87955','#382D32','#D5A64B','#9F3F36'),'dark_ages':('#283344','#D0C8B7','#E5B95E','#68758A'),'renaissance':('#E6D7B7','#3D3A37','#8B3F3B','#477C78'),'industry':('#4A4B4B','#E0D2B8','#D18A42','#899397'),'american':('#32617A','#F1E5CF','#C84D46','#34383B'),'atomic':('#202A32','#DCE5D5','#A8D879','#E65B4B'),'digital':('#111D2B','#BFE8E5','#54D6C8','#F3C969'),'connected':('#29283F','#EEE8FF','#E779B7','#7D77DC'),'singularity':('#090F1C','#DAE8FF','#B79CFF','#62E8D0')}
def rgba(c): return tuple(bytes.fromhex(c[1:]))
def stick(d,x,y,ink,accent,pose=0,scale=1):
    w=max(2,int(4*scale)); pts=[(x,y),(x,y+22*scale),(x-13*scale,y+39*scale),(x+13*scale,y+39*scale),(x-18*scale,y+62*scale),(x+18*scale,y+62*scale)]
    d.ellipse((x-7*scale,y-15*scale,x+7*scale,y-1*scale),outline=ink,width=w)
    d.line((pts[0],pts[1]),fill=ink,width=w); d.line((pts[1],(x-12*scale,y+30*scale),(x-20*scale,y+25*scale)),fill=ink,width=w); d.line((pts[1],(x+12*scale,y+29*scale),(x+22*scale,y+18*scale)),fill=ink,width=w)
    d.line((pts[1],pts[2]),fill=ink,width=w); d.line((pts[1],pts[3]),fill=ink,width=w)
    d.line((x+22*scale,y+18*scale,x+27*scale,y+10*scale),fill=accent,width=w)

def bg(col,ink,accent,layer):
 im=Image.new('RGB',(640,180),rgba(col)); d=ImageDraw.Draw(im)
 for x in range(0,640,320):
  d.rectangle((x,125,x+319,179),fill=rgba(ink if layer=='far' else accent))
  if layer=='far':
   for j in range(4):
    xx=x+30+j*90; d.line((xx,125,xx,45+(j%2)*20),fill=rgba(ink),width=5); d.arc((xx-35,30,xx+35,100),180,360,fill=rgba(accent),width=3)
   for j in range(12): d.ellipse((x+j*29,30+(j*37)%100,x+j*29+2,32+(j*37)%100),fill=rgba(accent))
  else:
   for j in range(18):
    xx=x+j*18; yy=130+(j*17)%45; d.ellipse((xx,yy,xx+4,yy+4),fill=rgba(ink))
 return im
# new costumes backgrounds
for i,(era,cs) in enumerate(pal.items()):
 bgc,ink,acc,sec=map(rgba,cs); im=Image.new('RGB',(512,256),bgc)
 for f in range(4):
  tile=Image.new('RGB',(128,256),bgc); d=ImageDraw.Draw(tile); d.rectangle((0,205,128,256),fill=sec)
  stick(d,64+(f%2-0.5)*3,90,ink,acc, f,1.15)
  # signature prop motifs
  if era in ('sails','orbit'): d.polygon([(86,170),(104,145),(104,178)],fill=acc)
  elif era=='revolution': d.rectangle((85,155,106,174),outline=acc,width=4); d.line((85,155,105,155),fill=sec,width=3)
  elif era=='wars': d.rectangle((88,157,104,174),fill=sec); d.line((83,153,107,153),fill=acc,width=3)
  elif era=='green': d.line((90,174,92,151,100,143),fill=acc,width=4); d.ellipse((95,141,107,153),fill=acc)
  elif era=='void': d.ellipse((90,150,108,168),outline=acc,width=3); d.ellipse((96,156,102,162),fill=sec)
  im.paste(tile,(f*128,0))
 im.save(f'{S}/costume_{era}.png')
 for layer in ('far','near'): bg(cs[0],cs[1],cs[2],layer).save(f'{S}/bg_{era}_{layer}.png')
# badge
for name,cs in list(pal.items()):
 im=Image.new('RGBA',(24,24),(0,0,0,0)); d=ImageDraw.Draw(im); d.ellipse((2,2,22,22),fill=rgba(cs[2])+(255,),outline=rgba(cs[1])+(255,),width=2); d.line((7,17,12,6,18,17),fill=rgba(cs[1])+(255,),width=2); im.save(f'{S}/badge_{dict(sails="sails",revolution="ideals",wars="mobilize",orbit="orbit",green="carbon",void="void")[name]}.png')
# ten scene sheets
scenes=['sail_deal','constitution_debate','trench_letter','launch_window','carbon_audit','void_watch','custodian_relic','benthic_contract','rival_compare','arc_chapter']
for n,scene in enumerate(scenes):
 era=list(pal)[n%6]; bgc,ink,acc,sec=map(rgba,pal[era]); im=Image.new('RGB',(1280,180),bgc)
 for f in range(8):
  t=Image.new('RGB',(160,180),bgc); d=ImageDraw.Draw(t); d.rectangle((0,145,160,180),fill=sec)
  if scene in ('trench_letter','void_watch'): d.line((0,120,160,120),fill=acc,width=5)
  stick(d,75+(f%3-1)*7,65,ink,acc,scale=.75)
  # clear story silhouette
  if scene=='sail_deal': d.polygon([(105,120),(145,120),(134,70)],fill=acc)
  elif scene=='constitution_debate': d.rectangle((105,90,145,135),outline=acc,width=5); d.line((110,100,140,100),fill=ink,width=3)
  elif scene=='launch_window': d.ellipse((112,65,148,101),outline=acc,width=4); d.polygon([(125,112),(134,80),(143,112)],fill=sec)
  elif scene=='carbon_audit': d.rectangle((112,95,145,135),fill=acc); d.line((118,110,139,110),fill=ink,width=3)
  elif scene=='benthic_contract': d.ellipse((108,105,150,142),fill=sec); d.line((113,125,105,112),fill=ink,width=4); d.line((145,125,153,112),fill=ink,width=4)
  elif scene=='rival_compare': stick(d,135,75,sec,acc,scale=.5)
  elif scene=='custodian_relic': d.polygon([(118,100),(130,80),(142,100),(130,123)],fill=acc)
  elif scene=='arc_chapter': d.rectangle((109,96,148,137),fill=sec); d.line((115,105,141,105),fill=ink,width=3)
  im.paste(t,(f*160,0))
 im.save(f'{S}/scene_{scene}.png')
# Crossing sheets
def sheet(path,w,h,count,bgcol,ink,acc,kind):
 im=Image.new('RGBA',(w*count,h),(0,0,0,0))
 for f in range(count):
  d=ImageDraw.Draw(im); x=f*w
  if kind=='ship':
   d.polygon([(x+15,h//2),(x+65,h//2-18),(x+85,h//2),(x+65,h//2+18)],fill=ink,outline=acc); d.ellipse((x+43,h//2-8,x+57,h//2+8),outline=acc,width=3)
   if f==1:d.polygon([(x+15,h//2-5),(x+1,h//2),(x+15,h//2+5)],fill=acc)
  elif kind=='rock':
   d.polygon([(x+w*.25,h*.25),(x+w*.7,h*.15),(x+w*.85,h*.55),(x+w*.6,h*.8),(x+w*.2,h*.65)],fill=ink,outline=acc)
  elif kind=='comet':
   d.line((x+3,h*.65,x+w*.45,h*.5),fill=acc,width=3); d.ellipse((x+w*.45,h*.35,x+w*.8,h*.7),fill=ink,outline=acc,width=2)
  else: d.ellipse((x+5,5,x+w-5,h-5),outline=acc,width=4); d.ellipse((x+15,15,x+w-15,h-15),outline=ink,width=2)
  if count>1 and f==1 and kind=='rock':d.line((x+20,20,x+w-20,h-20),fill=acc,width=3)
 im.save(path)
void=pal['void']; sheet(S+'/ship_lineage.png',96,96,4,*void[:3],'ship'); sheet(S+'/obs_derelict.png',96,96,2,*void[:3],'rock'); sheet(S+'/obs_comet.png',48,48,2,*void[:3],'comet'); sheet(S+'/gate_ring.png',48,192,1,*void[:3],'gate')
im=Image.new('RGBA',(24,24),(0,0,0,0)); d=ImageDraw.Draw(im); d.polygon([(12,2),(21,20),(12,16),(3,20)],fill=void[2],outline=void[1]); im.save(S+'/badge_void_pilot.png')
# synth audio: deterministic multi-section chord beds, continuous smooth loops; PCM then ffmpeg encode
sr=44100
chords={'cave':[55,65.4,82.4],'agriculture':[110,138.6,164.8],'bronze':[130.8,164.8,196],'dark_ages':[98,123.5,146.8],'renaissance':[146.8,185,220],'industry':[73.4,92.5,110],'american':[110,138.6,164.8],'atomic':[55,82.4,110],'digital':[130.8,164.8,196],'connected':[123.5,155.6,185],'singularity':[73.4,110,146.8],**{k:[110+i*8,138+i*7,165+i*9] for i,k in enumerate(pal)}}
def make_audio(name,dur,tempo=1,kind='bgm'):
 n=int(sr*dur); t=np.arange(n)/sr; freqs=chords.get(name,[110,138,165]); sec=dur/2
 # two contrasting sections via chord inversion and harmonic density
 out=np.zeros(n,dtype=np.float64)
 for j,f in enumerate(freqs):
  phase=2*np.pi*f*t + .12*np.sin(2*np.pi*.07*t+j)
  out += (.10/(j+1))*np.sin(phase)
  out += .035*np.sin(2*phase+.3*j)
  out += .025*np.sin(2*np.pi*(f*1.5)*t)
 # slow pulsing / section shift
 env=.6+.4*np.sin(2*np.pi*t/(dur/3))**2
 shift=t>=sec; out[shift]*=1.15
 out*=env
 if kind=='crossing': out += .08*np.sin(2*np.pi*48*t+.35*np.sin(2*np.pi*.4*t)) + .045*np.sin(2*np.pi*220*t)
 if kind=='sfx':
  if 'knock' in name: out=.14*np.exp(-t*6)*np.sin(2*np.pi*420*t)
  elif 'pulse' in name: out=.15*np.exp(-t*2)*np.sin(2*np.pi*(110+30*np.sin(t*4))*t)
  elif 'thud' in name: out=.22*np.exp(-t*9)*np.sin(2*np.pi*68*t)
  elif 'chime' in name: out=.14*np.exp(-t*2)*np.sin(2*np.pi*880*t)
  else: out=.15*np.exp(-t*1.5)*(np.sin(2*np.pi*440*t)+.5*np.sin(2*np.pi*660*t))
 # fade only at boundary symmetrically to guarantee click-free loop
 if kind!='sfx':
  edge=int(sr*.025); ramp=np.sin(np.linspace(0,np.pi/2,edge))**2; out[:edge]*=ramp; out[-edge:]*=ramp[::-1]
 out/=max(1e-9,np.max(np.abs(out))/.72)
 pcm=np.int16(np.clip(out,-1,1)*32767)
 tmp=f'{A}/.{name}.wav'
 with wave.open(tmp,'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
 subprocess.run(['/Users/luna/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg','-y','-loglevel','error','-i',tmp,'-c:a','libvorbis','-q:a','5',f'{A}/{name}.ogg'],check=True)
 if name.startswith('bgm_') and name!='bgm_crossing':
  subprocess.run(['/Users/luna/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg','-y','-loglevel','error','-i',tmp,'-codec:a','libmp3lame','-q:a','4',f'{A}/{name}.mp3'],check=True)
 os.remove(tmp)
for era in list(chords):
 if era=='crossing':continue
 make_audio('bgm_'+era,60)
for nm in ['custodian_theme_a','custodian_theme_b','custodian_theme_c','benthic_deal','rival_riff']: make_audio(nm,4)
for nm in ['opp_knock','crisis_pulse']:make_audio(nm,1,1,'sfx')
make_audio('bgm_crossing',30,1,'crossing')
for nm in ['sfx_hit_thud','sfx_gate_chime','sfx_crossing_win']:make_audio(nm,1,1,'sfx')
print('generated')
