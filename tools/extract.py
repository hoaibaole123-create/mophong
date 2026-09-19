# -*- coding: utf-8 -*-
"""
Trich xuat vi tri binh chua chay tu bo ban ve ANDRITZ (Ialy HPP Extension)
-> web/data/plant.json  +  web/data/floors/*.png
"""
import json, math, os, re, collections
import pymupdf
import walls as WALLS
import doors as DOORS

PDF = "mặt bằng và vị trí các bình chữa cháy.pdf"
OUT_DIR = os.path.join("web", "data")
IMG_DIR = os.path.join(OUT_DIR, "floors")

# khoang cach tim hai to may M1-M2 o ti le goc (pt tren ban ve)
BASE_UNIT_SPACING_PT = 350.64
# gia dinh hieu chinh: khoang cach tim to may M1-M2 ngoai thuc te (m)
DEFAULT_UNIT_SPACING_M = 22.0

# cua so anh mat bang xuat ra, tinh theo pt o ti le goc quanh tam 2 to may
WIN = dict(x0=-690, x1=1130, y0=-650, y1=520)
IMG_DPI = 150

FLOORS = [
    (0,  "EL. 348.00 — Sàn gian máy",              348.00, "Sàn gian máy / cầu trục"),
    (1,  "EL. 339.10 — Sàn điều khiển trung tâm",  339.10, "Phòng điều khiển, phòng ắc quy"),
    (2,  "EL. 331.40 — Sàn thiết bị phân phối",    331.40, "Phòng thiết bị G-Voltage & phụ trợ"),
    (3,  "EL. 323.70 — Sàn thiết bị AC & DC",      323.70, "Phòng thiết bị AC & DC"),
    (4,  "EL. 316.60 — Sàn trung gian",            316.60, ""),
    (5,  "EL. 309.50 — Sàn tủ kích từ",            309.50, "Phòng tủ kích từ"),
    (6,  "EL. 303.90 — Sàn tuabin",                303.90, ""),
    (7,  "EL. 298.30 — Sàn buồng xoắn",            298.30, ""),
    (8,  "EL. 292.70 — Sàn ống hút",               292.70, ""),
    (9,  "EL. 288.65 — Sàn đáy ống hút",           288.65, ""),
    (10, "EL. 521.25 — Nhà van cửa nhận nước", 521.25, "Công trình riêng, tách khỏi nhà máy"),
]

# cong trinh rieng: pt tren mot met (do tu duong kich thuoc 16200 mm) va goc toa do
STANDALONE_PT_PER_M = {10: 1111.68 / 16.2}
STANDALONE_ORIGIN = {10: (1004.15, 858.0)}   # giua nha van (truc 3-4 / truc B)
STANDALONE_WIN = dict(x0=-11.0, x1=11.0, y0=-8.0, y1=8.0)   # met

# Bao khoi cong trinh tung cao trinh (don vi ban ve goc, do tu mat bang).
# Trang 11 la cong trinh rieng nen dung don vi met.
FOOTPRINT = {
    0:  [-420, -625, 1075,  205],
    1:  [-420, -560, 1075,  200],
    2:  [-410, -520, 1065,  200],
    3:  [-400, -510, 1060,  195],
    4:  [-400, -450,  700,  195],
    5:  [-400, -440,  640,  190],
    6:  [-390, -310,  470,  185],
    7:  [-380, -310,  470,  180],
    8:  [-380, -310,  470,  180],
    9:  [-430, -110,  500,  240],
    10: [-8.25, -6.47, 8.25, 1.53],
}

# Tuong ve tay (doc truc tiep tu mat bang) - uu tien hon ket qua tu dong.
# Don vi: ban ve goc; [x0, y0, x1, y1].
MANUAL_WALLS = {
    1: [   # EL. 339.10 - san dieu khien trung tam
        [-412, -455, 1062, -437],   # tuong sau, giap khoi da
        [-412, -455, -400, -266],   # dau hoi trai
        [1050, -455, 1062, -266],   # dau hoi phai
        [-338, -440, -326, -300],   # vach canh thang bo CT.2
        [-174, -440, -162, -310],   # P1002 | P1003
        [70,   -440, 82,   -310],   # P1003 | P1004
        [212,  -440, 224,  -310],   # P1004 | P1005
        [330,  -440, 342,  -310],   # P1005
        [430,  -440, 442,  -310],   # P1005 | P1006
        [500,  -440, 512,  -310],   # P1006
        [666,  -440, 678,  -310],   # khu doc | P1007
        [820,  -440, 832,  -310],   # P1007 | P1008
    ],
}

