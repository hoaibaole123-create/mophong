# -*- coding: utf-8 -*-
"""
Doc 5 phieu kiem tra PCCC hang thang cua Ialy mo rong -> ket qua tung binh.

Moi dong la mot binh: lay MA BINH o cot "Ten phuong tien", NGAY o cot ngay
kiem tra, phan ghi chep o cot "Danh gia tinh trang hoat dong" va TEN NGUOI o
cot "Nguoi duoc phan cong quan ly". Ghi chep khong co dau hieu hong -> Dat.

Hang cua bang lay theo DUONG KE NGANG va cot lay theo DUONG KE DOC — gom chu
theo toa do thi o nao xuong dong bi cat lam doi, doc thieu chu "khong" la
tuong binh hong.

Chay:  python tools/doc_phieu.py <thu_muc_phieu> <tep_ket_qua.json>
"""
import json, os, re, sys
import pymupdf

MA = re.compile(r'(BỘT|CO2|FM200)\s*-?\s*▼\s*([\d,\.]+)\s*-\s*(\d+)\s*([A-Z]*)\s*-\s*(PX\d)')
NGAY = re.compile(r'(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})')
HONG = re.compile(r'vỡ|nứt|hư|hỏng|thiếu|hết hạn|không đạt|thay thế|bổ sung|'
                  r'kim chỉ thị (?:áp lực )?(?:đỏ|vàng)|mất|rò rỉ|rỉ sét', re.I)
BINH_THUONG = re.compile(r'không (?:bị )?(?:vỡ|nứt|rỉ sét|rò rỉ|hư|hỏng|thiếu|mất)', re.I)

EL = {'288,3': 288.65, '288,30': 288.65, '292': 292.70, '292,7': 292.70,
      '298': 298.30, '298,30': 298.30, '303': 303.90, '303,90': 303.90,
      '309': 309.50, '309,3': 309.50, '316': 316.60, '316,60': 316.60,
      '323': 323.70, '323,70': 323.70, '331': 331.40, '331,40': 331.40,
      '339': 339.10, '339,10': 339.10, '348': 348.00, '348,00': 348.00}


def _ke(page, doc):
    """Duong ke doc (doc=True) hoac ngang cua bang."""
    v = set()
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if doc and abs(a.x - b.x) < .6 and abs(a.y - b.y) > 20:
                    v.add(round((a.x + b.x) / 2, 1))
                if not doc and abs(a.y - b.y) < .6 and abs(a.x - b.x) > 40:
                    v.add(round((a.y + b.y) / 2, 1))
            elif it[0] == "re":
                r = it[1]
                if doc and r.width < 1.2 and r.height > 20:
                    v.add(round((r.x0 + r.x1) / 2, 1))
                if not doc and r.height < 1.2 and r.width > 40:
                    v.add(round((r.y0 + r.y1) / 2, 1))
    v = sorted(v)
    gon = []
    for x in v:
        if not gon or x - gon[-1] > 2.0:
            gon.append(x)
    return gon


def _cot(page, nhan):
    t = page.search_for(nhan)
    if not t:
        return None
    giua = (t[0].x0 + t[0].x1) / 2
    ke = _ke(page, True)
    trai = [x for x in ke if x < giua]
    phai = [x for x in ke if x > giua]
    if not trai or not phai:
        return (t[0].x0 - 6, t[0].x1 + 6)
    return (max(trai) + 1, min(phai) - 1)


