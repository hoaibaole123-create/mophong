# -*- coding: utf-8 -*-
"""
Tach ky hieu PCCC tu "SD chi dan thoat nan ... NMTD Ialy.pdf".

Cach lam: moi ky hieu tren ban ve la mot CUM net ve nam sat nhau. Trong o CHU DAN
cua moi trang co san mot cum mau cho tung loai (binh bot, binh khi, hong nuoc,
den EXIT, nut an bao chay...). Lay cum mau do lam chuan roi doi chieu cac cum
con lai tren trang theo kich thuoc + mau sac.
"""
import math
import pymupdf

GAP = 2.0          # hai net cach nhau duoi nguong nay coi nhu cung mot ky hieu
MAX_KH = 26.0      # ky hieu lon nhat (pt)
MIN_KH = 3.0


def _mau(g):
    c = g.get("fill") or g.get("color")
    if not c:
        return None
    return tuple(round(v, 2) for v in c)


def netVe(page):
    """Danh sach net ve: (bbox, mau, so doan)."""
    ra = []
    for g in page.get_drawings():
        r = g["rect"]
        if r.width > 200 or r.height > 200:
            continue
        ra.append({"x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1,
                   "mau": _mau(g), "n": len(g["items"])})
    return ra


def _gan(a, b, gap=GAP):
    return (a["x0"] - gap <= b["x1"] and b["x0"] - gap <= a["x1"] and
            a["y0"] - gap <= b["y1"] and b["y0"] - gap <= a["y1"])


def gomCum(nets):
    """Gom net ve thanh cum bang union-find tren luoi khong gian."""
    n = len(nets)
    cha = list(range(n))

    def tim(i):
        while cha[i] != i:
            cha[i] = cha[cha[i]]
            i = cha[i]
        return i

    def hop(i, j):
        a, b = tim(i), tim(j)
        if a != b:
            cha[a] = b

    # chia o luoi 12 pt de khoi so sanh n^2
    O = 12.0
    hop_o = {}
    for i, a in enumerate(nets):
        for gx in range(int(a["x0"] // O), int(a["x1"] // O) + 1):
            for gy in range(int(a["y0"] // O), int(a["y1"] // O) + 1):
                hop_o.setdefault((gx, gy), []).append(i)
    for ds in hop_o.values():
        for k, i in enumerate(ds):
            for j in ds[k + 1:]:
                if _gan(nets[i], nets[j]):
                    hop(i, j)

    cum = {}
    for i in range(n):
        cum.setdefault(tim(i), []).append(i)

    ra = []
    for ds in cum.values():
        xs0 = min(nets[i]["x0"] for i in ds); xs1 = max(nets[i]["x1"] for i in ds)
        ys0 = min(nets[i]["y0"] for i in ds); ys1 = max(nets[i]["y1"] for i in ds)
        mau = {}
        for i in ds:
            m = nets[i]["mau"]
            if m:
                mau[m] = mau.get(m, 0) + 1
        ra.append({"x0": xs0, "y0": ys0, "x1": xs1, "y1": ys1,
                   "cx": (xs0 + xs1) / 2, "cy": (ys0 + ys1) / 2,
                   "r": max(xs1 - xs0, ys1 - ys0), "soNet": len(ds), "mau": mau})
    return ra


def vanTay(c):
    """Dau van tay cua mot cum: kich thuoc + ti le mau."""
    tong = sum(c["mau"].values()) or 1
    return {"w": c["x1"] - c["x0"], "h": c["y1"] - c["y0"],
            "mau": {k: v / tong for k, v in c["mau"].items()}}


def khacNhau(a, b):
    """Do lech giua hai van tay; cang nho cang giong."""
    dw = abs(a["w"] - b["w"]) / max(a["w"], b["w"], 1)
    dh = abs(a["h"] - b["h"]) / max(a["h"], b["h"], 1)
    khoa = set(a["mau"]) | set(b["mau"])
    dm = sum(abs(a["mau"].get(k, 0) - b["mau"].get(k, 0)) for k in khoa) / 2
    return dw + dh + 1.6 * dm


# --- o CHU DAN: chu xoay 90 do, moi dong chu la mot cot ---
NHAN = [
    ("binhBot",  ("Bình", "bột")),
    ("binhKhi",  ("Bình", "khí")),
    ("hongNuoc", ("Họng",)),
    ("huongThoat", ("Hướng",)),
    ("denExit",  ("Đèn",)),
    ("nutBao",   ("Nút",)),
    ("fm200",    ("FM200",)),
]


def chuDan(page, cums):
    """Tim cum mau cho tung loai ky hieu trong o chu dan."""
    tu = page.get_text("words")
    ra = {}
    for ma, khoa in NHAN:
        ung = [w for w in tu if w[4] == khoa[0]]
        for w in ung:
            x0, y0, x1, y1 = w[:4]
            # ky hieu nam ngay TRUOC cot chu (y nho hon), cung khoang x
            gan = [c for c in cums
                   if MIN_KH <= c["r"] <= MAX_KH
                   and c["x0"] < x1 + 6 and c["x1"] > x0 - 6
                   and 0 < y0 - c["cy"] < 26]
            if gan:
                gan.sort(key=lambda c: y0 - c["cy"])
                ra[ma] = gan[0]
                break
    return ra
