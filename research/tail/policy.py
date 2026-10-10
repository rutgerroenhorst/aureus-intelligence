"""Exit policies evaluated on cleaned price paths (see common.py). All results are multiples of the stake, net of cost."""

COST = 0.05                 # 5% on every sale: fees, slippage, failed fills
HORIZON = 7 * 86400


def run_policy(path, delay=0, stop=0.5, ladder=((2.0, .25), (5.0, .25), (10.0, .25)), trail=0.4, horizon=HORIZON):
    """path = [(t, price)]. Enter at the first observation >= t0 + delay.

    Resting sells at the ladder levels fill AT their level; the stop (and the trailing stop once a target has filled)
    sells at the price actually observed, which is optimistic for rugs that fall between two observations."""
    t0 = path[0][0]
    k = next((i for i, (t, p) in enumerate(path) if t >= t0 + delay), None)
    if k is None:
        return None
    tk, pk = path[k]
    rem, proceeds, peak, armed = 1.0, 0.0, pk, False
    filled = [False] * len(ladder)
    last_p = pk
    for t, p in path[k + 1:]:
        if t - tk > horizon:
            break
        last_p = p
        m = p / pk
        peak = max(peak, p)
        for i, (tm, fr) in enumerate(ladder):
            if not filled[i] and rem > 1e-9 and m >= tm:
                take = min(fr, rem)
                proceeds += take * tm
                rem -= take
                filled[i] = True
                armed = True
        if rem > 1e-9:
            if armed and p <= peak * (1 - trail):
                proceeds += rem * m
                rem = 0
                break
            if (not armed) and m <= stop:
                proceeds += rem * m
                rem = 0
                break
        if rem <= 1e-9:
            break
    if rem > 1e-9:
        proceeds += rem * (last_p / pk)
    return proceeds * (1 - COST)


def hold(path, delay=0, horizon=HORIZON):
    t0 = path[0][0]
    k = next((i for i, (t, p) in enumerate(path) if t >= t0 + delay), None)
    if k is None:
        return None
    tk, pk = path[k]
    last = pk
    for t, p in path[k + 1:]:
        if t - tk > horizon:
            break
        last = p
    return last / pk * (1 - COST)