# trang -> (tim to may trai, tim to may phai) tinh bang pt tren trang PDF
MANUAL_UNITS = {
    0: ((736.17, 766.47), (1086.81, 766.47)),
    9: ((745.00, 438.00), (1447.00, 438.00)),
}

TYPES = {
    "ABC": dict(code="ABC8", label="Bình bột ABC 8kg (MFZL-8)", color="#e23b2e"),
    "CO2_5": dict(code="CO25", label="Bình CO₂ 5kg (MT-5)", color="#2f74d0"),
    "CO2_24": dict(code="CO224", label="Bình CO₂ 24kg xe đẩy (MT-24)", color="#1f9d6b"),
}

ROOM_RE = re.compile(r"^(P\d{3,4}|CT\.\d|TG|HG|TM|MDB-\d|AxT\d)$", re.I)

ALL_RED = []


def is_red(c):
    return c is not None and c[0] > 0.5 and c[1] < 0.45 and c[2] < 0.45


def red_paths(page):
    return [d for d in page.get_drawings()
            if (is_red(d.get("color")) or is_red(d.get("fill")))
            and d["rect"].width > 0 and d["rect"].height > 0]


def segments(path):
    return [(it[1], it[2]) for it in path["items"] if it[0] == "l"]


def is_triangle(path):
    s = segments(path)
    if len(s) != 3:
        return False
    return sum(1 for a, b in s if abs(a.x - b.x) > 0.3 and abs(a.y - b.y) > 0.3) >= 2


def legend_boxes(page):
    boxes = []
    for w in page.get_text("words"):
        if w[4].upper() == "SYMBOLS":
            boxes.append(pymupdf.Rect(w[0] - 150, w[1] - 45, w[0] + 780, w[3] + 160))
    return boxes


def inner_kind(rect, fills):
    """Hinh ben trong tam giac: vuong=ABC, tam giac=CO2 5kg, tron=CO2 24kg."""
    def inside(rq):
        return (rect.x0 - 1 <= rq.x0 and rq.x1 <= rect.x1 + 1
                and rect.y0 - 1 <= rq.y0 and rq.y1 <= rect.y1 + 1)
    for q in ALL_RED:
        rq = q["rect"]
        if rect.width * 0.2 < rq.width < rect.width * 0.8 and inside(rq) \
           and any(it[0] == "c" for it in q["items"]):
            return "CO2_24"
    best = None
    for q in fills:
        rq = q["rect"]
        if rq.width < rect.width * 0.8 and inside(rq):
            if best is None or rq.width > best["rect"].width:
                best = q
    if best is None:
        return "ABC"
    segs = segments(best)
    axis = sum(1 for a, b in segs if abs(a.x - b.x) < 0.25 or abs(a.y - b.y) < 0.25)
    return "ABC" if (len(segs) >= 4 or axis >= 3) else "CO2_5"


def find_symbols(page):
    global ALL_RED
    ALL_RED = red_paths(page)
    skip = legend_boxes(page)
    fills = [p for p in ALL_RED if p.get("fill") is not None]
    seen, out = set(), []
    for p in ALL_RED:
        r = p["rect"]
        if p.get("fill") is not None or not is_triangle(p):
            continue
        if not (4 < r.width < 45):
            continue
        if r.height < r.width * 0.72 or r.height > r.width * 1.28:
            continue
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        if any(b.contains(pymupdf.Point(cx, cy)) for b in skip):
            continue
        key = (round(r.x0, 1), round(r.y0, 1))
        if key in seen:
            continue
        seen.add(key)
        out.append((cx, cy, r.width, inner_kind(r, fills)))
    res = []
    for x, y, w, k in out:
        if any(w < w2 * 0.75 and abs(x - x2) < w2 and abs(y - y2) < w2
               for x2, y2, w2, _ in out):
            continue
        res.append((x, y, w, k))
    if res:
        modal = collections.Counter(round(r[2]) for r in res).most_common(1)[0][0]
        res = [r for r in res if modal * 0.55 <= r[2] <= modal * 2.5]
    return res


