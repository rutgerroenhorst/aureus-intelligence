import csv, json, time, urllib.request, urllib.error
rows = list(csv.reader(open("/tmp/pat/cands.csv")))
mints = sorted({r[1] for r in rows})
out = {}
def get(url):
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "Aureus-analysis", "accept": "application/json"}), timeout=40))
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(10 * (i + 1)); continue
            if e.code in (400, 404): return []
            raise
    return []
for i in range(0, len(mints), 50):
    batch = mints[i:i + 50]
    res = get("https://lite-api.jup.ag/tokens/v2/search?query=" + ",".join(batch)) or []
    for t in res:
        out[t["id"]] = t
    time.sleep(1.5)
json.dump(out, open("/tmp/pat/jup.json", "w"))
print(len(mints), "mints;", len(out), "found at Jupiter")
