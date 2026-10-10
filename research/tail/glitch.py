"""Find phantom prints (price/liquidity spikes that appear for a few scans and vanish) and recompute the tail of the distribution."""
import os, sys, csv, collections, bisect, statistics as st, datetime, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D

UTC = datetime.timezone.utc
fmt = lambda t: datetime.datetime.fromtimestamp(t, UTC).strftime("%m-%d %H:%M")

paths = collections.defaultdict(list)          # cid -> [(ts, price, mcap)]
for cid, ts, price, mcap, fdv in csv.reader(open(f"{D}/prices_all.csv")):
    paths[cid].append((int(ts), float(price), float(mcap) if mcap else None))
liq = collections.defaultdict(list)
for cid, ts, l in csv.reader(open(f"{D}/liq.csv")):
    liq[cid].append((int(ts), float(l)))


def liq_series(cid, times):
    ls = sorted(liq[cid])
    lts = [t for t, _ in ls]
    out = []
    for t in times:
        i = bisect.bisect_right(lts, t) - 1
        out.append(ls[i][1] if i >= 0 else None)
    return out


def flag_glitches(cid):
    """An observation is a phantom print when its liquidity AND price are both far above what the coin showed
    just before and just after (median of up to 8 observations on each side, skipping the suspect run itself)."""
    pth = sorted(paths[cid])
    n = len(pth)
    times = [t for t, _, _ in pth]
    lq = liq_series(cid, times)
    flagged = [False] * n
    # a candidate run: consecutive observations with liquidity > 20x the median liquidity of the 8 observations before the run start
    i = 0
    while i < n:
        base = [x for x in lq[max(0, i - 8):i] if x]
        if len(base) >= 3 and lq[i] and lq[i] > 20 * st.median(base) and pth[i][1] > 5 * st.median([p for _, p, _ in pth[max(0, i - 8):i]]):
            j = i
            while j < n and lq[j] and lq[j] > 10 * st.median(base):
                j += 1
            after = [x for x in lq[j:j + 8] if x]
            # the run must end (come back down) - a coin that really stays 20x higher is not a phantom
            if j < n and len(after) >= 1 and st.median(after) < 3 * st.median(base):
                for k in range(i, j):
                    flagged[k] = True
                i = j
                continue
        i += 1
    return pth, flagged


def clean_peak(cid):
    pth, fl = flag_glitches(cid)
    ok = [(t, p) for (t, p, _), f in zip(pth, fl) if not f]
    p0 = pth[0][1]
    raw_peak = max(p for _, p, _ in pth) / p0
    clean = max(p for _, p in ok) / p0
    return raw_peak, clean, sum(fl)


rows = []
affected = []
for cid in paths:
    if len(paths[cid]) < 5:
        continue
    raw, clean, nfl = clean_peak(cid)
    rows.append((cid, raw, clean, nfl))
    if nfl:
        affected.append((cid, raw, clean, nfl))

print(f"coins: {len(rows)}; coins with phantom prints: {len(affected)}")
for cid, raw, clean, nfl in sorted(affected, key=lambda r: -r[1])[:15]:
    print(f"  {cid[:8]}  raw peak {raw:8.1f}x -> clean {clean:6.1f}x   phantom observations {nfl}")


def tail(label, idx):
    vals = sorted((r[idx] for r in rows), reverse=True)
    n = len(vals)
    ge = lambda m: sum(v >= m for v in vals)
    tot = sum(v - 1 for v in vals if v > 1)
    print(f"\n{label}: n={n}")
    for m in (2, 5, 10, 20, 50, 100):
        print(f"   reach >= {m:3d}x: {ge(m):4d}  ({100 * ge(m) / n:4.1f}%)")
    print(f"   biggest: {', '.join(f'{v:.0f}x' for v in vals[:8])}")
    print(f"   share of total peak profit from the biggest coin: {100 * (vals[0] - 1) / tot:.0f}%, from the best 1%: {100 * sum(v - 1 for v in vals[:max(1, n // 100)]) / tot:.0f}%")


tail("RAW peaks (what the earlier numbers were based on)", 1)
tail("CLEAN peaks (phantom prints removed)", 2)
json.dump([(c, r, cl, n) for c, r, cl, n in rows], open(f"{D}/peaks.json", "w"))
