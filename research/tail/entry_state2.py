"""Robustness of the 'entry state' pattern: liquidity floor, complete forward windows, time halves, first 2 h only."""
import csv, collections, random, statistics as st, bisect, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D

random.seed(3)
COST = 0.05
HORIZON = 6 * 3600
ENTRY_WINDOW = 12 * 3600

import pickle
cleaned = pickle.load(open(f"{D}/coins.pkl", "rb"))      # cleaned paths, written by tail_features.py
series = {cid: [(t - c["t0"], p) for t, p, _ in c["path"]] for cid, c in cleaned.items() if len(c["path"]) >= 8}
t0_of = {cid: c["t0"] for cid, c in cleaned.items()}
liq = collections.defaultdict(list)
for cid, ts, l in csv.reader(open(f"{D}/liq.csv")):
    liq[cid].append((int(ts), float(l)))
liq_ts = {cid: [t for t, _ in v] for cid, v in liq.items()}


def liq_at(cid, t_abs):
    ts = liq_ts.get(cid)
    if not ts:
        return None
    i = bisect.bisect_right(ts, t_abs) - 1
    if i < 0 or t_abs - ts[i] > 3 * 3600:
        return None
    return liq[cid][i][1]


def forward(path, k, up=2.0, down=0.5):
    t_k, p_k = path[k]
    first, last, last_t = None, p_k, t_k
    for t, p in path[k + 1:]:
        if t - t_k > HORIZON:
            break
        last, last_t = p, t
        m = p / p_k
        if first is None:
            if m >= up:
                first = "up"
            elif m <= down:
                first = "down"
    complete = (last_t - t_k) >= HORIZON * 0.8
    return first, last / p_k - 1.0, complete


def run_plan(path, k, targets=((2.0, 0.5),), trail=0.4):
    t_k, p_k = path[k]
    rem, proceeds, armed, peak = 1.0, 0.0, False, p_k
    filled = [False] * len(targets)
    last = p_k
    for t, p in path[k + 1:]:
        if t - t_k > HORIZON:
            break
        last = p
        m = p / p_k
        peak = max(peak, p)
        for i, (tm, fr) in enumerate(targets):
            if not filled[i] and m >= tm and rem > 1e-9:
                take = min(fr, rem)
                proceeds += take * tm
                rem -= take
                filled[i] = True
                armed = True
        if rem > 1e-9 and armed and p <= peak * (1 - trail):
            proceeds += rem * m
            rem = 0
            break
    if rem > 1e-9:
        proceeds += rem * (last / p_k)
    return proceeds * (1 - COST) - 1


coins = []
for cid, path in series.items():
    if len(path) < 8:
        continue
    p0 = path[0][1]
    run_max = p0
    obs = []
    for k in range(len(path) - 1):
        t, p = path[k]
        run_max = max(run_max, p)
        if t > ENTRY_WINDOW:
            break
        if t == 0:
            continue
        first, ret, complete = forward(path, k)
        obs.append(dict(dd=p / run_max, run=run_max / p0, t=t, first=first, ret=ret, complete=complete,
                        plan=run_plan(path, k), liq=liq_at(cid, t0_of[cid] + t)))
    if obs:
        coins.append(dict(cid=cid, t0=t0_of[cid], obs=obs))
coins.sort(key=lambda c: c["t0"])
half = len(coins) // 2


def table(key, cuts, label, filt=lambda o: True, subset=None, show_incomplete=False):
    print(f"\n{label}")
    hdr = f"{'bucket':14}{'coins':>6}{'obs':>7}{'doubled first':>14}{'halved first':>13}{'mean plan':>11}{'  90% interval':>16}"
    if show_incomplete:
        hdr += f"{'window cut short':>18}"
    print(hdr)
    edges = [-1e18] + cuts + [1e18]
    for lo, hi in zip(edges[:-1], edges[1:]):
        per, n_obs, cut = [], 0, 0
        for c in (subset if subset is not None else coins):
            sel = [o for o in c["obs"] if lo <= o[key] < hi and filt(o)]
            if not sel:
                continue
            n_obs += len(sel)
            cut += sum(not o["complete"] for o in sel)
            per.append(dict(up=sum(o["first"] == "up" for o in sel) / len(sel), down=sum(o["first"] == "down" for o in sel) / len(sel), plan=st.mean(o["plan"] for o in sel)))
        if len(per) < 15:
            continue
        nm = f"< {hi:g}" if lo < -1e17 else (f">= {lo:g}" if hi > 1e17 else f"{lo:g} .. {hi:g}")
        boots = sorted(st.mean(random.choice(per)["plan"] for _ in per) for _ in range(400))
        line = (f"{nm:14}{len(per):6d}{n_obs:7d}{100 * st.mean(p['up'] for p in per):13.0f}%{100 * st.mean(p['down'] for p in per):12.0f}%"
                f"{100 * st.mean(p['plan'] for p in per):10.0f}%   [{100 * boots[20]:.0f},{100 * boots[380]:.0f}]".ljust(16))
        if show_incomplete:
            line += f"{100 * cut / n_obs:17.0f}%"
        print(line)


DD = [0.3, 0.5, 0.7, 0.9, 0.99]
RUN = [1.0001, 1.5, 2.0, 3.0, 5.0]
table("dd", DD, "A. Distance below the running high (all entries) - with how often the 6 h window was cut short (coin vanished / tracking stopped)", show_incomplete=True)
table("dd", DD, "B. Same, only entries where liquidity >= $6K (the system's own buy floor) and the 6 h window is complete", filt=lambda o: o["liq"] is not None and o["liq"] >= 6000 and o["complete"])
table("run", RUN, "C. Size of the run since listing, same filter as B", filt=lambda o: o["liq"] is not None and o["liq"] >= 6000 and o["complete"])
table("dd", DD, "D. Entries in the first 2 h after listing only (liq >= $6K, complete windows)", filt=lambda o: o["t"] <= 7200 and o["liq"] is not None and o["liq"] >= 6000 and o["complete"])
table("dd", DD, "E1. First half of coins by listing date (liq >= $6K, complete windows)", filt=lambda o: o["liq"] is not None and o["liq"] >= 6000 and o["complete"], subset=coins[:half])
table("dd", DD, "E2. Second half of coins by listing date (liq >= $6K, complete windows)", filt=lambda o: o["liq"] is not None and o["liq"] >= 6000 and o["complete"], subset=coins[half:])
table("run", RUN, "F1. Run size, first half", filt=lambda o: o["liq"] is not None and o["liq"] >= 6000 and o["complete"], subset=coins[:half])
table("run", RUN, "F2. Run size, second half", filt=lambda o: o["liq"] is not None and o["liq"] >= 6000 and o["complete"], subset=coins[half:])
