"""Đặt tên bình Ialy mở rộng THEO BẢNG KIỂM TRA HÀNG THÁNG (file Excel của đơn vị).

Bảng hàng tháng là chuẩn: bình trong phần mềm được đổi tên cho trùng bảng.
- Ghép theo nhóm (loại, cao trình, hệ): bình trong phần mềm xếp theo số cũ,
  tên trong bảng xếp theo số, rồi ghép lần lượt. Vị trí bình giữ nguyên.
- Phần mềm dư bình (bảng không có) -> XOÁ, để số bình đúng bằng bảng.
- Bảng có mà phần mềm thiếu -> thêm bình mới, đặt cạnh bình cuối của nhóm
  để người dùng kéo về đúng chỗ.

    python tools/ten_bang.py <bang.xlsx>     # đọc bảng, lưu tools/ten_bang.json, áp vào web/data/plant.json
    python tools/ten_bang.py                 # áp lại từ tools/ten_bang.json
"""
import json
import os
import re
import sys

GOC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS_JSON = os.path.join(GOC, "tools", "ten_bang.json")
PLANT = os.path.join(GOC, "web", "data", "plant.json")
LOAI_MA = {"BỘT": "ABC8", "CO2": "CO25", "FM200": "FM200"}
LOAI_TEN = {"ABC8": "BỘT", "CO25": "CO2", "CO224": "CO2", "FM200": "FM200"}


def tach(ten):
    """'BỘT-▼288,3-001IMR-PX1' -> ('BỘT', 288, 1, 'IMR')"""
    m = re.match(r"([^-]+)-▼([\d.,]+)-(\d+)([A-Z]+)", (ten or "").replace(" ", ""))
    if not m:
        return None
    return m.group(1), int(float(m.group(2).replace(",", "."))), int(m.group(3)), m.group(4)


def doc_bang(xlsx):
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    # lấy trang tháng đầu tiên có dữ liệu (các tháng cùng một danh sách bình)
    for ws in wb.worksheets:
        ds = []
        for row in ws.iter_rows(values_only=True):
            t = row[1] if len(row) > 1 else None
            if isinstance(t, str) and "▼" in t and tach(t):
                ds.append(t.strip())
        if ds:
            return ds
    return []


def ap_ten(floors, items, ds):
    cao = {f["page"]: f["elevation"] for f in floors}
    nhom_app, nhom_bang = {}, {}
    for it in items:
        k = (LOAI_TEN[it["type"]], int(cao[it["floor"]]), it.get("he", "IMR"))
        nhom_app.setdefault(k, []).append(it)
    for t in ds:
        lo, el, so, he = tach(t)
        nhom_bang.setdefault((lo, el, he), []).append((so, t))
    them, xoa = 0, set()
    for k, app in nhom_app.items():                 # nhóm bảng không có -> xoá cả nhóm
        if k not in nhom_bang:
            xoa.update(it["id"] for it in app)
    for k, bang in nhom_bang.items():
        bang.sort()
        app = sorted(nhom_app.get(k, []), key=lambda it: (it.get("so", 0), it["id"]))
        xoa.update(it["id"] for it in app[len(bang):])  # dư so với bảng -> xoá
        app = app[:len(bang)]
        for i, (so, t) in enumerate(bang):
            if i < len(app):
                app[i]["ma"] = t
                app[i]["so"] = so
                continue
            # bảng có, phần mềm thiếu -> thêm bình mới cạnh bình cuối của nhóm
            mau = app[-1] if app else None
            f = (next((f for f in floors if f["page"] == mau["floor"]), None) if mau else
                 min(floors, key=lambda f: abs(int(f["elevation"]) - k[1])))
            n = i - len(app) + 1
            items.append(dict(
                id="FE-B%d-%s%s-%d" % (k[1], k[0].replace("Ộ", "O"), k[2], so),
                floor=f["page"], type=LOAI_MA[k[0]],
                bx=round((mau["bx"] if mau else 0) + 1.2 * n, 2),
                by=round(mau["by"] if mau else 0, 2),
                room=None, so=so, he=k[2], ma=t, them=True))
            them += 1
    items[:] = [it for it in items if it["id"] not in xoa]
    return them, len(xoa)


def main():
    if len(sys.argv) > 1:
        ds = doc_bang(sys.argv[1])
        json.dump(ds, open(DS_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ds = json.load(open(DS_JSON, encoding="utf-8"))
    P = json.load(open(PLANT, encoding="utf-8"))
    # bình đã thêm từ lần trước thì bỏ đi trước khi áp lại (tránh thêm trùng)
    P["items"] = [it for it in P["items"] if not str(it["id"]).startswith("FE-B")]
    them, xoa = ap_ten(P["floors"], P["items"], ds)
    json.dump(P, open(PLANT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    trung = {it["ma"] for it in P["items"]} & set(ds)
    print("bang:", len(ds), "| phan mem:", len(P["items"]), "| trung ten:", len(trung),
          "| them moi:", them, "| xoa:", xoa)


if __name__ == "__main__":
    main()
