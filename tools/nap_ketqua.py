# -*- coding: utf-8 -*-
"""
Nap ket qua kiem tra hang thang (doc tu phieu PDF) vao THE THEO DOI cua tung
binh ben Ialy mo rong.

  tools/doc_phieu.py  -> ketqua.json   (ma binh, ngay, Dat/Khong dat, nguoi)
  tools/nap_ketqua.py -> ghi vao o "Ket qua kiem tra" dung thang, dung binh

Ghep binh trong phieu voi binh trong phan mem theo (LOAI, CAO TRINH, SO THU
TU trong danh sach cua don vi). Cao trinh nao so binh hai ben khong bang nhau
thi ghep theo thu tu va bao lai phan con thua.

Chay:  python tools/nap_ketqua.py <ketqua.json> [--day]   (--day = day len dam may)
"""
import json, os, re, sys, urllib.request, collections

LO = {"ABC8": "BỘT", "CO25": "CO2", "CO224": "CO2", "FM200": "FM200"}
DOC = "ialy-mo-rong"


def cauHinh():
    t = open(os.path.join("web", "config.js"), encoding="utf-8").read()
    return (re.search(r'url\s*:\s*["\']([^"\']+)', t).group(1).rstrip("/"),
            re.search(r'key\s*:\s*["\']([^"\']+)', t).group(1))


def api(url, key, duong, data=None, method="GET", them=None):
    h = {"apikey": key, "Authorization": "Bearer " + key,
         "Content-Type": "application/json"}
    h.update(them or {})
    r = urllib.request.Request(url + "/rest/v1/" + duong,
                               data=json.dumps(data).encode() if data is not None else None,
                               headers=h, method=method)
    with urllib.request.urlopen(r) as f:
        t = f.read().decode()
    return json.loads(t) if t.strip() else None


def ghep(ds, plant):
    """Tra ve {id_binh: dong_ket_qua} + danh sach chua ghep duoc."""
    fl = {f["page"]: f for f in plant["floors"]}
    tb = collections.defaultdict(list)
    for it in plant["items"]:
        tb[(LO[it["type"]], round(fl[it["floor"]]["elevation"], 2), it.get("he", "IMR"))].append(it)
    for v in tb.values():
        v.sort(key=lambda it: it.get("so", 0))

    pv = collections.defaultdict(list)
    for x in ds:
        pv[(x["loai"], x["el"], x["he"])].append(x)
    for v in pv.values():
        v.sort(key=lambda x: x["so"])

    ra, thua = {}, []
    for k, ph in pv.items():
        may = tb.get(k, [])
        for i, x in enumerate(ph):
            if i < len(may):
                ra[may[i]["id"]] = x
            else:
                thua.append(x)
    return ra, thua


def main():
    ds = json.load(open(sys.argv[1], encoding="utf-8"))
    plant = json.load(open(os.path.join("web", "data", "plant.json"), encoding="utf-8"))
    ghepDuoc, thua = ghep(ds, plant)
    print("phieu %d binh -> ghep duoc %d, chua ghep %d" % (len(ds), len(ghepDuoc), len(thua)))
    for x in thua[:10]:
        print("   ! chua ghep:", x["ma"])

    fl = {f["page"]: f for f in plant["floors"]}
    it_by = {it["id"]: it for it in plant["items"]}

    url, key = cauHinh()
    hang = api(url, key, "ialy_thiet_ke?doc=eq.%s&select=du_lieu" % DOC)
    d = (hang[0]["du_lieu"] if hang else {}) or {}
    edits = d.get("edits") or {}

    dem = 0
    for bid, x in ghepDuoc.items():
        page = it_by[bid]["floor"]
        e = edits.setdefault(str(page), {})
        the = e.setdefault("the", {})
        o = the.setdefault("i:" + bid, {"seri": "", "ngaySD": "", "hang": []})
        h = o.setdefault("hang", [])
        while len(h) < 12:
            h.append({})
        thang = int(x["ngay"].split("/")[1]) if x["ngay"] else 0
        if not thang:
            continue
        h[thang - 1] = {"ngay": x["ngay"], "kq": x["kq"], "nguoi": x["nguoi"]}
        dem += 1
    d["edits"] = edits
    d.setdefault("custom", d.get("custom") or {})
    print("da dien %d o ket qua (thang %s)" % (dem, ", ".join(sorted({
        x["ngay"].split("/")[1] for x in ghepDuoc.values() if x["ngay"]}))))

    # Ghi ra TEP DU LIEU RIENG (web/data/ketqua.json). Luc dau toi ghi thang
    # vao ban ve tren dam may, nhung dong bo cua ung dung day CA GOI du lieu
    # len moi lan luu: mot tab dang mo con giu ban cu la de len, ket qua vua
    # nap bay het. Tep nay ung dung chi doc, khong bao gio ghi de.
    ngoai = {}
    for bid, x in ghepDuoc.items():
        if not x["ngay"]:
            continue
        ngoai.setdefault("i:" + bid, {})[str(int(x["ngay"].split("/")[1]))] = {
            "ngay": x["ngay"], "kq": x["kq"], "nguoi": x["nguoi"]}
    # Binh dat o thang nay thi cac thang TRUOC do trong nam cung dat (chu binh
    # hong thi da phai thay tu truoc). Chi ghi ket qua va nguoi quan ly, KHONG
    # dat ngay: khong co phieu cua nhung thang do nen khong biet ngay nao.
    if "--thang-truoc" in sys.argv:
        for k, v in ngoai.items():
            dat = sorted((int(t) for t, x in v.items() if x["kq"] == "Đạt"))
            if not dat:
                continue
            m = dat[0]
            for t in range(1, m):
                v.setdefault(str(t), {"ngay": "", "kq": "Đạt",
                                      "nguoi": v[str(m)]["nguoi"]})

    tep = os.path.join("web", "data", "ketqua.json")
    cu = {}
    if os.path.exists(tep):
        cu = json.load(open(tep, encoding="utf-8"))
    for k, v in ngoai.items():
        cu.setdefault(k, {}).update(v)
    json.dump(cu, open(tep, "w", encoding="utf-8"), ensure_ascii=False)
    print("da ghi %s  (%d binh)" % (tep, len(cu)))

    if "--day" in sys.argv:
        api(url, key, "ialy_thiet_ke?on_conflict=doc", [{"doc": DOC, "du_lieu": d}],
            "POST", {"Prefer": "resolution=merge-duplicates"})
        print("da day len dam may:", DOC)
    else:
        json.dump(d, open("ketqua_the.json", "w", encoding="utf-8"), ensure_ascii=False)
        print("chua day len dam may — xem truoc o ketqua_the.json (them --day de day)")


if __name__ == "__main__":
    main()
