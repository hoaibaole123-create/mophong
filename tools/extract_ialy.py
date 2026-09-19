# -*- coding: utf-8 -*-
"""
Dung bo du lieu cho NHA MAY IALY (nha may cu) tu
"SD chi dan thoat nan va bo tri phuong tien PCCC&CNCH NMTD Ialy.pdf"

  -> web/data/ialy/plant.json
  -> web/data/ialy/exit.json
  -> web/data/ialy/floors/*.png

Chay:  python tools/extract_ialy.py
"""
import json, os, re, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialy_do as DO

# Ten thiet bi IN TREN BAN VE (doc bang mat, xem ialy_gan_ten.py). Khong co
# file nay thi thiet bi giu ma tu danh.
try:
    TEN_VE = json.load(open(os.path.join("tools", "ialy_ten_gan.json"), encoding="utf-8"))
except OSError:
    TEN_VE = {}

PDF = "SD chi dan thoat nan va bo tri phuong tien PCCC&CNCH NMTD Ialy.pdf"
OUT = os.path.join("web", "data", "ialy")
IMG = os.path.join(OUT, "floors")
DPI = 150

# 1 pt tren ban ve ~ 0,1 m ngoai thuc te (uoc luong chung cho ca bo).
# Doi bang o "Hieu chinh ti le" trong ung dung neu can.
PT_TREN_DON_VI = 220.0
MET_MOI_DON_VI = 22.0

# Chi binh xach tay va nut an moi la "item" (cham mau tren mat bang).
# Hong lay nuoc dung nhu ben Ialy mo rong: doi tuong 'hong' -> tu hop ho ap
# lung vao tuong, xem web/data/ialy/custom.json.
LOAI = {
    "binhBot":  ("ABC8",  "Bình bột ABC chữa cháy xách tay", "#e23b2e"),
    "binhKhi":  ("CO2",   "Bình CO₂ chữa cháy xách tay", "#2f74d0"),
    "nutBao":   ("NUTBAO", "Nút ấn báo cháy",            "#e0a030"),
}

# Trang nao la ban sao cua trang nao (ban ve ra hai lan gan giong het).
# Giu ban CO NHIEU THIET BI hon.
def gomTrungLap(kq):
    bo, dung = set(), []
    for i, a in enumerate(kq):
        if i in bo:
            continue
        nhom = [i]
        for j in range(i + 1, len(kq)):
            if j in bo or kq[j]["ten"] != a["ten"]:
                continue
            nhom.append(j); bo.add(j)
        nhom.sort(key=lambda k: -sum(len(v) for v in kq[k]["kyHieu"].values()))
        dung.append(nhom[0])
    return sorted(dung)


def tenTrang(page, i):
    t = page.get_text()
    m = re.search(r"PCCC&CNCH\s*(?:TẠI|TẦNG)?\s*▼?\s*([^\n]{1,40})", t)
    ten = m.group(1).strip() if m else "Trang %d" % (i + 1)
    ten = re.sub(r"\s+", " ", ten).strip(" ;")
    # co trang viet nguoc: "; CHI DAN THOAT NAN TAI <khu>" -> bo phan mo dau
    ten = re.sub(r"^CHỈ DẪN THOÁT ?NẠN TẠI ?", "", ten, flags=re.I).strip()
    m = re.match(r"^(\d{2}) NHÀ PK$", ten)
    if m:
        return "Nhà PK — tầng %s" % m.group(1)
    if ten.upper() == "ÂM NHÀ PK":
        return "Nhà PK — tầng âm"
    if ten.upper() == "HÀNG LANG":
        return "Hành lang"
    if re.match(r"^\d{3}M$", ten):
        # EL 323/327/332 la GIAN BIEN AP — ban ve danh ma thiet bi o day la
        # HCC-BA.. (bien ap), khac han HCC-GM.. cua gian may ben duoi.
        cao = int(ten[:3])
        return "EL. %s — %s" % (ten[:3],
                                "gian biến áp" if cao >= 320 else "gian máy")
    return ten


def caoTrinh(ten, thuTu):
    """Cao trinh tu ten. Nha PK xep deu 4 m mot tang, cong trinh rieng xep ke tiep."""
    m = re.match(r"^EL\. (\d{3})", ten)
    if m:
        return float(m.group(1))
    m = re.search(r"tầng (\d+)", ten)
    if m:                                        # tang 01 thap nhat, tang 09 cao nhat
        return 240.0 + int(m.group(1)) * 4.0
    if "tầng âm" in ten:
        return 236.0
    return 150.0 - thuTu * 6.0                   # cac cong trinh rieng le


def khungBanVe(page, kq):
    """Khung mat bang: bo o CHU DAN va khung ten ben trai."""
    tu = page.get_text("words")
    oChu = [w for w in tu if w[4] == "DẪN:"]
    xMin = (max(w[2] for w in oChu) + 60) if oChu else 160.0
    x0, y0, x1, y1 = 1e9, 1e9, -1e9, -1e9
    for g in page.get_drawings():
        r = g["rect"]
        if r.x1 < xMin or r.width > 400 or r.height > 600:
            continue
        x0 = min(x0, r.x0); y0 = min(y0, r.y0)
        x1 = max(x1, r.x1); y1 = max(y1, r.y1)
    for ds in kq.values():
        for q in ds:
            x0 = min(x0, q["x"] - 8); y0 = min(y0, q["y"] - 8)
            x1 = max(x1, q["x"] + 8); y1 = max(y1, q["y"] + 8)
    if x0 > x1:
        return pymupdf.Rect(xMin, 0, 560, 840)
    m = 10
    return pymupdf.Rect(max(xMin - m, x0 - m), max(0, y0 - m),
                        min(page.mediabox.x1, x1 + m), min(page.mediabox.y1, y1 + m))


