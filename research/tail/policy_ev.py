"""What is a ladder-with-stop worth on the cleaned paths, and how much filter skill would it take to make it pay?"""
import os, sys, pickle, random, statistics as st, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from policy import run_policy, hold

coins = pickle.load(open(f"{D}/coins.pkl", "rb"))   # written by tail_features.py

rows = []
for cid, c in coins.items():
    path = [(t, p) for t, p, _ in c["path"]]
    if len(path) < 8:
        continue
    r = dict(cid=cid, t0=c["t0"], sust=c["sust"], name=c["name"],
             ladder=run_policy(path), ladder_d30=run_policy(path, delay=1800), hold=hold(path), hold_d30=hold(path, delay=1800),
             stop_only=run_policy(path, ladder=()), all_in_5x=run_policy(path, ladder=((5.0, 1.0),)),
             life_h=c["life_h"])
    if r["ladder"] is None:
        continue
    rows.append(r)
rows.sort(key=lambda r: r["t0"])
n = len(rows)
print(f"coins: {n}")


def summ(label, key, rs=rows):
    v = [r[key] for r in rs if r[key] is not None]
    mean = st.mean(v)
    rng = random.Random(1)
    boots = sorted(st.mean(rng.choice(v) for _ in v) for _ in range(1000))
    # leave-out-the-best: how much of the mean is one coin
    v2 = sorted(v)[:-1]
    print(f"  {label:42} mean {100 * (mean - 1):+6.1f}%  90% interval [{100 * (boots[50] - 1):+.0f}%, {100 * (boots[950] - 1):+.0f}%]   median {100 * (st.median(v) - 1):+5.0f}%   without the single best coin {100 * (st.mean(v2) - 1):+6.1f}%   share ending >= 1x: {100 * sum(x >= 1 for x in v) / len(v):.0f}%")


print("\nEqual stake in every coin the system listed, entering at the system's first price (5% cost on every sale), 7-day horizon:")
summ("hold everything 7 days", "hold")
summ("stop -50%, no targets", "stop_only")
summ("sell all at 5x (stop -50% before)", "all_in_5x")
summ("ladder 25%@2x 25%@5x 25%@10x + 40% trail, stop -50%", "ladder")
print("\nSame but entering 30 minutes later (you are not there at the first price):")
summ("hold 7 days (30 min late)", "hold_d30")
summ("ladder (30 min late)", "ladder_d30")

# ---- time split: does the picture hold in both halves?
half = n // 2
print("\nSame ladder policy, first half vs second half of the listing dates:")
summ("first half", "ladder", rows[:half])
summ("second half", "ladder", rows[half:])

# ---- how much filter skill would it take? synthetic score with a chosen AUC against the real >=3x winners
labels = [1 if r["sust"] >= 3 else 0 for r in rows]
vals = [r["ladder"] for r in rows]
npos = sum(labels)
print(f"\nSensitivity: if a filter had skill AUC=x at spotting the {npos} coins that held >=3x, and we bought only its top 20% / top 10%:")


def dprime_for_auc(a):
    # binormal: AUC = Phi(d/sqrt2)
    lo, hi = 0.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if 0.5 * (1 + math.erf(mid / 2)) < a:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


rng = random.Random(11)
print(f"  {'AUC':>5}{'top 20%: mean result':>24}{'top 10%: mean result':>24}{'winners kept (top 20%)':>24}")
for a in (0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9):
    d = dprime_for_auc(a)
    res20, res10, kept = [], [], []
    for _ in range(600):
        score = [labels[i] * d + rng.gauss(0, 1) for i in range(n)]
        order = sorted(range(n), key=lambda i: -score[i])
        t20, t10 = order[: n // 5], order[: n // 10]
        res20.append(st.mean(vals[i] for i in t20))
        res10.append(st.mean(vals[i] for i in t10))
        kept.append(sum(labels[i] for i in t20) / npos)
    print(f"  {a:5.2f}{100 * (st.mean(res20) - 1):+23.1f}%{100 * (st.mean(res10) - 1):+23.1f}%{100 * st.mean(kept):23.0f}%")

# upper bounds
v_sorted = sorted(vals, reverse=True)
print(f"\nUpper bounds with perfect foresight: only the best 5% of coins: {100 * (st.mean(v_sorted[: n // 20]) - 1):+.0f}%;  only the {npos} >=3x coins: {100 * (st.mean(r['ladder'] for r, l in zip(rows, labels) if l) - 1):+.0f}%")
nolose = [r["ladder"] for r in rows if r["sust"] >= 1.0 or True]
# perfect rug filter: drop the coins whose ladder result < 0.55 (stopped out at -50%+)
keep = [v for v in vals if v >= 0.55]
print(f"Perfect 'avoid every coin that gets stopped out' filter (unrealistic): keeps {100 * len(keep) / n:.0f}% of coins, mean {100 * (st.mean(keep) - 1):+.0f}%")
