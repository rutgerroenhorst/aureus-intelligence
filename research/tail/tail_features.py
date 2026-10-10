import os
import sys, pickle, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

cache = f"{D}/coins.pkl"
if os.path.exists(cache):
    coins = pickle.load(open(cache, "rb"))
else:
    coins = build_coins()
    pickle.dump(coins, open(cache, "wb"))
print("coins", len(coins), " phantom-affected", sum(1 for c in coins.values() if c["phantom"]))

# ---- listing-time payload features (tau = 0)
pf = {}
with open(f"{D}/payload_feats.csv") as f:
    for r in csv.DictReader(f):
        if r["tau_h"] == "0":
            pf[r["cid"]] = r


def fl(x):
    try:
        return float(x)
    except Exception:
        return None


def bl(x):
    return 1.0 if x in ("t", "true", "True") else (0.0 if x in ("f", "false", "False") else None)


enr = {}
with open(f"{D}/enrich_feats.csv") as f:
    for r in csv.DictReader(f):
        enr[r["cid"]] = r

for cid, c in coins.items():
    c["W10"] = c["sust"] >= 10
    c["W5"] = c["sust"] >= 5
    c["W3"] = c["sust"] >= 3
    c["W50"] = c["sust"] >= 50
    for m in (2, 3, 5, 10):
        t = first_cross([(t, p) for t, p, _ in c["path"]], c["p0"] * m)
        c[f"t{m}"] = (t - c["t0"]) / 3600 if t else None

print(f"classes: W3={sum(c['W3'] for c in coins.values())}  W5={sum(c['W5'] for c in coins.values())}  W10={sum(c['W10'] for c in coins.values())}  W50={sum(c['W50'] for c in coins.values())}  (of {len(coins)})")

# ---- the winners table
print("\nVALIDATED WINNERS (price held for 30 min, phantom prints removed), listed by size")
print(f"{'coin':11}{'peak':>6}{'x2 after':>9}{'x5 after':>9}{'x10 after':>10}{'obs':>6}{'life d':>7} | {'mcap0':>8}{'liq0':>7}{'h1%':>6}{'h6%':>6}{'dex':>10}{'quote':>6}{'soc':>5}{'boost':>6}")
for c in sorted([c for c in coins.values() if c["W10"]], key=lambda c: -c["sust"]):
    p = pf.get(c["cid"], {})
    ff = lambda k: (f"{fl(p.get(k)):.0f}" if fl(p.get(k)) is not None else "-")
    fh = lambda x: ("-" if x is None else f"{x:.1f}h")
    print(f"{c['name'][:10]:11}{c['sust']:>5.0f}x{fh(c['t2']):>9}{fh(c['t5']):>9}{fh(c['t10']):>10}{c['n']:>6}{c['life_h'] / 24:>7.1f} | {ff('mcap'):>8}{ff('liq'):>7}{ff('pc_h1'):>6}{ff('pc_h6'):>6}{p.get('dex', '-'):>10}{p.get('quote_sym', '-'):>6}{p.get('n_soc', '-'):>5}{p.get('boosts', '-'):>6}")

