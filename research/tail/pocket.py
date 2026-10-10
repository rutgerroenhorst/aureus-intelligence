"""Is there any pocket (a simple rule on information the system already has at entry) with a positive forward result?
Entry points: every ~30 min for the first 24 h of each coin's life (from 1 h after listing). Outcome: the ladder+stop policy over the next 72 h.
Rules are fixed in advance (24 combinations). Train on the earlier 55% of coins by listing date, test on the later 45%."""
import os, sys, pickle, csv, math, random, statistics as st, collections, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from policy import run_policy

coins = pickle.load(open(f"{D}/coins.pkl", "rb"))   # written by tail_features.py


def fl(x):
    try:
        return float(x) if x != "" else None
    except Exception:
        return None


obs = collections.defaultdict(list)
for r in csv.DictReader(open(f"{D}/all_obs.csv")):
    obs[r["cid"]].append((int(r["ts"]), fl(r["b_h1"]), fl(r["s_h1"]), fl(r["liq"]), fl(r["v_h1"]), fl(r["pc_h1"]), fl(r["pc_h6"])))

entries = []   # per coin list of dict
for cid, c in coins.items():
    if cid not in obs or c["n"] < 20:
        continue
    path = [(t, p) for t, p, _ in c["path"]]
    ts = [t for t, _ in path]
    o = {x[0]: x for x in obs[cid]}
    t0 = path[0][0]
    mark = t0 + 3600
    seen = set()
    lst = []
    while mark <= t0 + 24 * 3600:
        i = bisect.bisect_left(ts, mark)
        if i >= len(path) - 8:
            break
        if i not in seen:
            seen.add(i)
            t_i, p_i = path[i]
            if t_i in o:
                _, b1, s1, liq, v1, pc1, pc6 = o[t_i]
                j = bisect.bisect_left(ts, t_i - 24 * 3600)
                hi = max(p for _, p in path[j:i + 1])
                tr = (b1 or 0) + (s1 or 0)
                ev = run_policy(path[i:], horizon=72 * 3600)
                if ev is not None and liq:
                    lst.append(dict(dd=p_i / hi, liq=liq, trades=tr, age=(t_i - t0) / 3600, ev=ev,
                                    gate=bool((pc1 is not None and pc1 < -70) or (pc6 is not None and pc6 < -70))))
        mark += 1800
    if lst:
        entries.append((c["t0"], cid, lst))
entries.sort()
split = int(len(entries) * 0.55)
train, test = entries[:split], entries[split:]
print(f"coins with entry points: {len(entries)} (train {len(train)}, test {len(test)}); entry points: {sum(len(e[2]) for e in entries)}")

RULES = []
for dd in (None, 0.7, 0.5, 0.3):
    for lq in (None, 15000, 25000):
        for tr in (None, 100):
            RULES.append((dd, lq, tr))


def sel(e, rule):
    dd, lq, tr = rule
    return (dd is None or e["dd"] <= dd) and (lq is None or e["liq"] >= lq) and (tr is None or e["trades"] >= tr)


def evaluate(group, rule):
    per = []
    for _, cid, lst in group:
        s = [e["ev"] for e in lst if sel(e, rule)]
        if s:
            per.append(st.mean(s))
    return per


def name(rule):
    dd, lq, tr = rule
    parts = []
    parts.append("any price position" if dd is None else f"price <= {int(dd * 100)}% of its 24h high")
    parts.append("any liquidity" if lq is None else f"liquidity >= ${lq // 1000}K")
    parts.append("any activity" if tr is None else f"trades last hour >= {tr}")
    return ", ".join(parts)


base_train = evaluate(train, (None, None, None))
base_test = evaluate(test, (None, None, None))
print(f"\nbaseline (every entry point): train {100 * (st.mean(base_train) - 1):+.1f}%  test {100 * (st.mean(base_test) - 1):+.1f}%")
print(f"\n{'rule':78}{'train n':>8}{'train mean':>11}{'test n':>8}{'test mean':>10}{'90% interval (test)':>22}")
rows = []
rng = random.Random(3)
for rule in RULES:
    a = evaluate(train, rule)
    b = evaluate(test, rule)
    if len(a) < 30 or len(b) < 25:
        continue
    boots = sorted(st.mean(rng.choice(b) for _ in b) for _ in range(500))
    rows.append((st.mean(a), rule, len(a), len(b), st.mean(b), boots[25], boots[475]))
rows.sort(key=lambda r: -r[0])
for ma, rule, na, nb, mb, lo, hi in rows:
    print(f"{name(rule):78}{na:8d}{100 * (ma - 1):+10.1f}%{nb:8d}{100 * (mb - 1):+9.1f}%   [{100 * (lo - 1):+.0f}%, {100 * (hi - 1):+.0f}%]")
best = rows[0]
print(f"\nBest rule on the TRAIN half: {name(best[1])}")
print(f"   train {100 * (best[0] - 1):+.1f}%  ->  TEST {100 * (best[4] - 1):+.1f}%  [{100 * (best[5] - 1):+.0f}%, {100 * (best[6] - 1):+.0f}%]   (baseline test {100 * (st.mean(base_test) - 1):+.1f}%)")
# the gate itself, in the same framework
for lab, f in (("entry points the shared dump gate would BLOCK (h1 or h6 below -70%)", lambda e: e["gate"]), ("entry points the gate would pass", lambda e: not e["gate"])):
    v = [st.mean(e["ev"] for e in lst if f(e)) for _, _, lst in entries if any(f(e) for e in lst)]
    print(f"{lab}: coins {len(v)}, mean {100 * (st.mean(v) - 1):+.1f}%")
