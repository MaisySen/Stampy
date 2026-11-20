"""Make Stampies app icon and splash art. No secrets. No network.
Run from the repo root: python3 scripts/make-assets.py
Writes assets/icon.png and assets/splash.png.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1024, 1024

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

lav = (201, 184, 255)
pink = (255, 179, 217)
peach = (255, 217, 168)
dark = (10, 10, 15)

img = Image.new("RGB", (W, H), dark)
px = img.load()
for y in range(H):
    for x in range(W):
        t = (x + y) / (W + H)
        if t < 0.5:
            c = lerp(lav, pink, t * 2)
        else:
            c = lerp(pink, peach, (t - 0.5) * 2)
        px[x, y] = c

d = ImageDraw.Draw(img, "RGBA")
d.rounded_rectangle([212, 212, 812, 812], radius=180, fill=dark)
d.rounded_rectangle([292, 372, 732, 652], radius=60, outline=(245, 245, 247), width=10)
for i, cx in enumerate(range(352, 700, 86)):
    fill = (201, 184, 255) if i % 2 == 0 else (255, 179, 217)
    d.ellipse([cx, 452, cx + 46, 498], fill=fill)
d.ellipse([352, 552, 398, 598], fill=(255, 217, 168))
d.ellipse([438, 552, 484, 598], fill=(245, 245, 247))
img.save(OUT / "icon.png")

splash = Image.new("RGB", (1242, 2436), dark)
sp = splash.load()
for y in range(2436):
    for x in range(1242):
        t = (x + y) / (1242 + 2436)
        if t < 0.5:
            c = lerp(lav, pink, t * 2)
        else:
            c = lerp(pink, peach, (t - 0.5) * 2)
        sp[x, y] = c
ds = ImageDraw.Draw(splash, "RGBA")
ds.rounded_rectangle([421, 1018, 821, 1418], radius=120, fill=dark)
ds.rounded_rectangle([481, 1138, 761, 1298], radius=40, outline=(245, 245, 247), width=8)
for i, cx in enumerate(range(521, 730, 52)):
    fill = (201, 184, 255) if i % 2 == 0 else (255, 179, 217)
    ds.ellipse([cx, 1188, cx + 28, 1216], fill=fill)
splash.save(OUT / "splash.png")
print("assets written to", OUT)
