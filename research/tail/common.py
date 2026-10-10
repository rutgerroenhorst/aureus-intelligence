"""Shared loaders for the tail research: cleaned price paths, targets, feature tables."""
import csv, collections, bisect, statistics as st, datetime, math, random, subprocess, json

UTC = datetime.timezone.utc
fmt = lambda t: datetime.datetime.fromtimestamp(t, UTC).strftime("%m-%d %H:%M")
D = "/tmp/pat"


def load_paths():
    paths = collections.defaultdict(list)
    for cid, ts, price, mcap, fdv in csv.reader(open(f"{D}/prices_all.csv")):
        paths[cid].append((int(ts), float(price), float(mcap) if mcap else None))
    for v in paths.values():
        v.sort()
    return paths


def load_liq():
    liq = collections.defaultdict(list)
    for cid, ts, l in csv.reader(open(f"{D}/liq.csv")):
        liq[cid].append((int(ts), float(l)))
    for v in liq.values():
        v.sort()
    return liq


def names():
    out = subprocess.run(["docker", "exec", "aureus_postgres", "psql", "-U", "aureus", "-d", "aureus", "-At", "-F", "|", "-c",
                          "select c.id, coalesce(t.symbol_label,'?') from candidates c join tokens t on t.id=c.token_id"], capture_output=True, text=True).stdout
    d = {}
    for line in out.splitlines():
        a, b = line.split("|", 1)
        d[a] = b
    return d


def liq_at_factory(liq):
    cache = {}

    def f(cid, t):
        ls = liq.get(cid)
        if not ls:
            return None
        if cid not in cache:
            cache[cid] = [x for x, _ in ls]
        i = bisect.bisect_right(cache[cid], t) - 1
        return ls[i][1] if i >= 0 else None
    return f


def flag_glitches(pth, lq):
    """Phantom prints: liquidity AND price jump far above the coin's own recent history for a few scans, then return."""
    n = len(pth)
    flagged = [False] * n
    i = 0
    while i < n:
        base = [x for x in lq[max(0, i - 8):i] if x]
        if len(base) >= 3 and lq[i] and lq[i] > 20 * st.median(base) and pth[i][1] > 5 * st.median([p for _, p, _ in pth[max(0, i - 8):i]]):
            j = i
            while j < n and lq[j] and lq[j] > 10 * st.median(base):
                j += 1
            after = [x for x in lq[j:j + 8] if x]
            if j < n and len(after) >= 1 and st.median(after) < 3 * st.median(base):
                for k in range(i, j):
                    flagged[k] = True
                i = j
                continue
        i += 1
    return flagged


def sustained_peak(pth, window=1800, min_obs=3, upto=None):
    """Highest level the price held for `window` seconds (at least min_obs observations inside the window)."""
    n = len(pth)
    best, best_t = 0.0, None
    for i in range(n):
        if upto is not None and pth[i][0] > upto:
            break
        k = i
        while k + 1 < n and pth[k + 1][0] - pth[i][0] <= window:
            k += 1
        if k - i + 1 >= min_obs:
            lvl = min(p for _, p in pth[i:k + 1])
            if lvl > best:
                best, best_t = lvl, pth[i][0]
    return best, best_t


def first_cross(pth, level, sustain=1800):
    """First time the price is at/above `level` and stays >= level*0.8 for the next `sustain` seconds."""
    n = len(pth)
    for i in range(n):
        if pth[i][1] >= level:
            k = i
            ok = True
            while k + 1 < n and pth[k + 1][0] - pth[i][0] <= sustain:
                k += 1
                if pth[k][1] < level * 0.8:
                    ok = False
                    break
            if ok and (k > i or pth[-1][0] - pth[i][0] < sustain):
                return pth[i][0]
    return None


def build_coins(min_obs=5):
    paths = load_paths()
    liq = load_liq()
    lqf = liq_at_factory(liq)
    nm = names()
    coins = {}
    for cid, pth in paths.items():
        if len(pth) < min_obs:
            continue
        lq = [lqf(cid, t) for t, _, _ in pth]
        fl = flag_glitches(pth, lq)
        clean = [(t, p, m) for (t, p, m), f in zip(pth, fl) if not f]
        lqc = [x for x, f in zip(lq, fl) if not f]
        p0 = clean[0][1]
        t0 = clean[0][0]
        pk, pkt = sustained_peak([(t, p) for t, p, _ in clean])
        coins[cid] = dict(cid=cid, name=nm.get(cid, "?"), t0=t0, p0=p0, path=clean, liq=lqc, n=len(clean), phantom=sum(fl),
                          sust=pk / p0, sust_t=pkt, raw_peak=max(p for _, p, _ in pth) / p0,
                          life_h=(clean[-1][0] - t0) / 3600)
    return coins


def auc_perm(pos, neg, n_perm=4000, rng=None):
    """Mann-Whitney AUC and a two-sided permutation p-value."""
    if len(pos) < 3 or len(neg) < 3:
        return None, None
    rng = rng or random.Random(1)
    allv = [(v, 1) for v in pos] + [(v, 0) for v in neg]
    allv.sort(key=lambda x: x[0])
    # average ranks
    ranks = [0.0] * len(allv)
    i = 0
    while i < len(allv):
        j = i
        while j < len(allv) and allv[j][0] == allv[i][0]:
            j += 1
        for k in range(i, j):
            ranks[k] = (i + j + 1) / 2
        i = j
    labels = [l for _, l in allv]
    npos = len(pos)
    u = sum(r for r, l in zip(ranks, labels) if l == 1) - npos * (npos + 1) / 2
    auc = u / (npos * len(neg))
    obs = abs(auc - 0.5)
    cnt = 0
    idx = list(range(len(allv)))
    for _ in range(n_perm):
        pick = rng.sample(idx, npos)
        up = sum(ranks[k] for k in pick) - npos * (npos + 1) / 2
        if abs(up / (npos * len(neg)) - 0.5) >= obs:
            cnt += 1
    return auc, (cnt + 1) / (n_perm + 1)
