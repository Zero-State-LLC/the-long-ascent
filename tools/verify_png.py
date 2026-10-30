import struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SIG=b'\x89PNG\r\n\x1a\n'; files=sorted((ROOT/'assets/sprites').rglob('*.png')); errors=[]; dims={}
for path in files:
 data=path.read_bytes()
 if len(data)<24 or data[:8]!=SIG or data[12:16]!=b'IHDR': errors.append(f'{path}: invalid PNG signature/IHDR'); continue
 w,h=struct.unpack('>II',data[16:24]); dims[path.name]=(w,h)
 if path.name.startswith('scene_') and (w,h)!=(1280,180): errors.append(f'{path}: expected 1280x180, got {w}x{h}')
 if path.name.startswith('costume_') and (w,h)!=(512,256): errors.append(f'{path}: expected 512x256, got {w}x{h}')
 if path.name.startswith('bg_') and (w,h)!=(640,180): errors.append(f'{path}: expected 640x180, got {w}x{h}')
print(f'checked {len(files)} PNG files; scenes={sum(n.startswith("scene_") for n in dims)}, costumes={sum(n.startswith("costume_") for n in dims)}, backgrounds={sum(n.startswith("bg_") for n in dims)}')
print(f'scene sheets 1280x180: {sum(n.startswith("scene_") and d==(1280,180) for n,d in dims.items())}; costumes 512x256: {sum(n.startswith("costume_") and d==(512,256) for n,d in dims.items())}')
if errors: print('\n'.join(errors)); raise SystemExit(1)
