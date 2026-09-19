# -*- coding: utf-8 -*-
"""Bo sung truong 'ma' (ten in tren ban ve) vao 80 hong nuoc da nam tren dam may."""
import json, re, urllib.request

cfg = open("web/config.js", encoding="utf-8").read()
url = re.search(r'url\s*:\s*["\']([^"\']+)', cfg).group(1).rstrip("/")
key = re.search(r'key\s*:\s*["\']([^"\']+)', cfg).group(1)
DOC = "ialy-nha-may"
H = {"apikey": key, "Authorization": "Bearer " + key,
     "Content-Type": "application/json"}


def goi(duong, data=None, method="GET", extra=None):
    h = dict(H); h.update(extra or {})
    r = urllib.request.Request(url + "/rest/v1/" + duong,
                               data=json.dumps(data).encode() if data is not None else None,
                               headers=h, method=method)
    with urllib.request.urlopen(r) as f:
        t = f.read().decode()
    return json.loads(t) if t.strip() else None


goc = json.load(open("web/data/ialy/custom.json", encoding="utf-8"))["custom"]
ten = {o["id"]: o["ma"] for ds in goc.values() for o in ds if o.get("ma")}
print("co ten tren ban ve:", len(ten), "hong")

hang = goi("ialy_thiet_ke?doc=eq.%s&select=*" % DOC)
if not hang:
    print("chua co ban ve tren dam may -> khong can sua"); raise SystemExit
noi = hang[0]["du_lieu"]
if isinstance(noi, str):
    noi = json.loads(noi)

dem = 0
for ds in (noi.get("custom") or {}).values():
    for o in ds:
        if o.get("id") in ten and o.get("ma") != ten[o["id"]]:
            o["ma"] = ten[o["id"]]; dem += 1
print("cap nhat", dem, "hong")
if dem:
    goi("ialy_thiet_ke?on_conflict=doc", [{"doc": DOC, "du_lieu": noi}], "POST",
        {"Prefer": "resolution=merge-duplicates"})
    print("da day len dam may")
