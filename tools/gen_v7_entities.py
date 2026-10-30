#!/usr/bin/env python3
"""Generate SPEC v7 §2 world-entity sprites: hazards, pickups, terrain, held items.
Same 96x96 2-frame (idle, active) format as prop sheets; held items 32x32 single frame.
Style: neutral base colors readable across all era palettes; era tint applied in engine."""
import math, random, zlib, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'

# neutral palette (era-agnostic): readable on dark and light
INK   = (16, 16, 16)
DARK  = (52, 48, 44)
MID   = (110, 96, 82)
LIGHT = (196, 178, 150)
PAPER = (228, 216, 190)
RED   = (168, 62, 48)
GREEN = (86, 122, 66)
BLUE  = (70, 96, 138)
GOLD  = (222, 176, 82)
BONE  = (236, 228, 208)
GLOW  = (150, 235, 255)
WHITE = (240, 240, 240)

def png(path, w, h, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def canvas(w, h, rgba=(0, 0, 0, 0)):
    return list(bytes(rgba)) * (w * h)

def px(p, w, h, x, y, c):
    if 0 <= x < w and 0 <= y < h:
        i = (y * w + x) * 4
        p[i:i+4] = [*c, 255]

def rect(p, w, h, x, y, ww, hh, c):
    for yy in range(y, y + hh):
        for xx in range(x, x + ww):
            px(p, w, h, xx, yy, c)

def line(p, w, h, a, b, c, th=2):
    x0, y0 = a; x1, y1 = b
    n = max(1, int(math.hypot(x1 - x0, y1 - y0) * 2))
    for i in range(n + 1):
        t = i / n
        x, y = round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t)
        for dy in range(-th // 2, th // 2 + 1):
            for dx in range(-th // 2, th // 2 + 1):
                px(p, w, h, x + dx, y + dy, c)

def ellipse(p, w, h, cx, cy, rx, ry, c, fill=True):
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if v <= 1.0 and (fill or v >= 0.55):
                px(p, w, h, x, y, c)

def mirror_right(p, w, h):
    """Copy the left half onto the right (mirrored) — for symmetric frames."""
    for y in range(h):
        for x in range(w // 2):
            i1 = (y * w + x) * 4; i2 = (y * w + (w - 1 - x)) * 4
            p[i2:i2+4] = p[i1:i1+4]

W = H = 96

def stickman(p, ox, oy, color=INK, scale=1):
    """Baseline stick figure ~44px tall, feet at oy+44, head center (ox, oy+8)."""
    ellipse(p, W, H, ox, oy + 8, 6 * scale, 6 * scale, color)
    line(p, W, H, (ox, oy + 14), (ox, oy + 32), color, 2)          # spine
    line(p, W, H, (ox, oy + 20), (ox - 9, oy + 27), color, 2)      # arms
    line(p, W, H, (ox, oy + 20), (ox + 9, oy + 27), color, 2)
    line(p, W, H, (ox, oy + 32), (ox - 6, oy + 44), color, 2)      # legs
    line(p, W, H, (ox, oy + 32), (ox + 6, oy + 44), color, 2)

# ---- entity painters: each paints one 96x96 frame; frame B animates -------------
def f_boar(p, active):
    c = DARK if not active else RED
    ellipse(p, W, H, 44, 62, 26, 16, MID)
    ellipse(p, W, H, 66, 56, 10, 9, MID)
    line(p, W, H, (60, 52), (72, 46), BONE, 2)                     # tusk
    for lx in (32, 42, 54, 62):
        line(p, W, H, (lx, 72), (lx, 84 if not active else 80), INK, 3)
    line(p, W, H, (24, 56), (10, 48), INK, 2)                      # tail

def f_wolf(p, active):
    c = INK
    ellipse(p, W, H, 44, 58, 24, 12, c)
    ellipse(p, W, H, 68, 52, 10, 8, c)
    line(p, W, H, (64, 44), (60, 36), c, 2); line(p, W, H, (72, 44), (76, 36), c, 2)  # ears
    for lx in (30, 40, 52, 60):
        line(p, W, H, (lx, 68), (lx + (3 if active else 0), 82), c, 2)
    line(p, W, H, (66, 50), (74, 54), BONE, 1)

def f_dog(p, active):
    ellipse(p, W, H, 42, 60, 20, 11, MID)
    ellipse(p, W, H, 62, 54, 9, 8, MID)
    line(p, W, H, (58, 47), (54, 40), MID, 2)
    for lx in (30, 40, 50, 58):
        line(p, W, H, (lx, 70), (lx - (3 if active else 0), 82), INK, 2)
    line(p, W, H, (24, 56), (14, 66), INK, 2)

def f_bandit(p, active):
    stickman(p, 40, 24, INK)
    line(p, W, H, (40, 32), (52, 40), DARK, 3)                     # hood/cloak
    line(p, W, H, (49, 51), (62, active and 44 or 48), DARK, 3)    # raised knife
    line(p, W, H, (62, 44), (66, 40), RED if active else DARK, 2)

def f_soldier(p, active):
    stickman(p, 40, 24, DARK)
    rect(p, W, H, 32, 34, 17, 12, BLUE)                            # kit vest
    line(p, W, H, (49, 51), (66, active and 42 or 50), INK, 3)     # rifle
    line(p, W, H, (40, 24), (52, 30), DARK, 2)                     # helmet brim

def f_smog(p, active):
    rng = random.Random(7 if active else 3)
    for _ in range(140):
        x, y = rng.randrange(8, 88), rng.randrange(10, 86)
        g = rng.randrange(90, 150)
        px(p, W, H, x, y, (g, g, g - 20))

def f_radiation(p, active):
    ellipse(p, W, H, 48, 52, 30, 30, GREEN, fill=False)
    ellipse(p, W, H, 48, 52, 20, 20, GOLD, fill=False)
    ellipse(p, W, H, 48, 52, 10, 10, RED)
    if active:
        ellipse(p, W, H, 48, 52, 35, 35, (140, 200, 120), fill=False)

def f_datastorm(p, active):
    rng = random.Random(11 if active else 5)
    for i in range(24):
        y = rng.randrange(8, 88)
        c = GLOW if (i % 3 == (1 if active else 0)) else BLUE
        line(p, W, H, (rng.randrange(0, 40), y), (rng.randrange(50, 96), y + rng.randrange(-6, 6)), c, 1)

def f_generic_pickup(p, main, glow):
    ellipse(p, W, H, 48, 66, 13, 10, main)
    ellipse(p, W, H, 48, 66, 13, 10, glow, fill=False)
    if glow:  # active frame: shine
        line(p, W, H, (40, 58), (44, 50), WHITE, 1)

PAINTERS = {
    'hazard_boar': f_boar, 'hazard_wolf': f_wolf, 'hazard_stray_dog': f_dog,
    'hazard_bandit': f_bandit, 'hazard_soldier_patrol': f_soldier,
    'hazard_smog': f_smog, 'hazard_radiation_zone': f_radiation, 'hazard_datastorm': f_datastorm,
    'pickup_grain': lambda p, a: (ellipse(p, W, H, 48, 62, 14, 9, GOLD), ellipse(p, W, H, 48, 62, 8, 5, PAPER)) and None,
    'pickup_berry': lambda p, a: [ellipse(p, W, H, 42 + i * 8, 62, 5, 5, RED) for i in range(3)],
    'pickup_meat': lambda p, a: (ellipse(p, W, H, 48, 64, 12, 8, (150, 80, 60)), line(p, W, H, (36, 64), (62, 60), BONE, 2)),
    'pickup_stone': lambda p, a: ellipse(p, W, H, 48, 64, 10, 8, MID),
    'pickup_spear': lambda p, a: (line(p, W, H, (30, 72), (66, 52), (120, 90, 60), 2), line(p, W, H, (64, 54), (72, 48), BONE, 2)),
    'pickup_torch': lambda p, a: (line(p, W, H, (44, 74), (52, 56), (120, 90, 60), 3), ellipse(p, W, H, 54, 52, 5, 6, RED if not a else GOLD)),
    'pickup_scroll': lambda p, a: (rect(p, W, H, 38, 58, 20, 12, PAPER), line(p, W, H, (38, 60), (58, 60), INK, 1)),
    'pickup_book': lambda p, a: (rect(p, W, H, 38, 60, 20, 12, (90, 60, 110)), rect(p, W, H, 46, 60, 4, 12, GOLD)),
    'pickup_chip': lambda p, a: (rect(p, W, H, 40, 60, 16, 12, INK), rect(p, W, H, 44, 63, 8, 6, GREEN if a else GOLD)),
    'pickup_coin': lambda p, a: (ellipse(p, W, H, 48, 64, 8, 8, GOLD), ellipse(p, W, H, 48, 64, 4, 4, PAPER if a else GOLD)),
    'pickup_invoice': lambda p, a: (rect(p, W, H, 38, 56, 22, 16, PAPER), line(p, W, H, (40, 60), (58, 60), INK, 1), line(p, W, H, (40, 64), (54, 64), INK, 1)),
    'pickup_credit': lambda p, a: (rect(p, W, H, 36, 58, 24, 14, BLUE), rect(p, W, H, 44, 62, 8, 6, GLOW if a else PAPER)),
}

def terr_fruit_tree(p, a):
    rect(p, W, H, 44, 52, 6, 34, (110, 78, 48))
    ellipse(p, W, H, 47, 40, 22, 16, GREEN)
    for i, (fx, fy) in enumerate([(36, 36), (52, 34), (46, 46), (58, 42)]):
        ellipse(p, W, H, fx, fy - (3 if a and i == 1 else 0), 3, 3, RED)

def terr_berry_bush(p, a):
    ellipse(p, W, H, 48, 70, 22, 12, GREEN)
    for i in range(6):
        ellipse(p, W, H, 32 + i * 6, 66 - (2 if a and i % 2 else 0) - (i % 3) * 4, 2, 2, RED)

def terr_grain_stalk(p, a):
    for i in range(5):
        x = 34 + i * 6
        sway = 2 if (a and i % 2) else 0
        line(p, W, H, (x, 84), (x + sway, 48), GOLD, 2)
        ellipse(p, W, H, x + sway, 46, 3, 5, GOLD)

def terr_ledgevine(p, a):
    rng = random.Random(2 if a else 1)
    x = 48
    for y in range(20, 88, 6):
        x += rng.randrange(-4, 5)
        line(p, W, H, (x, y), (x + rng.randrange(-2, 3), y + 6), GREEN, 2)
    if a:
        line(p, W, H, (40, 40), (56, 40), GOLD, 1)

def terr_rubble_ramp(p, a):
    for i in range(6):
        shade = MID if (i + a) % 2 else DARK
        rect(p, W, H, 20 + i * 9, 84 - i * 9, 12, 9 + i * 9, shade)

def terr_crawl_gap(p, a):
    rect(p, W, H, 20, 30, 56, 44, DARK)
    rect(p, W, H, 26, 56, 44, 18, a and PAPER or MID)   # lit gap when active

def terr_dark_cave(p, a):
    ellipse(p, W, H, 48, 60, 34, 30, INK)
    ellipse(p, W, H, 48, 66, 16, 20, a and (10, 10, 14) or (2, 2, 4))

def terr_anchor(p, a):
    ellipse(p, W, H, 48, 70, 12, 6, MID)
    line(p, W, H, (48, 64), (48, 40), INK, 2)
    ellipse(p, W, H, 48, 36, 4, 4, GOLD if a else INK)

TERRAIN = {
    'terr_fruit_tree': terr_fruit_tree, 'terr_berry_bush': terr_berry_bush,
    'terr_grain_stalk': terr_grain_stalk, 'terr_ledgevine': terr_ledgevine,
    'terr_rubble_ramp': terr_rubble_ramp, 'terr_crawl_gap': terr_crawl_gap,
    'terr_dark_cave': terr_dark_cave, 'terr_anchor': terr_anchor,
}

HELD = {
    'held_stone': lambda p: ellipse(p, 32, 32, 16, 16, 7, 6, MID),
    'held_torch': lambda p: (line(p, 32, 32, (14, 22), (18, 12), (120, 90, 60), 3), ellipse(p, 32, 32, 20, 10, 4, 5, GOLD)),
    'held_spear': lambda p: (line(p, 32, 32, (4, 28), (26, 8), (120, 90, 60), 2), line(p, 32, 32, (25, 9), (29, 5), BONE, 2)),
    'held_fruit': lambda p: ellipse(p, 32, 32, 16, 18, 6, 6, RED),
    'held_tool': lambda p: (line(p, 32, 32, (10, 24), (22, 10), (120, 90, 60), 3), rect(p, 32, 32, 18, 6, 8, 6, INK)),
}

def two_frame(name, painter):
    for active in (False, True):
        p = canvas(W, H)
        painter(p, active)

def main():
    made = 0
    def sheet2(name, fn):
        # 192x96 sheet: frame A (idle) | frame B (active) — matches prop_<type>.png 2-frame layout
        sheet = canvas(W*2, H)
        for idx, active in ((0, False), (1, True)):
            p = canvas(W, H)
            fn(p, active)
            for y in range(H):
                sheet[(y*W*2)*4+idx*W*4:(y*W*2)*4+idx*W*4+W*4] = bytes(p[y*W*4:(y+1)*W*4])
        png(str(ASSETS / f'{name}.png'), W*2, H, sheet)

    for name, fn in PAINTERS.items():
        sheet2(name, fn); made += 1
    for name, fn in TERRAIN.items():
        sheet2(name, fn); made += 1
    for name, fn in HELD.items():
        p = canvas(32, 32)
        fn(p)
        png(str(ASSETS / f'{name}.png'), 32, 32, p)
        made += 1
    print(f'generated {made} entity sheets: 8 hazards + 12 pickups + 8 terrain + 5 held = 33')

if __name__ == '__main__':
    main()