def unit_centers(page, idx):
    if idx in MANUAL_UNITS:
        return MANUAL_UNITS[idx]
    circ = []
    for d in page.get_drawings():
        r = d["rect"]
        if abs(r.width - r.height) < 1.5 and 100 < r.width < 400 and any(it[0] == "c" for it in d["items"]):
            circ.append((round(r.width, 1), round((r.x0 + r.x1) / 2, 2), round((r.y0 + r.y1) / 2, 2)))
    circ = sorted(set(circ), reverse=True)
    for i, a in enumerate(circ):
        for b in circ[i + 1:]:
            if abs(a[0] - b[0]) < 1.0 and abs(a[2] - b[2]) < 2.0 and 300 < abs(a[1] - b[1]) < 900:
                p1, p2 = sorted([a, b], key=lambda t: t[1])
                return (p1[1], p1[2]), (p2[1], p2[2])
    return None


def rooms(page):
    out = []
    for w in page.get_text("words"):
        t = w[4].strip()
        if ROOM_RE.match(t) and (w[2] - w[0]) > 4:
            out.append((t.upper(), (w[0] + w[2]) / 2, (w[1] + w[3]) / 2))
    return out


def legend_quantities(page):
    t = page.get_text()
    out = {}
    for m in re.finditer(r"FIRE\s+EXTINGUISHER\s+(ABC|CO2)\s*(\d+)kg[^\n]*\n(?:QUANTITY\s*\n)?\s*(\d+)\s*\n", t):
        kind = "ABC" if m.group(1) == "ABC" else ("CO2_5" if m.group(2) == "5" else "CO2_24")
        out.setdefault(kind, int(m.group(3)))
    return out


def ink_sampler(page, dpi=100):
    """Do mat do net ve (gach cheo) trong mot vung toa do trang PDF."""
    import numpy as np
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    ink = 1.0 - a.min(axis=2).astype(np.float32) / 255.0
    s = dpi / 72.0

    def sample(x0, y0, x1, y1, shrink=0.22):
        mx, my = (x1 - x0) * shrink, (y1 - y0) * shrink
        a0, a1 = int((x0 + mx) * s), int((x1 - mx) * s)
        b0, b1 = int((y0 + my) * s), int((y1 - my) * s)
        a0, b0 = max(a0, 0), max(b0, 0)
        a1, b1 = min(a1, ink.shape[1]), min(b1, ink.shape[0])
        if a1 - a0 < 2 or b1 - b0 < 2:
            return None
        return float(ink[b0:b1, a0:a1].mean())
    return sample


def blank_sheet_furniture(page):
    """Xoá trắng khung tên, bảng kê và khối chi tiết để ảnh mặt bằng sạch."""
    white = (1, 1, 1)
    boxes = [pymupdf.Rect(1810, 1075, page.rect.x1, page.rect.y1)]      # khung tên
    boxes += legend_boxes(page)                                          # bảng kê
    for im in page.get_images(full=True):                                # poster trong khối chi tiết
        try:
            r = page.get_image_bbox(im)
        except Exception:
            continue
        if r.width > 90:
            boxes.append(pymupdf.Rect(r.x0 - 300, r.y0 - 110, r.x1 + 180, r.y1 + 300))
    for b in boxes:
        page.draw_rect(b & page.rect, color=None, fill=white, overlay=True)


