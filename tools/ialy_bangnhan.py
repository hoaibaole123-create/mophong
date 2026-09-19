# -*- coding: utf-8 -*-
"""
Dung "bang doi chieu nhan" cho tung trang ban ve Ialy.

Ban ve khong luu chu duoi dang text — ten thiet bi (HCC-GM05; CO2-61 ...) da bi
be thanh net vector nen may khong doc duoc. Cach lam: gom net thanh tung DONG
NHAN (ialy_nhan.py), ve moi dong thanh mot dai anh ro net, xep thanh mot bang
co danh so. Doc bang mat roi ghi lai vao tools/ialy_ten.json theo dang:

    { "0": { "01": "HCC-GM07; CO2-62", "03": "HCC-GM06; CO2-63", ... }, ... }

Sau do ialy_gan_ten.py gan tung ma vao thiet bi gan nhat cung loai.

Chay:  python tools/ialy_bangnhan.py 0 1 2      (hoac khong tham so = tat ca)
"""
import json, os, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialy_nhan as NHAN

PDF = "SD chi dan thoat nan va bo tri phuong tien PCCC&CNCH NMTD Ialy.pdf"
OUT = "scratch_nhan"
CAO_DONG = 34          # chieu cao moi dong tren bang
RONG = 520


def bang(doc, i):
    p = doc[i]
    ds = NHAN.dongNhan(p)
    ds.sort(key=lambda q: (round(q["cy"] / 20), q["cx"]))
    out = pymupdf.open()
    pg = out.new_page(width=RONG, height=CAO_DONG * max(1, len(ds)) + 10)
    toado = {}
    for k, q in enumerate(ds):
        p.set_rotation(270 if q["doc"] else 0)
        r = pymupdf.Rect(q["r"].x0 - 2, q["r"].y0 - 3, q["r"].x1 + 2, q["r"].y1 + 3)
        if q["doc"]:
            r = r * p.rotation_matrix
        pix = p.get_pixmap(clip=r, dpi=420)
        w = min(360, pix.width / pix.height * 24)
        pg.insert_image(pymupdf.Rect(60, 5 + k * CAO_DONG, 60 + w, 29 + k * CAO_DONG),
                        pixmap=pix)
        pg.insert_text(pymupdf.Point(10, 23 + k * CAO_DONG), "%02d" % k, fontsize=13)
        toado["%02d" % k] = [round(q["cx"], 1), round(q["cy"], 1)]
    p.set_rotation(270)
    os.makedirs(OUT, exist_ok=True)
    out[0].get_pixmap(dpi=150).save(os.path.join(OUT, "sheet%02d.png" % i))
    return toado


def main():
    doc = pymupdf.open(PDF)
    trang = [int(x) for x in sys.argv[1:]] or list(range(doc.page_count))
    viTri = {}
    f = os.path.join(OUT, "vitri.json")
    if os.path.exists(f):
        viTri = json.load(open(f, encoding="utf-8"))
    for i in trang:
        viTri[str(i)] = bang(doc, i)
        print("trang %2d -> %2d nhan  (%s/sheet%02d.png)" % (i, len(viTri[str(i)]), OUT, i))
    os.makedirs(OUT, exist_ok=True)
    json.dump(viTri, open(f, "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main()
