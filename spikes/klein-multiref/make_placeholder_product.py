"""Procedural placeholder product image (plain test image, no diffusion): sage-green mug on white, 768x768."""
import sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1] if len(sys.argv) > 1 else "placeholder_mug.png"
W = 768
img = Image.new("RGB", (W, W), (255, 255, 255))
shadow = Image.new("L", (W, W), 0)
ImageDraw.Draw(shadow).ellipse((210, 560, 560, 610), fill=90)
img.paste((200, 200, 200), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
d = ImageDraw.Draw(img)
body = (240, 230, 500, 585)
d.ellipse((470, 300, 600, 470), outline=(120, 150, 125), width=34)  # handle
d.rounded_rectangle(body, radius=40, fill=(140, 170, 145))
for x in range(250, 495, 6):  # simple left-to-right shading
    t = (x - 250) / 245
    c = tuple(int(v * (1.08 - 0.25 * t)) for v in (140, 170, 145))
    d.line((x, 250, x, 565), fill=c, width=6)
d.ellipse((240, 205, 500, 255), fill=(214, 196, 160))  # rim
d.ellipse((256, 213, 484, 247), fill=(90, 110, 95))     # inside
d.rectangle((262, 568, 478, 585), fill=(214, 196, 160))  # unglazed base
img.save(out)
print("wrote", out)