def docPhieu(duong):
    d = pymupdf.open(duong)
    ra = []
    cDG = cQL = None
    for page in d:
        cDG = _cot(page, "Đánh giá tình trạng hoạt động") or cDG
        cQL = _cot(page, "Người được phân") or cQL
        if not cDG:
            continue
        moc = _ke(page, False)
        dai = _daiQuanLy(page, cQL) if cQL else []
        tu = page.get_text("words")
        for i in range(len(moc) - 1):
            y0, y1 = moc[i], moc[i + 1]
            if y1 - y0 < 4:
                continue
            trong = [w for w in tu if y0 < (w[1] + w[3]) / 2 < y1]
            ten = " ".join(w[4] for w in trong if w[2] <= cDG[0])
            m = MA.search(ten.replace(" ", ""))
            if not m:
                continue
            lo, el, so, he, px = m.groups()
            ghi = " ".join(w[4] for w in sorted(
                [w for w in trong if cDG[0] <= w[0] and w[2] <= cDG[1]],
                key=lambda w: (round(w[1]), w[0])))
            ng = NGAY.search(ten)
            hong = bool(HONG.search(BINH_THUONG.sub("", ghi)))
            ra.append(dict(loai=lo, el=EL.get(el.strip()), so=int(so), he=he or "IMR",
                           ma=m.group(0), ngay=("%02d/%02d/%s" % (int(ng.group(1)),
                                                int(ng.group(2)), ng.group(3))) if ng else "",
                           kq="Không đạt" if hong else "Đạt", ghi=ghi,
                           nguoi=_nguoi(page, tu, cQL, y0, y1, dai)))
    return ra


def _daiQuanLy(page, cQL):
    """Cac DAI cua cot quan ly.

    O nay gop nhieu hang lam mot nen khong the tim ten theo tung hang: duong ke
    ngang cua cac hang KHONG cat qua o gop. Lay dung nhung duong ke co di qua
    cot nay lam bien, roi ten nam trong dai nao thi thuoc ve moi hang trong dai
    do. Truoc day toi lay chu gan nhat theo toa do y nen dinh ca so "7" cua
    dong danh so cot, va ten xuong hai dong thi bi cat mat mot nua.
    """
    bien = set()
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.y - b.y) < .6 and min(a.x, b.x) <= cQL[0] + 2 and max(a.x, b.x) >= cQL[1] - 2:
                    bien.add(round((a.y + b.y) / 2, 1))
            elif it[0] == "re":
                r = it[1]
                if r.height < 1.2 and r.x0 <= cQL[0] + 2 and r.x1 >= cQL[1] - 2:
                    bien.add(round((r.y0 + r.y1) / 2, 1))
    bien = sorted(bien)
    gon = []
    for y in bien:
        if not gon or y - gon[-1] > 2.0:
            gon.append(y)
    return gon


def _nguoi(page, tu, cQL, y0, y1, dai):
    if not cQL or len(dai) < 2:
        return ""
    for i in range(len(dai) - 1):
        if dai[i] - 1 <= y0 and y1 <= dai[i + 1] + 1:
            trong = [w for w in tu if cQL[0] <= w[0] and w[2] <= cQL[1]
                     and dai[i] < (w[1] + w[3]) / 2 < dai[i + 1]]
            ten = " ".join(w[4] for w in sorted(trong, key=lambda w: (round(w[1]), w[0])))
            ten = ten.strip()
            # bo dong danh so cot ("7") va dong tieu de
            if re.fullmatch(r'\d+', ten) or "Ký" in ten:
                return ""
            return ten
    return ""


def main():
    vao, ra = sys.argv[1], sys.argv[2]
    tat = []
    for t in sorted(os.listdir(vao)):
        if not t.lower().endswith(".pdf"):
            continue
        ds = docPhieu(os.path.join(vao, t))
        for x in ds:
            x["phieu"] = t
        tat += ds
        n = sum(1 for x in ds if x["kq"] == "Đạt")
        print("%-52s %3d binh  Dat=%d  Khong dat=%d" % (t[:52], len(ds), n, len(ds) - n))
    # O quan ly la o GOP cho ca mot khu; sang trang moi o do khong ve lai ten.
    # Lay ten dau tien doc duoc cua moi khu dien cho het khu do — dong thoi
    # loai luon ten o o CHU KY cuoi tep, vi o do rot vao dung cot quan ly.
    dau = {}
    for x in tat:
        k = (x["phieu"], x["el"])
        if x["nguoi"] and k not in dau:
            dau[k] = x["nguoi"]
    for x in tat:
        x["nguoi"] = dau.get((x["phieu"], x["el"]), "")

    json.dump(tat, open(ra, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("-> %s  (%d dong)" % (ra, len(tat)))


if __name__ == "__main__":
    main()