# ---- univariate tests at listing
def feature_table():
    rows = {}
    for cid, c in coins.items():
        p = pf.get(cid)
        if not p:
            continue
        e = enr.get(cid, {})
        mcap, liq = fl(p["mcap"]), fl(p["liq"])
        b1, s1, b6, s6 = fl(p["b_h1"]) or 0, fl(p["s_h1"]) or 0, fl(p["b_h6"]) or 0, fl(p["s_h6"]) or 0
        age_min = (c["t0"] - int(p["created_ms"]) / 1000) / 60 if p["created_ms"] else None
        f = {
            "mcap (log10)": math.log10(mcap) if mcap else None,
            "liquidity (log10)": math.log10(liq) if liq else None,
            "liquidity / mcap": liq / mcap if liq and mcap else None,
            "age at listing (min)": age_min,
            "price change 5m": fl(p["pc_m5"]), "price change 1h": fl(p["pc_h1"]), "price change 6h": fl(p["pc_h6"]), "price change 24h": fl(p["pc_h24"]),
            "buy share 1h": b1 / (b1 + s1) if b1 + s1 >= 20 else None,
            "buy share 6h": b6 / (b6 + s6) if b6 + s6 >= 60 else None,
            "trades 1h (log10)": math.log10(b1 + s1 + 1), "trades 6h (log10)": math.log10(b6 + s6 + 1),
            "volume 1h / liquidity": (fl(p["v_h1"]) or 0) / liq if liq else None,
            "volume 6h / liquidity": (fl(p["v_h6"]) or 0) / liq if liq else None,
            "avg trade size 1h ($)": (fl(p["v_h1"]) or 0) / (b1 + s1) if b1 + s1 > 0 else None,
            "has DexScreener profile (info)": bl(p["has_info"]),
            "has website": 1.0 if (fl(p["n_web"]) or 0) > 0 else 0.0,
            "has any social": 1.0 if (fl(p["n_soc"]) or 0) > 0 else 0.0,
            "has twitter": 1.0 if "twitter" in (p["soc_types"] or "") else 0.0,
            "has telegram": 1.0 if "telegram" in (p["soc_types"] or "") else 0.0,
            "has header image": bl(p["has_header"]),
            "boosted (active boosts>0)": 1.0 if (fl(p["boosts"]) or 0) > 0 else 0.0,
            "pumpswap pair": 1.0 if p["dex"] == "pumpswap" else 0.0,
            "raydium pair": 1.0 if p["dex"] == "raydium" else 0.0,
            "quote is SOL": 1.0 if p["quote_sym"] == "SOL" else 0.0,
            "quote is USDC": 1.0 if p["quote_sym"] == "USDC" else 0.0,
        }
        if e:
            f.update({
                "largest holder % (RugCheck)": fl(e["top1"]), "top5 holders %": fl(e["top5"]), "insider %": fl(e["insider"]), "top10 holders %": fl(e["top10"]),
                "mint authority active": bl(e["mint_active"]), "freeze authority active": bl(e["freeze_active"]),
                "sell impact $250 (%)": fl(e["imp250"]), "sell impact $1000 (%)": fl(e["imp1000"]),
                "deployer funding traced": 1.0 if e["st_depfund"] == "OK" else 0.0,
                "enrichment complete (safety datasets OK)": 1.0 if all(e[k] == "OK" for k in ("st_supply", "st_holders", "st_auth", "st_sell", "st_rug")) else 0.0,
            })
        rows[cid] = f
    return rows


FT = feature_table()
names_f = sorted({k for f in FT.values() for k in f})
rng = random.Random(7)
for label, key in (("W10 (>=10x, held 30 min)", "W10"), ("W5 (>=5x)", "W5"), ("W3 (>=3x)", "W3")):
    npos = sum(1 for cid in FT if coins[cid][key])
    print(f"\n=== Listing-time features vs {label}: {npos} winners of {len(FT)} coins. AUC 0.5 = no information; p from 4000 permutations")
    res = []
    for nme in names_f:
        pos = [FT[c][nme] for c in FT if coins[c][key] and FT[c].get(nme) is not None]
        neg = [FT[c][nme] for c in FT if not coins[c][key] and FT[c].get(nme) is not None]
        a, pv = auc_perm(pos, neg, rng=rng)
        if a is None:
            continue
        res.append((pv, a, nme, len(pos), len(neg), st.median(pos), st.median(neg)))
    res.sort()
    print(f"{'feature':44}{'AUC':>6}{'p':>8}{'winners n':>10}{'median win':>12}{'median rest':>12}")
    for pv, a, nme, np_, nn, mp, mn in res[:14]:
        print(f"{nme:44}{a:6.2f}{pv:8.3f}{np_:10d}{mp:12.3g}{mn:12.3g}")
    k = len(res)
    print(f"   ({k} features tested; with Bonferroni the bar is p < {0.05 / k:.4f})")
