# -*- coding: utf-8 -*-
"""
Gom cac NET CHU da be thanh vector tren ban ve Ialy thanh tung DONG NHAN,
roi dung anh tung dong de doc bang mat.

Ban ve khong luu chu duoi dang text (get_text khong ra gi) — moi ky tu la mot
nhum duong to den. Nhung chung van xep thanh hang ngang/doc ro rang, nen gom
lai theo hang la ra dung tung nhan kieu "HCC-GM05; CO2-61".
"""
import pymupdf


def netChu(page):
    """Cac net nho mau den — ung vien ky tu."""
    ra = []
    for g in page.get_drawings():
        if g.get("fill") != (0.0, 0.0, 0.0):
            continue
        r = g["rect"]
        if not (0.3 < r.width < 6 and 1.2 < r.height < 7):
            continue
        ra.append(r)
    return ra


def _gom(rects, gapX, gapY):
    n = len(rects)
    cha = list(range(n))

    def tim(i):
        while cha[i] != i:
            cha[i] = cha[cha[i]]; i = cha[i]
        return i

    for i in range(n):
        a = rects[i]
        for j in range(i + 1, n):
            b = rects[j]
            if (a.x0 - gapX <= b.x1 and b.x0 - gapX <= a.x1 and
                    a.y0 - gapY <= b.y1 and b.y0 - gapY <= a.y1):
                x, y = tim(i), tim(j)
                if x != y:
                    cha[x] = y
    cum = {}
    for i in range(n):
        cum.setdefault(tim(i), []).append(rects[i])
    return list(cum.values())


def _hang(nhom, doc):
    r = pymupdf.Rect(min(q.x0 for q in nhom), min(q.y0 for q in nhom),
                     max(q.x1 for q in nhom), max(q.y1 for q in nhom))
    return {"r": r, "n": len(nhom), "doc": doc,
            "cx": (r.x0 + r.x1) / 2, "cy": (r.y0 + r.y1) / 2}


def _laChu(h):
    r = h["r"]
    ngan, dai = min(r.width, r.height), max(r.width, r.height)
    return 3.0 < ngan < 8.5 and dai >= 10 and h["n"] >= 6


def dongNhan(page):
    """O chu nhat bao quanh tung dong nhan. Ban ve co ca chu NGANG lan chu
    XOAY 90 do, nen phai gom hai lan voi khe ho theo hai huong khac nhau;
    khe ho doc theo dong phai rong (6 pt) vi sau dau ';' ban ve chua mot
    khoang trang, khong thi mot nhan bi cat lam doi."""
    ds = netChu(page)
    ra = []
    for nhom in _gom(ds, 6.0, 0.8):            # chu nam ngang
        h = _hang(nhom, False)
        if _laChu(h) and h["r"].width > h["r"].height:
            ra.append(h)
    for nhom in _gom(ds, 0.8, 6.0):            # chu xoay 90 do
        h = _hang(nhom, True)
        if _laChu(h) and h["r"].height > h["r"].width:
            ra.append(h)
    return ra
