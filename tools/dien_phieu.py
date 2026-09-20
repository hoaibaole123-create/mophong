# -*- coding: utf-8 -*-
"""
Dien cot "Danh gia tinh trang hoat dong" tren phieu kiem tra PCCC hang thang
cua Ialy mo rong: dong nao la MOT BINH va phan ghi chep cho thay binh thuong
thi them chu "Dat" vao cuoi o.

Dong nao co dau hieu HONG (vo, ri set, kim chi thi do/vang, thieu, het han...)
thi KHONG ghi Dat — de nguyen cho nguoi kiem tra tu ket luan.

Chay:  python tools/dien_phieu.py <thu_muc_phieu> <thu_muc_ra>
"""
import os, re, sys
import pymupdf

FONT = r"C:\Windows\Fonts\times.ttf"
MA = re.compile(r'(BỘT|CO2|FM200)\s*-?\s*▼')          # o ten phuong tien cua mot binh
# Tu ngu cho thay KHONG dat -> khong tu ghi Dat
HONG = re.compile(r'vỡ|nứt|rỉ sét(?! )|hư|hỏng|thiếu|hết hạn|không đạt|thay thế|bổ sung|'
                  r'kim chỉ thị (?:áp lực )?(?:đỏ|vàng)|mất|rò', re.I)
# Nhung cum nay la mo ta BINH THUONG, khong phai loi
BINH_THUONG = re.compile(r'không (?:bị )?(?:vỡ|nứt|rỉ sét|rò|hư|hỏng|thiếu)', re.I)


def _keDoc(page):
    """Cac duong ke DOC cua bang."""
    xs = set()
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.x - b.x) < 0.6 and abs(a.y - b.y) > 20:
                    xs.add(round((a.x + b.x) / 2, 1))
            elif it[0] == "re":
                r = it[1]
                if r.width < 1.2 and r.height > 20:
                    xs.add(round((r.x0 + r.x1) / 2, 1))
    xs = sorted(xs)
    gon = []
    for x in xs:
        if not gon or x - gon[-1] > 2.0:
            gon.append(x)
    return gon


def cotDanhGia(page):
    """Khung x cua cot 'Danh gia tinh trang hoat dong'.

    Phai lay theo DUONG KE DOC cua bang, khong lay theo be rong dong tieu de:
    tieu de duoc can giua nen hep hon o that, chu o dong thu hai cua o (vi du
    "khong ri set") nam ngoai khung do, doc thieu la tuong binh hong.
    """
    t = page.search_for("Đánh giá tình trạng hoạt động")
    if not t:
        return None
    giua = (t[0].x0 + t[0].x1) / 2
    ke = _keDoc(page)
    trai = [x for x in ke if x < giua]
    phai = [x for x in ke if x > giua]
    if not trai or not phai:
        return (t[0].x0 - 6, t[0].x1 + 6)
    return (max(trai) + 1, min(phai) - 1)


def duongKeNgang(page):
    """Cac duong ke NGANG cua bang -> bien gioi giua cac hang.

    Truoc day toi gom chu theo toa do y roi coi moi cum la mot hang; o nao
    xuong dong (gan het o "Danh gia") bi cat lam doi, doc thieu chu "khong"
    nen tuong binh hong. Lay dung duong ke cua bang thi khong con cat nham.
    """
    ys = set()
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l":                      # doan thang
                a, b = it[1], it[2]
                if abs(a.y - b.y) < 0.6 and abs(a.x - b.x) > 40:
                    ys.add(round((a.y + b.y) / 2, 1))
            elif it[0] == "re":                   # hinh chu nhat mong = duong ke
                r = it[1]
                if r.height < 1.2 and r.width > 40:
                    ys.add(round((r.y0 + r.y1) / 2, 1))
    ys = sorted(ys)
    gon = []
    for y in ys:
        if not gon or y - gon[-1] > 2.0:
            gon.append(y)
    return gon


def dienTrang(page, font, thongKe):
    cot = getattr(page, "_cotDG", None) or cotDanhGia(page)
    if cot is None:
        return
    moc = duongKeNgang(page)
    if len(moc) < 2:
        return
    tu = page.get_text("words")
    for i in range(len(moc) - 1):
        y0, y1 = moc[i], moc[i + 1]
        if y1 - y0 < 4:
            continue
        trong = [w for w in tu if (w[1] + w[3]) / 2 > y0 and (w[1] + w[3]) / 2 < y1]
        ten = " ".join(w[4] for w in trong if w[2] <= cot[0])
        if not MA.search(ten.replace(" ", "")):
            continue
        thongKe["binh"] += 1
        o = [w for w in trong if w[0] >= cot[0] and w[2] <= cot[1]]
        if not o:
            thongKe["trong"] += 1
            continue
        chu = " ".join(w[4] for w in sorted(o, key=lambda w: (round(w[1]), w[0])))
        if re.search(r'Đạt\s*$', chu):
            thongKe["daCo"] += 1
            continue
        if HONG.search(BINH_THUONG.sub("", chu)):
            thongKe["boQua"].append(chu[:90])
            continue
        cuoi = max(o, key=lambda w: (round(w[3]), w[2]))
        co = cuoi[3] - cuoi[1]
        x, y = cuoi[2], cuoi[3]
        if x + co * 2.2 > cot[1]:                 # het cho -> xuong dong moi
            x, y = cot[0] + 2, y + co * 0.95
        if y > y1 - 0.5:                          # khong tran ra ngoai hang
            x, y = cuoi[2], cuoi[3]
        page.insert_text((x + 1, y - co * 0.2), "/Đạt", fontname="TNR",
                         fontfile=font, fontsize=co * 0.78, color=(0, 0, 0))
        thongKe["them"] += 1


def dienPhieu(vao, ra):
    d = pymupdf.open(vao)
    tk = {"binh": 0, "them": 0, "daCo": 0, "trong": 0, "boQua": []}
    cot = None
    for p in d:
        c = cotDanhGia(p)
        if c:
            cot = c
        if cot:
            p._cotDG = cot
        dienTrang(p, FONT, tk)
    d.save(ra, garbage=3, deflate=True)
    return tk


def main():
    vao, ra = sys.argv[1], sys.argv[2]
    os.makedirs(ra, exist_ok=True)
    for t in sorted(os.listdir(vao)):
        if not t.lower().endswith(".pdf"):
            continue
        tk = dienPhieu(os.path.join(vao, t), os.path.join(ra, t))
        print("%-52s binh=%-4d ghi Dat=%-4d da co=%-4d o trong=%-3d bo qua=%d"
              % (t[:52], tk["binh"], tk["them"], tk["daCo"], tk["trong"], len(tk["boQua"])))
        for x in tk["boQua"]:
            print("      ! khong ghi Dat: ", x)


if __name__ == "__main__":
    main()
