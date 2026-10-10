"""Replay the shared safety gate (apps/web/app/api/safety-gate/route.ts: evaluatePair) on the stored DexScreener snapshots
and grade what it blocks, looking only FORWARD from the moment of the check (so no lookahead).

Input: payload_feats.csv (snapshots at listing and 1/3/6/24 h later), coins.pkl (cleaned paths, written by tail_features.py)."""
import os, sys, pickle, csv, collections, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from policy import run_policy

coins = pickle.load(open(f"{D}/coins.pkl", "rb"))
pf = collections.defaultdict(dict)
for r in csv.DictReader(open(f"{D}/payload_feats.csv")):
    pf[r["cid"]][int(r["tau_h"])] = r


def fl(x):
    try:
        return float(x)
    except Exception:
        return None


def gate(p):
    """Exact port of evaluatePair(): True when the live gate would hide the coin."""
    m5p, h1p, h6p, h24p = fl(p["pc_m5"]), fl(p["pc_h1"]), fl(p["pc_h6"]), fl(p["pc_h24"])
    b5, s5, b1, s1 = fl(p["b_m5"]), fl(p["s_m5"]), fl(p["b_h1"]), fl(p["s_h1"])
    if b5 is not None and s5 is not None and m5p is not None:
        ratio = s5 / max(b5, 1)
        if (ratio > 4 and m5p < -50) or (ratio > 3 and m5p < -40) or m5p < -70:
            return True
    if b1 is not None and s1 is not None and h1p is not None:
        if (s1 / max(b1, 1) > 3.5 and h1p < -60) or h1p < -70:
            return True
    if (not m5p) and b5 and s5 is not None and s5 / max(b5, 1) > 5:
        return True
    if h6p is not None and h6p < -70:
        return True
    if h24p is not None and h24p < -80:
        return True
    return False


# 1. what it blocks at the first look, and which validated winners that costs
ids = [c for c in coins if 0 in pf[c]]
blocked = [c for c in ids if gate(pf[c][0])]
print(f"At listing the gate hides {len(blocked)} of {len(ids)} coins ({100 * len(blocked) / len(ids):.0f}%).")
print("Validated >=10x winners it would have hidden at listing:")
for c in ids:
    if coins[c]["sust"] >= 10 and gate(pf[c][0]):
        print(f"   {coins[c]['name'][:10]:11}{coins[c]['sust']:5.0f}x   h1 {pf[c][0]['pc_h1']}%  h6 {pf[c][0]['pc_h6']}%")

# 2. forward from the moment of the check: the next 72 h, price held 30 min, ladder + stop policy
print("\nForward from the check (your entry = the price at that moment), next 72 h:")
print(f"{'check at':>9}{'group':>9}{'n':>6}{'>=2x':>8}{'>=3x':>8}{'>=5x':>8}{'ladder+stop mean':>18}{'ended >=1x':>12}")
for tau in (0, 1, 3, 6, 24):
    for g in (True, False):
        out = []
        for cid, c in coins.items():
            if tau not in pf[cid] or gate(pf[cid][tau]) != g:
                continue
            ts = int(pf[cid][tau]["ts"])
            path = [(t, p) for t, p, _ in c["path"] if t >= ts]
            if len(path) < 6:
                continue
            pk, _ = sustained_peak([(t, p) for t, p in path if t - path[0][0] <= 72 * 3600])
            out.append((pk / path[0][1], run_policy(path, horizon=72 * 3600)))
        n = len(out)
        if n < 10:
            continue
        f = lambda x: sum(1 for m, r in out if m >= x)
        v = [r for m, r in out if r is not None]
        print(f"{('+' + str(tau) + ' h') if tau else 'listing':>9}{'blocked' if g else 'passes':>9}{n:6d}{100 * f(2) / n:7.1f}%{100 * f(3) / n:7.1f}%{100 * f(5) / n:7.1f}%{100 * (st.mean(v) - 1):17.1f}%{100 * sum(x >= 1 for x in v) / len(v):11.0f}%")
