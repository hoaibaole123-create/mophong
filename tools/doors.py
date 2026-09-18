# -*- coding: utf-8 -*-
"""
Tach cua ra vao tu ban ve: mot canh cua duoc ve bang CUNG TRON 1/4.
Lay ca HINH HOC canh cua:
  - ban le  = giao diem hai tiep tuyen o hai dau cung
  - mot canh tay nam TREN TUONG  -> be rong o cua
  - canh tay con lai              -> huong canh cua khi mo

Moi cua tra ve [hx, hy, ax, ay, bx, by] theo don vi ban ve goc
(h = ban le, a/b = hai dau cung).
Chi giu cung nam sat mot vach tuong -> loai bo cung cua thiet bi.
"""


def door_arcs(page, mid, k, min_w=8.0, max_w=42.0):
    out = []
    for d in page.get_drawings():
        arcs = [it for it in d["items"] if it[0] == "c"]
        if len(arcs) != 1 or len(d["items"]) > 2:
            continue
        r = d["rect"]
        w, h = r.width / k, r.height / k
        if not (min_w < w < max_w and min_w < h < max_w):
            continue
        if abs(w - h) > 0.25 * max(w, h):
            continue
        p1, p2, p3, p4 = arcs[0][1:5]
        # tiep tuyen tai p1: neu gan nhu nam ngang -> tam nam o (p4.x, p1.y)
        if abs(p2.y - p1.y) <= abs(p2.x - p1.x):
            hx, hy = p4.x, p1.y
        else:
            hx, hy = p1.x, p4.y
        g = lambda x, y: ((x - mid[0]) / k, (y - mid[1]) / k)
        H, A, B = g(hx, hy), g(p1.x, p1.y), g(p4.x, p4.y)
        out.append([round(v, 1) for v in (H[0], H[1], A[0], A[1], B[0], B[1])])
    return out


def door_rects(page, mid, k, walls, min_w=8.0, max_w=42.0, near=20.0):
    """Loc cac cung nam sat tuong."""
    out = []
    for a in door_arcs(page, mid, k, min_w, max_w):
        xs = [a[0], a[2], a[4]]
        ys = [a[1], a[3], a[5]]
        cx, cy = sum(xs) / 3, sum(ys) / 3
        for w in walls:
            if (w[0] - near <= cx <= w[2] + near) and (w[1] - near <= cy <= w[3] + near):
                out.append(a)
                break
    return out
