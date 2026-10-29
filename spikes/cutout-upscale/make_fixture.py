"""Procedural synthetic 'product on a busy background' fixture + its ground-truth mask (no real photos, no Cloud).

The product is a burnt-orange water bottle (shaded body, black cap, loop handle) drawn over a cluttered
random pattern of tiles, circles and stripes. Writes product_busy.png (RGB, 512x512) and product_gt_mask.png (L).
usage: python make_fixture.py OUT_DIR
"""
import pathlib
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

W = H = 512
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
out.mkdir(parents=True, exist_ok=True)
rnd = random.Random(7)

bg = Image.new("RGB", (W, H), (200, 180, 150))
d = ImageDraw.Draw(bg)
for y in range(0, H, 32):  # patterned tiles
    for x in range(0, W, 32):
        c = rnd.choice([(40, 110, 160), (230, 230, 220), (180, 60, 60), (70, 140, 80), (220, 190, 60)])
        d.rectangle([x, y, x + 31, y + 31], fill=c, outline=(90, 90, 90))
for _ in range(60):  # clutter: fruit-ish circles and utensil-ish bars
    x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.randrange(8, 40)
    c = tuple(rnd.randrange(256) for _ in range(3))
    if rnd.random() < 0.6:
        d.ellipse([x - r, y - r, x + r, y + r], fill=c, outline=(20, 20, 20))
    else:
        d.rectangle([x, y, x + rnd.randrange(60, 160), y + rnd.randrange(4, 10)], fill=c)
bg = bg.filter(ImageFilter.GaussianBlur(2.5))  # shallow depth of field

# product layer + exact mask
mask = Image.new("L", (W, H), 0)
prod = Image.new("RGB", (W, H))
md, pd = ImageDraw.Draw(mask), ImageDraw.Draw(prod)
body = [196, 150, 316, 440]
for i in range(body[0], body[2]):  # cylindrical shading
    t = (i - body[0]) / (body[2] - body[0])
    k = 0.55 + 0.6 * (1 - abs(t - 0.35) * 1.8)
    pd.line([i, body[1], i, body[3]], fill=(int(min(255, 210 * k)), int(min(255, 95 * k)), int(min(255, 30 * k))))
md.rounded_rectangle(body, radius=28, fill=255)
cap = [214, 92, 298, 156]
pd.rounded_rectangle(cap, radius=10, fill=(25, 25, 28))
md.rounded_rectangle(cap, radius=10, fill=255)
pd.rectangle([224, 108, 288, 112], fill=(60, 60, 64))
pd.ellipse([234, 52, 278, 104], outline=(25, 25, 28), width=10)  # loop handle (hole shows background)
md.ellipse([234, 52, 278, 104], outline=255, width=10)

img = Image.composite(prod, bg, mask)
img.save(out / "product_busy.png")
mask.save(out / "product_gt_mask.png")
print("wrote", out / "product_busy.png", out / "product_gt_mask.png")
