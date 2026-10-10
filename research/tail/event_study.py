import os
"""Event study: what does the market look like right before a coin starts a >=2.5x run, versus matched ordinary moments?"""
import sys, pickle, csv, random, math, statistics as st, collections, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import auc_perm, fmt

D = "/tmp/pat"
coins = pickle.load(open(f"{D}/coins.pkl", "rb"))
# winners (>=3x held 30 min) plus 260 random ordinary coins with >= 40 observations (seed 21), as in the written analysis
_w3 = [c for c in coins.values() if c["sust"] >= 3]
_rest = [c for c in coins.values() if c["sust"] < 3 and c["n"] >= 40]
ids = [c["cid"] for c in _w3] + [c["cid"] for c in random.Random(21).sample(_rest, 260)]


def fl(x):
    try:
        return float(x) if x != "" else None
    except Exception:
        return None


obs = collections.defaultdict(list)
for r in csv.DictReader(open(f"{D}/all_obs.csv")):
    obs[r["cid"]].append(dict(ts=int(r["ts"]), v_m5=fl(r["v_m5"]), v_h1=fl(r["v_h1"]), v_h6=fl(r["v_h6"]),
                              b_m5=fl(r["b_m5"]), s_m5=fl(r["s_m5"]), b_h1=fl(r["b_h1"]), s_h1=fl(r["s_h1"]), b_h6=fl(r["b_h6"]), s_h6=fl(r["s_h6"]),
                              pc_m5=fl(r["pc_m5"]), pc_h1=fl(r["pc_h1"]), pc_h6=fl(r["pc_h6"]), price=fl(r["price"]), liq=fl(r["liq"]), boosts=fl(r["boosts"]) or 0))

# a clean time set per coin (the phantom prints were removed from coins[...]['path'])
clean_ts = {cid: {t for t, _, _ in coins[cid]["path"]} for cid in ids if cid in coins}


def features(cid, i, series):
    """Features at observation i using only what was known at that time (this snapshot and the past)."""
    o = series[i]
    t = o["ts"]
    p = o["price"]
    if not p or p <= 0:
        return None
    f = {}
    f["age_h"] = (t - series[0]["ts"]) / 3600
    if o["v_h6"] and o["v_h6"] > 0 and o["v_h1"] is not None:
        f["volume acceleration (1h vs 6h avg)"] = math.log10((o["v_h1"] + 1) / (o["v_h6"] / 6 + 1))
    if o["b_h1"] is not None and o["s_h1"] is not None and o["b_h1"] + o["s_h1"] >= 20:
        f["buy share 1h"] = o["b_h1"] / (o["b_h1"] + o["s_h1"])
    if o["b_m5"] is not None and o["s_m5"] is not None and o["b_m5"] + o["s_m5"] >= 6:
        f["buy share 5m"] = o["b_m5"] / (o["b_m5"] + o["s_m5"])
    if o["b_h1"] is not None and o["s_h1"] is not None:
        f["trades 1h (log10)"] = math.log10(o["b_h1"] + o["s_h1"] + 1)
    if o["b_h6"] is not None and o["s_h6"] is not None and o["b_h1"] is not None:
        tr6 = o["b_h6"] + o["s_h6"]
        if tr6 > 30:
            f["trade-rate now vs 6h avg"] = math.log10(((o["b_h1"] + o["s_h1"]) + 1) / (tr6 / 6 + 1))
    if o["v_h1"] is not None and o["liq"]:
        f["volume 1h / liquidity"] = o["v_h1"] / o["liq"]
    if o["liq"]:
        f["liquidity (log10)"] = math.log10(o["liq"])
    for k, name in (("pc_m5", "price change 5m"), ("pc_h1", "price change 1h"), ("pc_h6", "price change 6h")):
        if o[k] is not None:
            f[name] = o[k]
    # position in the last 24 h range and liquidity trend, from earlier snapshots
    j = bisect.bisect_left([x["ts"] for x in series[:i + 1]], t - 24 * 3600)
    prior = [x for x in series[j:i + 1] if x["price"]]
    if len(prior) >= 6:
        hi, lo = max(x["price"] for x in prior), min(x["price"] for x in prior)
        f["price vs 24h high"] = p / hi
        f["price vs 24h low"] = math.log10(p / lo)
        if hi > lo:
            f["position in 24h range"] = (p - lo) / (hi - lo)
        rets = [math.log(prior[k + 1]["price"] / prior[k]["price"]) for k in range(len(prior) - 1) if prior[k]["price"] and prior[k + 1]["price"]]
        if len(rets) >= 5:
            f["volatility 24h"] = st.pstdev(rets)
    j6 = bisect.bisect_left([x["ts"] for x in series[:i + 1]], t - 6 * 3600)
    if j6 < i and series[j6]["liq"] and o["liq"]:
        f["liquidity change 6h"] = math.log10(o["liq"] / series[j6]["liq"])
    f["boosted"] = 1.0 if o["boosts"] > 0 else 0.0
    f["hour of day (UTC)"] = datetime_hour(t)
    return f