def to_line_art(pix):
    """Nền trắng -> trong suốt; nét đen -> xám sáng; giữ nguyên nét màu (đỏ/xanh)."""
    import numpy as np
    from PIL import Image
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.int16)
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    lum = (0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2])
    alpha = np.clip((255 - lum) * 1.85, 0, 255).astype(np.uint8)
    colored = (mx - mn) > 45
    out = np.zeros((pix.height, pix.width, 4), dtype=np.uint8)
    out[:, :, 0] = 214; out[:, :, 1] = 223; out[:, :, 2] = 232
    scale = np.where(mx > 0, 255.0 / np.maximum(mx, 1), 1.0)
    for c in range(3):
        out[:, :, c] = np.where(colored, np.clip(a[:, :, c] * scale, 0, 255), out[:, :, c])
    out[:, :, 3] = np.where(colored, 255, alpha)
    return Image.fromarray(out, "RGBA")


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    doc = pymupdf.open(PDF)
    floors, items, warnings = [], [], []
    seq = 0
    for page_idx, name, elev, note in FLOORS:
        page = doc[page_idx]
        uc = unit_centers(page, page_idx)
        syms = find_symbols(page)
        legend = legend_quantities(page)
        found = collections.Counter(s[3] for s in syms)
        cmp_found = {TYPES[k]["code"]: v for k, v in found.items()}
        cmp_legend = {TYPES[k]["code"]: v for k, v in legend.items()}
        if legend and cmp_found != cmp_legend:
            warnings.append(f"Trang {page_idx+1}: nhận dạng {cmp_found} / bảng kê {cmp_legend}")

        if uc:
            (x1, y1), (x2, y2) = uc
            k = (x2 - x1) / BASE_UNIT_SPACING_PT
            mid = ((x1 + x2) / 2, (y1 + y2) / 2)
            georef = "unit-axis"
        else:
            # công trình riêng: toạ độ xuất ra là mét thật, suy từ kích thước
            # ghi trên bản vẽ (16200 mm = 1111.68 pt trên trang 11)
            k = STANDALONE_PT_PER_M.get(page_idx, 68.62)
            mid = STANDALONE_ORIGIN.get(page_idx, (1004.0, 858.0))
            georef = "standalone"

        rm = rooms(page)
        for px, py, w, kind in syms:
            bx, by = (px - mid[0]) / k, (py - mid[1]) / k
            room = None
            if rm:
                r = min(rm, key=lambda t: (t[1] - px) ** 2 + (t[2] - py) ** 2)
                if math.hypot(r[1] - px, r[2] - py) / k < 260:
                    room = r[0]
            seq += 1
            items.append(dict(id=f"FE-{seq:03d}", floor=page_idx, type=TYPES[kind]["code"],
                              bx=round(bx, 2), by=round(by, 2), room=room))

        blank_sheet_furniture(page)
        win = STANDALONE_WIN if georef == "standalone" else WIN
        ink = ink_sampler(page)
        wall_list, cab_list = (WALLS.wall_rects(
            page, mid, k, FOOTPRINT[page_idx], ink=ink,
            min_len=1.8 if georef == "standalone" else 30.0,
            margin=1.2 if georef == "standalone" else 25.0,
            max_thick=1.8 if georef == "standalone" else 34.0)
            if FOOTPRINT.get(page_idx) else ([], []))
        # tuong ve tay duoc CONG THEM vao ket qua tu dong (khong thay the),
        # de vua giu dung hinh hoc that vua chac chan co cac buc chinh
        if page_idx in MANUAL_WALLS:
            wall_list = wall_list + [list(w) for w in MANUAL_WALLS[page_idx]]
        door_list = DOORS.door_rects(page, mid, k, wall_list,
                                     min_w=0.55 if georef == "standalone" else 8.0,
                                     max_w=2.4 if georef == "standalone" else 42.0,
                                     near=1.2 if georef == "standalone" else 20.0)

        clip = pymupdf.Rect(mid[0] + win["x0"] * k, mid[1] + win["y0"] * k,
                            mid[0] + win["x1"] * k, mid[1] + win["y1"] * k) & page.rect
        dpi = int(max(60, min(200, 2600 / (clip.width / 72))))
        pix = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
        fn = f"floor{page_idx:02d}.png"
        to_line_art(pix).save(os.path.join(IMG_DIR, fn))
        floors.append(dict(
            page=page_idx, name=name, elevation=elev, note=note, image=fn,
            georef=georef, scale=round(k, 4),
            box=[round((clip.x0 - mid[0]) / k, 2), round((clip.y0 - mid[1]) / k, 2),
                 round((clip.x1 - mid[0]) / k, 2), round((clip.y1 - mid[1]) / k, 2)],
            footprint=FOOTPRINT.get(page_idx),
            walls=wall_list, cabinets=cab_list, doors=door_list,
            legend={TYPES[a]["code"]: b for a, b in legend.items()},
            count=cmp_found))
        print(f"trang {page_idx+1:2d}  {name:40s} {len(syms):3d} binh  {cmp_found}  {georef} k={k:.3f}")

    data = dict(
        project="Nhà máy thuỷ điện Ialy mở rộng (2×180MW) — Bình chữa cháy xách tay",
        source=PDF,
        drawing="IALY-P40-AH-300-LAY-SGA-DG-1932-DI",
        base_unit_spacing_pt=BASE_UNIT_SPACING_PT,
        default_unit_spacing_m=DEFAULT_UNIT_SPACING_M,
        types={v["code"]: dict(label=v["label"], color=v["color"]) for v in TYPES.values()},
        floors=floors, items=items, warnings=warnings)
    with open(os.path.join(OUT_DIR, "plant.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("\nTong:", len(items), collections.Counter(i["type"] for i in items))
    for w in warnings:
        print("  ! ", w)


if __name__ == "__main__":
    main()
