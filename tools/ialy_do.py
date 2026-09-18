# -*- coding: utf-8 -*-
"""
Do ky hieu PCCC tren "SD chi dan thoat nan ... NMTD Ialy.pdf".
Khong phu thuoc co chu: moi trang mot ti le nen chi dua vao HINH DANG va MAU.

  * Binh chua chay = tam giac VIEN DEN (duong ke 3 doan, gan deu canh), ben trong
    co mot hinh TO DO. Ruot vuong -> binh bot; ruot tam giac -> binh khi.
    Phan biet bang ti le dien tich ruot / dien tich tam giac, lay chuan tu chinh
    o CHU DAN cua trang do (chu dan luon co du ca hai loai).
  * Nut an bao chay = tam giac DAC do sam, khong co vien den.
  * Hong nuoc       = cum net do thuan hinh chuong, >= 8 net.
  * Den thoat nan   = chu "EXIT".
"""
import pymupdf

DO_SAM = (0.8, 0.13, 0.15)
DO_THUAN = (1.0, 0.0, 0.0)
DEN = (0.0, 0.0, 0.0)


def _mau(c):
    return tuple(round(v, 2) for v in c) if c else None


def _trung(rects, eps=0.4):
    """Bo cac hinh trung nhau (ban ve ve chong hai ba lan)."""
    ra = []
    for r in rects:
        if not any(abs(r.x0 - q.x0) < eps and abs(r.y0 - q.y0) < eps and
                   abs(r.x1 - q.x1) < eps and abs(r.y1 - q.y1) < eps for q in ra):
            ra.append(r)
    return ra


def _gomHop(rects, gap):
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
            if (a.x0 - gap <= b.x1 and b.x0 - gap <= a.x1 and
                    a.y0 - gap <= b.y1 and b.y0 - gap <= a.y1):
                x, y = tim(i), tim(j)
                if x != y:
                    cha[x] = y
    cum = {}
    for i in range(n):
        cum.setdefault(tim(i), []).append(rects[i])
    ra = []
    for ds in cum.values():
        r = pymupdf.Rect(min(q.x0 for q in ds), min(q.y0 for q in ds),
                         max(q.x1 for q in ds), max(q.y1 for q in ds))
        ra.append({"r": r, "n": len(ds), "cx": (r.x0 + r.x1) / 2, "cy": (r.y0 + r.y1) / 2})
    return ra


def doTrang(page):
    ve = page.get_drawings()

    # --- tam giac vien den bao ngoai ky hieu binh
    tamGiac = _trung([g["rect"] for g in ve
                      if _mau(g.get("color")) == DEN and g.get("fill") is None
                      and len(g["items"]) == 3
                      and 4 < g["rect"].width < 60 and 4 < g["rect"].height < 60
                      and 0.6 < g["rect"].width / g["rect"].height < 1.5])
    # tam giac long nhau -> giu cai NGOAI CUNG
    tamGiac.sort(key=lambda r: -r.get_area())
    goi = []
    for r in tamGiac:
        if not any(q.x0 - .6 <= r.x0 and r.x1 <= q.x1 + .6 and
                   q.y0 - .6 <= r.y0 and r.y1 <= q.y1 + .6 for q in goi):
            goi.append(r)
    tamGiac = goi

    # --- ruot cua ky hieu binh:
    #   binh KHI = tam giac TO DAC mau do thuan (fill=(1,0,0), 3 doan);
    #   binh BOT = o vuong GACH CHEO ve bang net do sam (color=(0.8,0.13,0.15)).
    # Hai cach ve khac han nhau nen phan loai chac chan, khong can do ti le.
    ruotKhi = [g["rect"] for g in ve
               if _mau(g.get("fill")) == DO_THUAN and len(g["items"]) == 3
               and g["rect"].width < 60 and g["rect"].height < 60]
    ruotBot = [g["rect"] for g in ve
               if _mau(g.get("color")) == DO_SAM
               and g["rect"].width < 60 and g["rect"].height < 60]

    def _trongTg(t, ds):
        return any(t.x0 - .4 <= r.x0 and r.x1 <= t.x1 + .4 and
                   t.y0 - .4 <= r.y0 and r.y1 <= t.y1 + .4 for r in ds)

    binhBot, binhKhi = [], []
    for t in tamGiac:
        tam = {"x": (t.x0 + t.x1) / 2, "y": (t.y0 + t.y1) / 2,
               "w": t.width, "h": t.height}
        if _trongTg(t, ruotKhi):
            binhKhi.append(tam)
        elif _trongTg(t, ruotBot):
            binhBot.append(tam)

    tu = page.get_text("words")

    # --- nut an bao chay: tam giac dac do sam, khong nam trong tam giac vien den
    dacDo = _gomHop([g["rect"] for g in ve
                     if (_mau(g.get("color")) == DO_SAM or _mau(g.get("fill")) == DO_SAM)
                     and g["rect"].width < 60 and g["rect"].height < 60], 1.0)
    nutBao = []
    for c in dacDo:
        if c["n"] < 20:
            continue
        r = c["r"]
        if any(t.x0 - 1 <= r.x0 and r.x1 <= t.x1 + 1 and
               t.y0 - 1 <= r.y0 and r.y1 <= t.y1 + 1 for t in tamGiac):
            continue
        nutBao.append({"x": c["cx"], "y": c["cy"], "w": r.width, "h": r.height})

    # --- hong nuoc: cum net do thuan, khong nam trong tam giac
    hong = []
    for c in _gomHop([g["rect"] for g in ve
                      if (_mau(g.get("color")) == DO_THUAN or _mau(g.get("fill")) == DO_THUAN)
                      and g["rect"].width < 60 and g["rect"].height < 60], 1.0):
        if c["n"] < 8:
            continue
        r = c["r"]
        if any(t.x0 - 1 <= r.x0 and r.x1 <= t.x1 + 1 and
               t.y0 - 1 <= r.y0 and r.y1 <= t.y1 + 1 for t in tamGiac):
            continue
        hong.append({"x": c["cx"], "y": c["cy"], "w": r.width, "h": r.height})

    exit_ = [{"x": (w[0] + w[2]) / 2, "y": (w[1] + w[3]) / 2}
             for w in tu if w[4] == "EXIT"]

    # --- bo ky hieu nam trong O CHU DAN / khung ten (dai ben trai trang)
    xChuDan = 160.0
    oChu = [w for w in tu if w[4] == "DẪN:"]   # "CHÚ DẪN:" — dung nham voi ten ban ve
    if oChu:
        xChuDan = max(w[2] for w in oChu) + 60
    loc = lambda ds: [q for q in ds if q["x"] > xChuDan]
    return {"binhBot": loc(binhBot), "binhKhi": loc(binhKhi), "nutBao": loc(nutBao),
            "hongNuoc": loc(hong), "denExit": loc(exit_)}
