# -*- coding: utf-8 -*-
"""
Gan TEN IN TREN BAN VE cho tung thiet bi Ialy.

tools/ialy_ten.json  : ten doc bang mat tu scratch_nhan/sheetNN.png
scratch_nhan/vitri.json : toa do tam cua tung dong nhan tren trang

Moi dong nhan liet ke vai ma ("HCC-GM05; CO2-61"). Tach ra tung ma, doan loai
theo tien to roi gan vao THIET BI GAN NHAT cung loai, moi thiet bi chi nhan mot
ma. Ket qua -> tools/ialy_ten_gan.json, extract_ialy.py doc file nay.

Chay:  python tools/ialy_gan_ten.py
"""
import json, os, re, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialy_do as DO
import extract_ialy as E

TEN = os.path.join("tools", "ialy_ten.json")
VITRI = os.path.join("scratch_nhan", "vitri.json")
RA = os.path.join("tools", "ialy_ten_gan.json")


def tachMa(dong):
    """'HCC-BA14; 15' -> ['HCC-BA14','HCC-BA15'];  'CO2-42; 43' -> CO2-42, CO2-43.
    Manh chi co so thi muon tien to cua ma dung truoc no."""
    ra, truoc = [], None
    for m in re.split(r"[;,]", dong):
        m = m.strip().upper().replace(" ", "")
        if not m:
            continue
        if re.fullmatch(r"\d+", m) and truoc:
            g = re.match(r"^(.*?)(\d+)$", truoc)
            if g:
                m = g.group(1) + m.zfill(len(g.group(2)))
        elif re.fullmatch(r"B-?\d+", m) and truoc and "FM200" in truoc:
            m = truoc[:truoc.rindex("B")] + m.replace("-", "")
        ra.append(m)
        truoc = m
    return ra


def loaiCuaMa(m):
    if m.startswith("HCC"):
        return "hongNuoc"
    if "FM200" in m:
        return "binhBot"
    if m.startswith("CO2"):
        return "binhKhi"
    if re.match(r"^B-?\d+$", m):
        return "binhBot"
    return None


def main():
    ten = json.load(open(TEN, encoding="utf-8"))
    vitri = json.load(open(VITRI, encoding="utf-8"))
    doc = pymupdf.open(E.PDF)

    tho = [{"trang": i, "ten": E.tenTrang(p, i), "kyHieu": DO.doTrang(p)}
           for i, p in enumerate(doc)]
    dung = E.gomTrungLap(tho)

    ra, tong = {}, 0
    for k, idx in enumerate(dung):
        nhan = ten.get(str(idx))
        if not nhan:
            continue
        vt = vitri.get(str(idx), {})
        kq = tho[idx]["kyHieu"]
        # (ma, x, y) cua tung ma rieng le
        ma_ds = []
        for dong, chu in nhan.items():
            p = vt.get(dong)
            if not p:
                continue
            for m in tachMa(chu):
                if loaiCuaMa(m):
                    ma_ds.append((m, p[0], p[1]))

        gan = {}
        for loai in ("hongNuoc", "binhKhi", "binhBot"):
            tb = kq[loai]
            ung = [q for q in ma_ds if loaiCuaMa(q[0]) == loai]
            # cap (khoang cach, ma, thiet bi) -> chon dan tu gan nhat
            cap = sorted((((q[1] - t["x"]) ** 2 + (q[2] - t["y"]) ** 2) ** .5, i, j)
                         for i, q in enumerate(ung) for j, t in enumerate(tb))
            xong_m, xong_t = set(), {}
            for d, i, j in cap:
                if i in xong_m or j in xong_t:
                    continue
                xong_m.add(i); xong_t[j] = ung[i][0]
            if xong_t:
                gan[loai] = {str(j): m for j, m in xong_t.items()}
                tong += len(xong_t)
        if gan:
            ra[str(k)] = gan
        print("khu %2d (trang %2d) %-24s gan %d ma"
              % (k, idx, tho[idx]["ten"], sum(len(v) for v in gan.values())))

    json.dump(ra, open(RA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("tong cong %d thiet bi co ten tren ban ve -> %s" % (tong, RA))


if __name__ == "__main__":
    main()
