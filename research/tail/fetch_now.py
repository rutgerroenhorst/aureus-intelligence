import csv, json, time, urllib.request, urllib.error
rows = list(csv.reader(open("/tmp/pat/cands.csv")))
mints = sorted({r[1] for r in rows})
pools = {r[0]: r[1] for r in csv.reader(open("/tmp/pat/pools.csv"))}
now = {}
def get(url):
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "Aureus-analysis"}), timeout=30))
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(15 * (i + 1)); continue
            raise
    return []
for i in range(0, len(mints), 30):
    batch = mints[i:i + 30]
    pairs = get("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(batch)) or []
    best = {}
    for p in pairs:
        m = p["baseToken"]["address"]
        liq = (p.get("liquidity") or {}).get("usd") or 0
        if m not in best or liq > best[m]["liq"]:
            best[m] = dict(liq=liq, mcap=p.get("marketCap") or p.get("fdv"), price=float(p["priceUsd"]) if p.get("priceUsd") else None,
                           v24=(p.get("volume") or {}).get("h24"), created=p.get("pairCreatedAt"), dex=p.get("dexId"), pair=p.get("pairAddress"),
                           b24=((p.get("txns") or {}).get("h24") or {}).get("buys"), s24=((p.get("txns") or {}).get("h24") or {}).get("sells"))
    now.update(best)
    time.sleep(1.2)
json.dump(now, open("/tmp/pat/now.json", "w"))
print(len(mints), "mints;", len(now), "still have a pair on DexScreener")