def main():
    os.makedirs(IMG, exist_ok=True)
    doc = pymupdf.open(PDF)

    tho = []
    for i, p in enumerate(doc):
        tho.append({"trang": i, "ten": tenTrang(p, i), "kyHieu": DO.doTrang(p)})
    dung = gomTrungLap(tho)
    print("42 trang -> %d khu vuc" % len(dung))

    floors, items, exits = [], [], []
    custom = {}
    stt = 0
    for k, idx in enumerate(dung):
        a = tho[idx]
        page = doc[idx]
        kq = a["kyHieu"]
        khung = khungBanVe(page, kq)

        # Trang PDF xoay 270 do, nhung toa do net ve (va toa do thiet bi o duoi)
        # nam trong he CHUA XOAY. Ve anh cung o he do thi anh va cham thiet bi
        # moi trung nhau; neu de nguyen goc xoay thi anh lech 90 do.
        anh = "ialy%02d.png" % k
        page.set_rotation(0)
        page.get_pixmap(clip=khung, dpi=DPI).save(os.path.join(IMG, anh))

        # toa do don vi ban ve: goc o TAM khung, truc y lat cho khop mat bang
        cx = (khung.x0 + khung.x1) / 2
        cy = (khung.y0 + khung.y1) / 2
        uv = lambda q: (round(q["x"] - cx, 2), round(q["y"] - cy, 2))
        nua_w = (khung.x1 - khung.x0) / 2
        nua_h = (khung.y1 - khung.y0) / 2

        ten = a["ten"]
        ma = re.sub(r"[^A-Z0-9]", "", ten.upper())[:6] or ("KV%02d" % k)
        floors.append({
            "page": k, "name": ten, "elevation": caoTrinh(ten, k),
            "note": "", "image": anh, "georef": "unit-axis", "scale": 1.0,
            "box": [round(-nua_w, 1), round(-nua_h, 1), round(nua_w, 1), round(nua_h, 1)],
            "footprint": [round(-nua_w, 1), round(-nua_h, 1), round(nua_w, 1), round(nua_h, 1)],
            "walls": [], "doors": [], "cabinets": [],
        })

        ten_kv = TEN_VE.get(str(k), {})
        for loai in ("binhBot", "binhKhi", "nutBao"):
            for n, q in enumerate(kq[loai]):
                stt += 1
                x, y = uv(q)
                it = {"id": "IA-%s-%03d" % (ma, stt), "floor": k,
                      "type": LOAI[loai][0], "bx": x, "by": y, "room": None}
                tv = ten_kv.get(loai, {}).get(str(n))
                if tv:
                    it["ma"] = tv          # ten in tren ban ve -> len the kiem tra
                items.append(it)
        # hong lay nuoc -> doi tuong 'hong' nhu ben Ialy mo rong
        ds = []
        for n, q in enumerate(kq["hongNuoc"]):
            x, y = uv(q)
            o = {"type": "hong", "id": "hg%02d%02d" % (k, n + 1),
                 "u0": x, "v0": y, "u1": x, "v1": y,
                 "h": 0, "base": 0,
                 "name": "Họng nước vách tường %d" % (n + 1)}
            tv = ten_kv.get("hongNuoc", {}).get(str(n))
            if tv:
                o["ma"] = tv
            ds.append(o)
        if ds:
            custom[str(k)] = ds
        for n, q in enumerate(kq["denExit"]):
            x, y = uv(q)
            exits.append({"id": "IAEX-%02d-%02d" % (k, n + 1), "floor": k,
                          "bx": x, "by": y, "dir": "ngang"})

    types = {}
    for loai, (ma, nhan, mau) in LOAI.items():
        types[ma] = {"label": nhan, "color": mau}

    plant = {
        "project": "Nhà máy thuỷ điện Ialy — sơ đồ thoát nạn & phương tiện PCCC&CNCH",
        "source": PDF,
        "drawing": "Công ty Thuỷ điện Ialy — Tập đoàn Điện lực Việt Nam",
        "base_unit_spacing_pt": PT_TREN_DON_VI,
        "default_unit_spacing_m": MET_MOI_DON_VI,
        "types": types, "floors": floors, "items": items, "warnings": [],
    }
    os.makedirs(OUT, exist_ok=True)
    json.dump(plant, open(os.path.join(OUT, "plant.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump({"items": exits}, open(os.path.join(OUT, "exit.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump({"walls": {}}, open(os.path.join(OUT, "lines.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    # Ban ve khoi tao: nap khi nguoi dung chua ve gi cho nha may nay.
    json.dump({"custom": custom, "edits": {}},
              open(os.path.join(OUT, "custom.json"), "w", encoding="utf-8"),
              ensure_ascii=False)

    nTen = sum(1 for it in items if it.get("ma")) +            sum(1 for v in custom.values() for o in v if o.get("ma"))
    print("thiet bi mang ten in tren ban ve:", nTen)
    nHong = sum(len(v) for v in custom.values())
    print("khu vuc:", len(floors), " thiet bi:", len(items),
          " hong nuoc:", nHong, " den EXIT:", len(exits))
    for f in floors:
        n = sum(1 for it in items if it["floor"] == f["page"])
        print("  %-22s EL %6.1f  %3d thiet bi  %s" % (f["name"], f["elevation"], n, f["image"]))


if __name__ == "__main__":
    main()
