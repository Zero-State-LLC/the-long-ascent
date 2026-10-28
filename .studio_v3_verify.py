from pathlib import Path
from PIL import Image
import subprocess,sys
p=Path('assets/sprites'); expected={}
for e in ['sails','revolution','wars','orbit','green','void']:
 expected[f'costume_{e}.png']=(512,256)
 for l in ['far','near']: expected[f'bg_{e}_{l}.png']=(640,180)
for n in ['sails','ideals','mobilize','orbit','carbon','void','void_pilot']: expected[f'badge_{n}.png']=(24,24)
for n in ['sail_deal','constitution_debate','trench_letter','launch_window','carbon_audit','void_watch','custodian_relic','benthic_contract','rival_compare','arc_chapter']: expected[f'scene_{n}.png']=(1280,180)
expected.update({'ship_lineage.png':(384,96),'obs_derelict.png':(192,96),'obs_comet.png':(96,48),'gate_ring.png':(48,192)})
errs=[]
for f,size in expected.items():
 try:
  im=Image.open(p/f)
  if im.size!=size: errs.append((f,im.size,size))
 except Exception as e: errs.append((f,str(e)))
print('PNG_CHECK',len(expected),'ERRORS',errs)
