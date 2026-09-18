# -*- coding: utf-8 -*-
"""
Trich xuat vi tri DEN EXIT tu "den exit.pdf" -> web/data/exit.json

Ky hieu den exit tren ban ve: hinh chu nhat ~30x9 pt (theo ti le goc) mau den,
ben trong co chu "EXIT" ve bang net. Ban ve nam ngang hoac dung (gan tuong doc).

Toa do xuat ra dung CHUNG he voi plant.json: goc la trung diem tim hai to may
M1-M2 cua chinh trang do, chia cho he so ti le k cua trang.
"""
import json, os, re, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX

PDF = "đèn exit.pdf"
OUT = os.path.join("web", "data", "exit.json")

KHUNG = pymupdf.Rect(70, 30, 1870, 1320)      # vung mat bang, bo khung ten
EL_RE = re.compile(r"AT\s+EL\s*([0-9]+(?:\.[0-9]+)?)\s*M", re.I)


def den(page):
    return [g for g in page.get_drawings()
            if g.get("color") and max(g["color"]) < 0.25]


def tim_den_exit(page, k):
    """Hinh chu nhat co ty le 30:9 (x k) va ben trong co net chu EXIT."""
    nho = [g for g in den(page)
           if g["rect"].width < 12 * k and g["rect"].height < 12 * k]
    ra = []
    for g in den(page):
        r = g["rect"]
        w, h = r.width, r.height
        if not KHUNG.contains(r):
            continue
        ngang = (26 * k < w < 36 * k and 6 * k < h < 13 * k)
        doc = (26 * k < h < 36 * k and 6 * k < w < 13 * k)
        if not (ngang or doc):
            continue
        if not set(it[0] for it in g["items"]) <= {"qu", "l", "re"}:
            continue
        # ben trong phai co net chu EXIT
        trong = pymupdf.Rect(r.x0 + 1, r.y0 + 1, r.x1 - 1, r.y1 - 1)
        chu = sum(1 for q in nho if trong.contains(q["rect"].tl) and trong.contains(q["rect"].br))
        if chu < 4:
            continue
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        if any(abs(cx - a) < 6 * k and abs(cy - b) < 6 * k for a, b, _ in ra):
            continue
        ra.append((cx, cy, "ngang" if ngang else "doc"))
    return ra


def main():
    doc = pymupdf.open(PDF)
    plant = json.load(open(os.path.join("web", "data", "plant.json"), encoding="utf-8"))
    theo_el = {round(f["elevation"], 2): f["page"] for f in plant["floors"]}

    ra, thong_ke = [], []
    for i, page in enumerate(doc):
        m = EL_RE.search(page.get_text())
        el = round(float(m.group(1)), 2) if m else None
        trang_plant = theo_el.get(el)
        uc = EX.unit_centers(page, -1)
        if uc is None or trang_plant is None:
            thong_ke.append((i, el, trang_plant, 0, "bo qua"))
            continue
        (x1, y1), (x2, y2) = uc
        k = abs(x2 - x1) / EX.BASE_UNIT_SPACING_PT
        mid = ((x1 + x2) / 2, (y1 + y2) / 2)
        ds = tim_den_exit(page, k)
        for j, (cx, cy, hd) in enumerate(ds, 1):
            ra.append({
                "id": "EX-%02d-%02d" % (trang_plant, j),
                "floor": trang_plant,
                "bx": round((cx - mid[0]) / k, 2),
                "by": round((cy - mid[1]) / k, 2),
                "dir": hd,                      # ngang / doc theo ban ve
            })
        thong_ke.append((i, el, trang_plant, len(ds), "k=%.3f" % k))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"items": ra}, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("Trang PDF | EL      | trang plant | so den | ghi chu")
    for t in thong_ke:
        print("   %2s     | %-7s | %-11s | %3d    | %s" % t)
    print("TONG:", len(ra), "den exit ->", OUT)


if __name__ == "__main__":
    main()
