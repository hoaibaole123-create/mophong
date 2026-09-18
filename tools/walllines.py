# -*- coding: utf-8 -*-
"""
Boc TOAN BO tuyen tuong tu vector cua PDF -> web/data/lines.json

Tren ban ve mat bang, tuong luon ve bang HAI NET SONG SONG cach nhau bang be day
tuong (0,10-0,60 m). Net don le (duong gong, duong kich thuoc, net khuat) khong
co ban song song nen bi loai. Nho vay tranh duoc viec bien duong kich thuoc /
gach cheo thanh tuong.

Toa do xuat ra dung he chung voi plant.json (goc = trung diem M1-M2 cua trang).
"""
import json, math, os, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX

PDF = "mặt bằng và vị trí các bình chữa cháy.pdf"
OUT = os.path.join("web", "data", "lines.json")

DAI_MIN = 0.7        # doan ngan hon (m) thi bo
DAY_MIN, DAY_MAX = 0.10, 0.60    # be day tuong cho phep (m)
PHU_MIN = 0.55       # hai net phai gac len nhau it nhat 55% chieu dai net ngan


def doan_thang(page):
    ra = []
    for g in page.get_drawings():
        col = g.get("color") or (0, 0, 0)
        if col[0] > .5 and col[1] < .35 and col[2] < .35:      # net do = ky hieu binh
            continue
        for it in g["items"]:
            if it[0] == "l":
                ra.append((it[1].x, it[1].y, it[2].x, it[2].y))
            elif it[0] == "re":
                r = it[1]
                ra += [(r.x0, r.y0, r.x1, r.y0), (r.x1, r.y0, r.x1, r.y1),
                       (r.x1, r.y1, r.x0, r.y1), (r.x0, r.y1, r.x0, r.y0)]
    return ra


def tim_tuong(segs, mpp):
    """Ghep cac cap net song song cach nhau dung be day tuong -> tuyen tuong."""
    ds = []
    for (x0, y0, x1, y1) in segs:
        L = math.hypot(x1 - x0, y1 - y0) * mpp
        if L < DAI_MIN:
            continue
        goc = math.degrees(math.atan2(y1 - y0, x1 - x0)) % 180
        ds.append((x0, y0, x1, y1, L, goc))
    nhom = {}
    for d in ds:
        nhom.setdefault(round(d[5] / 2) * 2, []).append(d)      # gom theo huong, buoc 2 do
    ra = []
    for goc, ls in nhom.items():
        a = math.radians(goc)
        ux, uy = math.cos(a), math.sin(a)
        nx, ny = -uy, ux
        # chieu moi net len truc doc / truc ngang
        proj = []
        for (x0, y0, x1, y1, L, g) in ls:
            t0 = x0 * ux + y0 * uy
            t1 = x1 * ux + y1 * uy
            n = (x0 * nx + y0 * ny + x1 * nx + y1 * ny) / 2
            proj.append((min(t0, t1), max(t0, t1), n, (x0, y0, x1, y1), L))
        proj.sort(key=lambda p: p[2])
        dung = [False] * len(proj)
        for i in range(len(proj)):
            if dung[i]:
                continue
            a0, a1, na, sa, La = proj[i]
            for j in range(i + 1, len(proj)):
                if dung[j]:
                    continue
                b0, b1, nb, sb, Lb = proj[j]
                day = abs(nb - na) * mpp
                if day > DAY_MAX:
                    break
                if day < DAY_MIN:
                    continue
                phu = (min(a1, b1) - max(a0, b0)) * mpp
                if phu < PHU_MIN * min(La, Lb):
                    continue
                # tim tuyen: nam giua hai net, dai bang doan gac nhau
                t0, t1 = max(a0, b0), min(a1, b1)
                nm = (na + nb) / 2
                p0 = (ux * t0 + nx * nm, uy * t0 + ny * nm)
                p1 = (ux * t1 + nx * nm, uy * t1 + ny * nm)
                ra.append((p0[0], p0[1], p1[0], p1[1], day))
                dung[i] = dung[j] = True
                break
    return ra


def main():
    doc = pymupdf.open(PDF)
    plant = json.load(open(os.path.join("web", "data", "plant.json"), encoding="utf-8"))
    mpp0 = plant["default_unit_spacing_m"] / EX.BASE_UNIT_SPACING_PT
    ra, tk = {}, []
    for f in plant["floors"]:
        pi = f["page"]
        page = doc[pi]
        uc = EX.unit_centers(page, pi)
        if uc is None:
            tk.append((pi, f["elevation"], 0, "khong georef")); continue
        (x1, y1), (x2, y2) = uc
        k = abs(x2 - x1) / EX.BASE_UNIT_SPACING_PT
        mid = ((x1 + x2) / 2, (y1 + y2) / 2)
        mpp = mpp0 / k
        tuong = tim_tuong(doan_thang(page), mpp)
        fp = f.get("footprint")
        out = []
        for (ax, ay, bx, by, day) in tuong:
            u0, v0 = (ax - mid[0]) / k, (ay - mid[1]) / k
            u1, v1 = (bx - mid[0]) / k, (by - mid[1]) / k
            if fp:                       # chi giu trong pham vi mat bang
                if max(u0, u1) < fp[0] - 20 or min(u0, u1) > fp[2] + 20: continue
                if max(v0, v1) < fp[1] - 20 or min(v0, v1) > fp[3] + 20: continue
            out.append([round(u0, 1), round(v0, 1), round(u1, 1), round(v1, 1), round(day, 2)])
        ra[str(pi)] = out
        tk.append((pi, f["elevation"], len(out), "k=%.3f" % k))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"walls": ra}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("trang | EL      | so tuyen tuong | ghi chu")
    for t in tk:
        print(" %2d   | %-7s | %5d          | %s" % t)
    print("TONG:", sum(len(v) for v in ra.values()), "->", OUT)


if __name__ == "__main__":
    main()
