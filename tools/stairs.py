# -*- coding: utf-8 -*-
"""
Do tim VE THANG BO tren tung trang mat bang -> web/data/stairs.json

Dau hieu cua mot ve thang: mot chum >= 5 doan thang SONG SONG, DAI GAN BANG NHAU
(= bac thang), nam CACH DEU nhau theo phuong vuong goc, buoc 0.20-0.50 m.
Toa do xuat ra dung chung he voi plant.json (goc = trung diem M1-M2 cua trang).
"""
import json, math, os, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX

PDF = "mặt bằng và vị trí các bình chữa cháy.pdf"
OUT = os.path.join("web", "data", "stairs.json")

BAC_MIN = 5          # it nhat 5 bac moi coi la ve thang
RONG = (0.7, 2.6)    # be rong ve thang cho phep (m)
BUOC = (0.18, 0.55)  # buoc bac (m)


def doan_thang(page):
    """Tat ca doan thang mau toi tren trang (bo net do cua ky hieu binh)."""
    ra = []
    for g in page.get_drawings():
        col = g.get("color")
        if col and col[0] > .5 and col[1] < .3:      # net do -> ky hieu binh chua chay
            continue
        for it in g["items"]:
            if it[0] == "l":
                ra.append((it[1].x, it[1].y, it[2].x, it[2].y))
            elif it[0] == "re":
                r = it[1]
                ra += [(r.x0, r.y0, r.x1, r.y0), (r.x1, r.y0, r.x1, r.y1),
                       (r.x1, r.y1, r.x0, r.y1), (r.x0, r.y1, r.x0, r.y0)]
    return ra


def tim_ve_thang(segs, mpp):
    """segs: doan thang theo don vi ban ve goc. Tra ve cac ve thang tim duoc."""
    nhom = {}
    for (x0, y0, x1, y1) in segs:
        L = math.hypot(x1 - x0, y1 - y0) * mpp
        if not (RONG[0] <= L <= RONG[1]):
            continue
        goc = math.degrees(math.atan2(y1 - y0, x1 - x0)) % 180
        nhom.setdefault(round(goc / 3) * 3, []).append(
            ((x0 + x1) / 2, (y0 + y1) / 2, L, goc, x0, y0, x1, y1))

    ve = []
    for goc3, ds in nhom.items():
        a = math.radians(goc3)
        ux, uy = math.cos(a), math.sin(a)            # doc theo bac
        nx, ny = -uy, ux                             # vuong goc = huong len thang
        # chieu tam moi bac len hai truc
        ds = [(d, d[0] * nx + d[1] * ny, d[0] * ux + d[1] * uy) for d in ds]
        ds.sort(key=lambda z: z[1])
        i = 0
        while i < len(ds):
            cum = [ds[i]]
            j = i + 1
            while j < len(ds):
                d, t, s = ds[j]
                dt = (t - cum[-1][1]) * mpp
                if dt > BUOC[1]:
                    break
                # cung ve thang: lech doc < 1/2 be rong bac va dai xap xi nhau
                if abs(s - cum[-1][2]) * mpp < d[2] * .6 and abs(d[2] - cum[0][0][2]) < cum[0][0][2] * .35:
                    if dt >= BUOC[0] or len(cum) == 1:
                        cum.append(ds[j])
                j += 1
            if len(cum) >= BAC_MIN:
                buoc = [(cum[q + 1][1] - cum[q][1]) * mpp for q in range(len(cum) - 1)]
                tb = sum(buoc) / len(buoc)
                lech = max(abs(b - tb) for b in buoc)
                if BUOC[0] <= tb <= BUOC[1] and lech < tb * .6:
                    xs = [c[0][0] for c in cum]; ys = [c[0][1] for c in cum]
                    rong = sum(c[0][2] for c in cum) / len(cum)
                    ve.append(dict(x0=xs[0], y0=ys[0], x1=xs[-1], y1=ys[-1],
                                   rong=rong, bac=len(cum), buoc=tb))
                i = ds.index(cum[-1]) + 1
            else:
                i += 1
    # bo cac ve trung nhau
    ra = []
    for v in sorted(ve, key=lambda v: -v["bac"]):
        if any(math.hypot((v["x0"] + v["x1"]) / 2 - (w["x0"] + w["x1"]) / 2,
                          (v["y0"] + v["y1"]) / 2 - (w["y0"] + w["y1"]) / 2) * mpp < 1.5 for w in ra):
            continue
        ra.append(v)
    return ra


def main():
    doc = pymupdf.open(PDF)
    plant = json.load(open(os.path.join("web", "data", "plant.json"), encoding="utf-8"))
    mpp0 = plant["default_unit_spacing_m"] / EX.BASE_UNIT_SPACING_PT
    ra, tk = [], []
    for f in plant["floors"]:
        pi = f["page"]
        page = doc[pi]
        uc = EX.unit_centers(page, pi)
        if uc is None:
            tk.append((pi, f["elevation"], 0, "khong georef")); continue
        (x1, y1), (x2, y2) = uc
        k = abs(x2 - x1) / EX.BASE_UNIT_SPACING_PT
        mid = ((x1 + x2) / 2, (y1 + y2) / 2)
        mpp = mpp0 / k                                # met / point cua trang nay
        ds = tim_ve_thang(doan_thang(page), mpp)
        for i, v in enumerate(ds, 1):
            ra.append(dict(id="ST-%02d-%02d" % (pi, i), floor=pi,
                           u0=round((v["x0"] - mid[0]) / k, 2), v0=round((v["y0"] - mid[1]) / k, 2),
                           u1=round((v["x1"] - mid[0]) / k, 2), v1=round((v["y1"] - mid[1]) / k, 2),
                           rong=round(v["rong"], 2), bac=v["bac"], buoc=round(v["buoc"], 3)))
        tk.append((pi, f["elevation"], len(ds), "k=%.3f" % k))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"items": ra}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("trang | EL      | so ve thang | ghi chu")
    for t in tk:
        print(" %2d   | %-7s | %3d         | %s" % t)
    print("TONG:", len(ra), "->", OUT)


if __name__ == "__main__":
    main()
