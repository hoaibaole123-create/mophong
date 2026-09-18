# -*- coding: utf-8 -*-
"""
Tach tuong (tuong bao, vach ngan phong, vach hanh lang) tu ban ve vector:
mot vach tuong = mot CAP duong thang song song gan nhau, chong lan nhau.
Dung boi tools/extract.py.
"""
import pymupdf

MIN_LEN = 18.0      # do dai toi thieu cua doan (don vi goc)
MIN_GAP, MAX_GAP = 2.4, 62.0   # be day vach: 0,13 m … 3,3 m
MIN_OVER = 0.6      # ti le chong lan
MIN_WALL_LEN = 30.0 # chieu dai toi thieu cua vach tuong


def segments(page):
    segs = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.y - b.y) < 0.6 and abs(a.x - b.x) >= MIN_LEN:
                    segs.append(("h", round((a.y + b.y) / 2, 1), min(a.x, b.x), max(a.x, b.x)))
                elif abs(a.x - b.x) < 0.6 and abs(a.y - b.y) >= MIN_LEN:
                    segs.append(("v", round((a.x + b.x) / 2, 1), min(a.y, b.y), max(a.y, b.y)))
            elif it[0] == "re":
                r = it[1]
                if r.width >= MIN_LEN and r.height < 0.6:
                    segs.append(("h", round((r.y0 + r.y1) / 2, 1), r.x0, r.x1))
                elif r.height >= MIN_LEN and r.width < 0.6:
                    segs.append(("v", round((r.x0 + r.x1) / 2, 1), r.y0, r.y1))
    return list(set(segs))


def pair_walls(segs):
    """Moi doan chi ghep voi doan song song GAN NHAT thoa dieu kien -> mot vach tuong."""
    out = {}
    for o in ("h", "v"):
        s = sorted([x for x in segs if x[0] == o], key=lambda t: t[1])
        for i, a in enumerate(s):
            best = None
            for j in range(len(s)):
                if j == i:
                    continue
                b = s[j]
                gap = abs(b[1] - a[1])
                if gap < MIN_GAP or gap > MAX_GAP:
                    continue
                lo, hi = max(a[2], b[2]), min(a[3], b[3])
                ov = hi - lo
                if ov <= 0 or ov < MIN_OVER * min(a[3] - a[2], b[3] - b[2]):
                    continue
                if best is None or gap < best[0]:
                    best = (gap, b, lo, hi)
            if best:
                gap, b, lo, hi = best
                if hi - lo < MIN_WALL_LEN or hi - lo < 2.2 * gap:
                    continue
                k = (o, round(min(a[1], b[1]), 1), round(max(a[1], b[1]), 1),
                     round(lo, 1), round(hi, 1))
                out[k] = True
    return list(out)


def wall_rects(page, mid, k, footprint, min_len=30.0, margin=25.0, ink=None,
               hatch=0.025, max_thick=34.0, thin_aspect=6.0):
    """
    Phan loai cac dai hai net song song thanh TUONG hay TU/THIET BI.

    Tuong  : co gach cheo ben trong (ink >= hatch)  -> khoi xay / be tong
             hoac rat thon dai (aspect >= thin_aspect) va khong qua day -> vach ngan
    Tu, thiet bi : hinh chu nhat rong ruot, mup map (khong gach, aspect nho)

    Tra ve (walls, cabinets), moi phan tu la [x0, y0, x1, y1] theo don vi ban ve goc.
    """
    walls, cabs, thin = [], [], []
    fx0, fy0, fx1, fy1 = footprint
    for o, c1, c2, lo, hi in pair_walls(segments(page)):
        if o == "h":
            x0, y0, x1, y1 = lo, c1, hi, c2
        else:
            x0, y0, x1, y1 = c1, lo, c2, hi
        u0, v0 = (x0 - mid[0]) / k, (y0 - mid[1]) / k
        u1, v1 = (x1 - mid[0]) / k, (y1 - mid[1]) / k
        if max(u0, u1) < fx0 - margin or min(u0, u1) > fx1 + margin:
            continue
        if max(v0, v1) < fy0 - margin or min(v0, v1) > fy1 + margin:
            continue
        w, h = abs(u1 - u0), abs(v1 - v0)
        if max(w, h) < min_len:
            continue
        rect = [round(min(u0, u1), 2), round(min(v0, v1), 2),
                round(max(u0, u1), 2), round(max(v0, v1), 2)]
        L, T = max(w, h), max(min(w, h), 0.1)
        aspect = L / T
        fill = ink(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)) if ink else None
        hatched = fill is not None and fill >= hatch
        if hatched:
            walls.append(rect)            # co gach cheo -> chac chan la tuong
        elif aspect >= thin_aspect and T <= max_thick:
            thin.append(rect)             # thon dai -> cho kiem tra lien ket
        else:
            cabs.append(rect)

    # vach mong khong gach cheo chi la TUONG neu hai dau (hoac mot dau) gac vao
    # mot buc tuong khac - ke, tu, gia do thi dung doc lap giua phong
    def touches(r, others, tol=7.0):
        for w in others:
            if (r[0] - tol <= w[2] and w[0] - tol <= r[2] and
                    r[1] - tol <= w[3] and w[1] - tol <= r[3]):
                return True
        return False

    for r in thin:
        if touches(r, walls):
            walls.append(r)
        else:
            cabs.append(r)

    # phan sat va song song voi mot vach tuong -> cung la tuong (lop thu hai)
    promoted, rest = [], []
    for c in cabs:
        cw, ch = c[2] - c[0], c[3] - c[1]
        horiz = cw >= ch
        hit = False
        for w in walls:
            ww, wh = w[2] - w[0], w[3] - w[1]
            if (ww >= wh) != horiz:
                continue
            if horiz:
                ov = min(c[2], w[2]) - max(c[0], w[0])
                gap = max(c[1] - w[3], w[1] - c[3])
                if ov > 0.5 * min(cw, ww) and -1 <= gap <= 5:
                    hit = True
            else:
                ov = min(c[3], w[3]) - max(c[1], w[1])
                gap = max(c[0] - w[2], w[0] - c[2])
                if ov > 0.5 * min(ch, wh) and -1 <= gap <= 5:
                    hit = True
            if hit:
                break
        (promoted if hit else rest).append(c)
    return walls + promoted, rest
