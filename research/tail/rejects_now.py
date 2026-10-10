"""What did the coins the engine rejected do afterwards? Outcome measured TODAY for every coin (the same moment, so no
coin is favoured by being tracked longer), relative to the market cap when the system first saw it.

Input: now.json (fetch_now.py), cands.csv, verdicts.csv, enrich_feats.csv (export.sh). 'dead' = no pair or liquidity < $5K."""
import os, sys, csv, json, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D

now = json.load(open(f"{D}/now.json"))
cands = {r[0]: r for r in csv.reader(open(f"{D}/cands.csv"))}
by = collections.defaultdict(set)
for cid, verdict, fam, reason in csv.reader(open(f"{D}/verdicts.csv")):
    by[(verdict, fam, reason[:60])].add(cid)


def outcome(cid):
    r = cands.get(cid)
    if not r:
        return None
    fdv0 = float(r[7])
    n = now.get(r[1])
    if fdv0 <= 0:
        return None
    if n and n.get("mcap") and (n.get("liq") or 0) >= 5000:
        return n["mcap"] / fdv0
    return 0.0


print(f"{'verdict / family / reason':72}{'coins':>6}{'dead now':>9}{'alive>=2x':>10}{'alive>=5x':>10}{'alive>=10x':>11}")
rows = []
for key, ids in by.items():
    outs = [o for o in (outcome(c) for c in ids) if o is not None]
    if len(outs) < 15:
        continue
    f = lambda m: sum(1 for x in outs if x >= m)
    rows.append((len(outs), key, sum(1 for x in outs if x == 0), f(2), f(5), f(10)))
for n, key, dead, f2, f5, f10 in sorted(rows, reverse=True):
    print(f"{' / '.join(key)[:71]:72}{n:6d}{100 * dead / n:8.0f}%{100 * f2 / n:9.1f}%{100 * f5 / n:8.1f}% ({f5}){100 * f10 / n:8.1f}% ({f10})")

# the single-wallet rule against everything else, with exact two-sided Fisher tests
sw = {c for k, v in by.items() if k[0] == "REJECTED" and k[1] == "other" for c in v}
allc = [c for c in cands if outcome(c) is not None]
A = [c for c in allc if c in sw]
B = [c for c in allc if c not in sw]


def fisher(a, b, c, d):
    n = a + b + c + d
    r1, c1 = a + b, a + c
    p = lambda x: math.comb(r1, x) * math.comb(n - r1, c1 - x) / math.comb(n, c1)
    obs = p(a)
    return sum(p(x) for x in range(max(0, c1 - (n - r1)), min(r1, c1) + 1) if p(x) <= obs + 1e-12)


print("\nSingle-wallet rule (one wallet >= 20% -> REJECTED at the first look) against everything else:")
for m in (2, 5, 10):
    a = sum(1 for c in A if outcome(c) >= m)
    c_ = sum(1 for c in B if outcome(c) >= m)
    print(f"  alive >= {m:2d}x now: {a}/{len(A)} = {100 * a / len(A):.1f}%   others {c_}/{len(B)} = {100 * c_ / len(B):.1f}%   Fisher p = {fisher(a, len(A) - a, c_, len(B) - c_):.3f}")
dead = lambda g: sum(1 for c in g if outcome(c) == 0)
print(f"  dead now:           {dead(A)}/{len(A)} = {100 * dead(A) / len(A):.0f}%   others {dead(B)}/{len(B)} = {100 * dead(B) / len(B):.0f}%   Fisher p = {fisher(dead(A), len(A) - dead(A), dead(B), len(B) - dead(B)):.3f}")

# were the rejected coins followed afterwards? (needs prices_all.csv: observations after the first REJECTED state change)
print("\nObservations after the REJECTED state change are counted in the database with this query:")
print("  with rj as (select candidate_id, min(at) at from decision_state_history where to_state='REJECTED' group by 1)")
print("  select count(*), count(*) filter (where (select count(*) from prices p where p.pool_id=c.pool_id and p.observed_at > rj.at + interval '1 hour') > 0)")
print("  from rj join candidates c on c.id = rj.candidate_id where c.current_state = 'REJECTED';   -- 633 coins, 2 followed more than an hour")