def datetime_hour(t):
    return float((t // 3600) % 24)


def forward_gain(path, i, horizon=12 * 3600):
    """Highest price held >= 30 min within the horizon, relative to path[i]."""
    t0, p0 = path[i]
    best = 0.0
    n = len(path)
    for a in range(i + 1, n):
        if path[a][0] - t0 > horizon:
            break
        b = a
        while b + 1 < n and path[b + 1][0] - path[a][0] <= 1800:
            b += 1
        if b > a or path[-1][0] - path[a][0] < 1800:
            best = max(best, min(p for _, p in path[a:b + 1]) / p0)
    return best


events, controls = [], []
rng = random.Random(5)
for cid in ids:
    c = coins.get(cid)
    if not c or cid not in obs:
        continue
    series = [o for o in obs[cid] if o["ts"] in clean_ts[cid]]
    if len(series) < 30:
        continue
    path = [(o["ts"], o["price"]) for o in series if o["price"]]
    series = [o for o in series if o["price"]]
    winner = c["sust"] >= 3
    if winner:
        # first moment that sits at/near a local base and is followed by a >= 2.5x sustained run within 12 h
        found = None
        for i in range(6, len(path) - 3):
            if path[i][0] - path[0][0] < 3600:
                continue
            base3h = min(p for t, p in path[max(0, i - 40):i + 1] if path[i][0] - t <= 3 * 3600) if i else path[i][1]
            if path[i][1] <= 1.15 * base3h and forward_gain(path, i) >= 2.5:
                found = i
                break
        if found is not None:
            f = features(cid, found, series)
            if f:
                events.append((cid, c["name"], series[found]["ts"], f))
    else:
        # ordinary moments: observations that were followed by no real run (<1.3x) - a handful per coin
        idxs = [i for i in range(6, len(path) - 3) if path[i][0] - path[0][0] >= 3600]
        rng.shuffle(idxs)
        taken = 0
        for i in idxs:
            base3h = min(pp for tt, pp in path[max(0, i - 40):i + 1] if path[i][0] - tt <= 3 * 3600)
            if path[i][1] <= 1.15 * base3h and forward_gain(path, i) < 1.3:
                f = features(cid, i, series)
                if f:
                    controls.append((cid, c["name"], series[i]["ts"], f))
                    taken += 1
            if taken >= 25:
                break

print(f"breakout events: {len(events)} (one per winner coin)   ordinary moments: {len(controls)} from {len(set(c[0] for c in controls))} coins")
print("\nWhen did the breakouts start relative to listing? (hours since first observation)")
ages = sorted(e[3]["age_h"] for e in events)
print("   age at breakout: min %.1f, 25%% %.1f, median %.1f, 75%% %.1f, max %.1f" % (ages[0], ages[len(ages) // 4], ages[len(ages) // 2], ages[3 * len(ages) // 4], ages[-1]))

# match: for every event keep controls at a similar age (so 'age' does not explain the difference)
matched = []
ctrl_by_age = sorted(controls, key=lambda c: c[3]["age_h"])
ages_sorted = [c[3]["age_h"] for c in ctrl_by_age]
used = set()
for e in events:
    a = e[3]["age_h"]
    lo, hi = bisect.bisect_left(ages_sorted, a * 0.8 - 0.5), bisect.bisect_right(ages_sorted, a * 1.2 + 0.5)
    pool = [k for k in range(lo, hi) if k not in used]
    rng.shuffle(pool)
    for k in pool[:12]:
        used.add(k)
        matched.append(ctrl_by_age[k])
print(f"matched ordinary moments: {len(matched)}")

fnames = sorted({k for e in events for k in e[3] if k != "age_h"})
rows = []
for nme in fnames:
    pos = [e[3][nme] for e in events if nme in e[3]]
    neg = [m[3][nme] for m in matched if nme in m[3]]
    a, p = auc_perm(pos, neg, n_perm=5000, rng=random.Random(9))
    if a is None:
        continue
    rows.append((p, a, nme, len(pos), len(neg), st.median(pos), st.median(neg)))
rows.sort()
print(f"\n{'feature at the moment before the run':44}{'AUC':>6}{'p':>8}{'events':>8}{'median event':>14}{'median ordinary':>16}")
for p, a, nme, npos, nneg, mp, mn in rows:
    print(f"{nme:44}{a:6.2f}{p:8.3f}{npos:8d}{mp:14.3g}{mn:16.3g}")
print(f"({len(rows)} features tested; Bonferroni bar p < {0.05 / len(rows):.4f}; AUC 0.5 = no information)")
pickle.dump((events, matched), open(f"{D}/events.pkl", "wb"))
