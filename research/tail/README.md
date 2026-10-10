# research/tail

Scripts behind `docs/TAIL_RESEARCH.md` (why the radar misses the big winners). Read-only against the local database; everything is
plain Python 3 (standard library only) and works on CSV exports, so every number in the report can be regenerated.

```bash
./export.sh                  # database -> $TAIL_DATA (default /tmp/pat); needs the aureus_postgres container
python3 fetch_now.py         # today's state of every coin (DexScreener, 30 mints per call)
python3 fetch_jup.py         # Jupiter token facts per coin (optional, static creator/launchpad facts)
python3 glitch.py            # phantom prints and the corrected tail (report section 2)
python3 tail_features.py     # builds coins.pkl (cleaned paths), winners table, listing-time features (sections 3 and 4)
python3 event_study.py       # what the market looks like just before a run (section 4)
python3 entry_state2.py      # price relative to its own high at entry (section 6)
python3 policy_ev.py         # exit policies and how much filter skill breaks even (section 6)
python3 pocket.py            # search for a positive pocket with a time split (section 6)
python3 gate_replay.py       # the shared safety gate replayed on stored snapshots (section 5.1)
python3 rejects_now.py       # what the rejected coins did afterwards (section 5.1)
```

Definitions used everywhere:

- **cleaned path**: the system's own price observations minus *phantom prints* (`common.flag_glitches`): an observation whose liquidity is
  more than 20x the median of the previous 8 and whose price is more than 5x, for as long as it lasts and only if it then falls back.
- **held 30 min** (`common.sustained_peak`): the highest level the price held across at least 3 observations spanning 30 minutes. A
  spike shorter than that cannot be sold into, so it is not counted.
- **ladder + stop** (`policy.run_policy`): 25% sold at 2x, 25% at 5x, 25% at 10x (resting sells fill at their level), the rest with a 40% trailing
  stop once a target has filled, a -50% stop before that, 5% cost on every sale.
- Forward tests start at the moment of the check and look only at what happened afterwards (no lookahead).

Known limits: four weeks of one market, 933 followed coins, 21 winners at 10x. See section 10 of the report.
