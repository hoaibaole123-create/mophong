# -*- coding: utf-8 -*-
"""
Xuat anh kiem tra: khoanh tron vi tri binh da nhan dang tren anh mat bang.
-> tools/verify/floorNN.png
"""
import json, os
from PIL import Image, ImageDraw

OUT = os.path.join("tools", "verify")
COLORS = {"ABC8": (255, 70, 60), "CO25": (70, 140, 255), "CO224": (40, 200, 140)}


def main():
    os.makedirs(OUT, exist_ok=True)
    data = json.load(open(os.path.join("web", "data", "plant.json"), encoding="utf-8"))
    for f in data["floors"]:
        im = Image.open(os.path.join("web", "data", "floors", f["image"])).convert("RGBA")
        bg = Image.new("RGB", im.size, (16, 20, 26))
        bg.paste(im, mask=im.split()[3])
        dr = ImageDraw.Draw(bg)
        x0, y0, x1, y1 = f["box"]
        W, H = bg.size
        n = 0
        for it in data["items"]:
            if it["floor"] != f["page"]:
                continue
            px = (it["bx"] - x0) / (x1 - x0) * W
            py = (it["by"] - y0) / (y1 - y0) * H
            r = 14
            dr.ellipse([px - r, py - r, px + r, py + r], outline=COLORS[it["type"]], width=4)
            n += 1
        dr.text((20, 20), f"{f['name']}  —  {n} binh", fill=(230, 240, 250))
        bg.save(os.path.join(OUT, f["image"]))
        print(f["image"], n)


if __name__ == "__main__":
    main()
