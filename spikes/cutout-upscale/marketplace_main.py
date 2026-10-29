"""Marketplace main-image compliance prototype (local, Pillow only, no Cloud).

Takes an RGBA cutout, trims it to its alpha bounding box, scales it so the product's longer side fills
FILL (default 85%) of a SIZE x SIZE (default 2000) pure #FFFFFF canvas, centres it, flattens to RGB and
checks: the cutout really has transparency (>=5% of its bbox), border band pixels >= 99% exactly #FFFFFF, product fill ratio, canvas size.
usage: python marketplace_main.py CUTOUT_RGBA.png OUT.png [--size 2000] [--fill 0.85] [--border 20]
exit 0 = compliant, 1 = not compliant.
"""
import argparse
import sys

from PIL import Image


def compose(cutout, size=2000, fill=0.85, alpha_floor=8):
    im = cutout.convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v >= alpha_floor else 0)  # ignore near-zero alpha haze
    bbox = a.getbbox()
    if not bbox:
        raise ValueError("cutout has an empty alpha channel")
    im = im.crop(bbox)
    hist = im.getchannel("A").histogram()
    transparent = sum(hist[:alpha_floor]) / (im.width * im.height)  # 0.0 for an opaque photo = not a cutout
    scale = fill * size / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas, im.size, transparent


def check(img, product_size, transparent, size=2000, fill=0.85, border=20):
    px = img.load()
    w, h = img.size
    total = white = 0
    for y in range(h):
        xs = range(w) if (y < border or y >= h - border) else list(range(border)) + list(range(w - border, w))
        for x in xs:
            total += 1
            white += px[x, y] == (255, 255, 255)
    border_white = white / total
    fill_ratio = max(product_size) / size
    res = {
        "canvas": img.size, "mode": img.mode,
        "border_white_ratio": round(border_white, 5),
        "product_px": product_size, "cutout_transparent_fraction": round(transparent, 4), "fill_ratio_longer_side": round(fill_ratio, 4),
    }
    # an opaque (un-cut) photo letterboxed on white would pass the border test, so also require real transparency
    res["ok"] = (transparent >= 0.05 and img.size == (size, size) and img.mode == "RGB" and border_white >= 0.99
                 and abs(fill_ratio - fill) <= 0.01)
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cutout"); ap.add_argument("out")
    ap.add_argument("--size", type=int, default=2000); ap.add_argument("--fill", type=float, default=0.85)
    ap.add_argument("--border", type=int, default=20, help="border band width in px that must be white")
    a = ap.parse_args()
    canvas, psize, transp = compose(Image.open(a.cutout), a.size, a.fill)
    canvas.save(a.out, quality=95) if a.out.lower().endswith((".jpg", ".jpeg")) else canvas.save(a.out)
    r = check(Image.open(a.out).convert("RGB") if Image.open(a.out).mode != "RGB" else Image.open(a.out), psize, transp, a.size, a.fill, a.border)  # verify the file as written (JPEG ringing included)
    print(r)
    sys.exit(0 if r["ok"] else 1)
