#!/usr/bin/env bash
# Exports everything the tail research needs from the local Aureus database into $TAIL_DATA (default /tmp/pat).
# Read-only: only SELECTs. Needs the aureus_postgres container; set PSQL to use another connection.
set -euo pipefail
DATA="${TAIL_DATA:-/tmp/pat}"
PSQL="${PSQL:-docker exec -i aureus_postgres psql -U aureus -d aureus}"
mkdir -p "$DATA"

q() { # name, sql
  echo "export $1"
  $PSQL -q -c "COPY ($2) TO STDOUT WITH CSV" > "$DATA/$1"
}

# complete price history of every tracked coin: candidate, epoch, price, market cap, fdv
q prices_all.csv "select c.id, extract(epoch from p.observed_at)::bigint, p.price_usd, p.market_cap_usd, p.fdv_usd
                  from candidates c join prices p on p.pool_id = c.pool_id where p.price_usd is not null order by c.id, p.observed_at"
# liquidity history
q liq.csv "select c.id, extract(epoch from l.observed_at)::bigint, l.liquidity_usd
           from candidates c join liquidity_snapshots l on l.pool_id = c.pool_id where l.liquidity_usd is not null order by c.id, l.observed_at"
# candidate -> pool address, mint
q pools.csv "select c.id, p.pool_address, t.mint from candidates c join pools p on p.id = c.pool_id join tokens t on t.id = c.token_id"
# candidate, mint, current state, furthest state, last observation, observation count, discovery time, discovery fdv
q cands.csv "select c.id, t.mint, c.current_state, coalesce(r.reached_state::text,''), coalesce(extract(epoch from r.last_observed_at)::bigint,0),
                    coalesce(r.observations,0), extract(epoch from c.discovered_at)::bigint, coalesce(r.discovery_fdv_usd,0)
             from candidates c join tokens t on t.id = c.token_id left join candidate_research r on r.candidate_id = c.id"
# every verdict of the decision engine (the reason text has the percentages blanked so identical rules group together)
q verdicts.csv "select v.candidate_id, v.verdict, v.reason_family, regexp_replace(coalesce(v.verdict_reason,''), '[0-9]+%', 'N%', 'g') from candidate_verdicts v"
# first time each candidate entered a state
q state_first.csv "select candidate_id, to_state, extract(epoch from min(at))::bigint, count(*) from decision_state_history
                   where to_state in ('STRUCTURE_WATCH','QUALITY_CONFIRMED','REJECTED','EXPIRED') group by 1,2"
# per-observation DexScreener features (volume, txns, price change, liquidity) for every coin followed for >= 5 observations
q all_obs.csv "select o.candidate_id, extract(epoch from o.observed_at)::bigint,
       (re.payload->'volume'->>'m5')::numeric, (re.payload->'volume'->>'h1')::numeric, (re.payload->'volume'->>'h6')::numeric,
       (re.payload->'txns'->'m5'->>'buys')::int, (re.payload->'txns'->'m5'->>'sells')::int,
       (re.payload->'txns'->'h1'->>'buys')::int, (re.payload->'txns'->'h1'->>'sells')::int,
       (re.payload->'txns'->'h6'->>'buys')::int, (re.payload->'txns'->'h6'->>'sells')::int,
       (re.payload->'priceChange'->>'m5')::numeric, (re.payload->'priceChange'->>'h1')::numeric, (re.payload->'priceChange'->>'h6')::numeric,
       (re.payload->>'priceUsd')::numeric, (re.payload->'liquidity'->>'usd')::numeric, coalesce((re.payload->'boosts'->>'active')::int,0)
       from observations o join raw_events re on re.id = o.raw_event_id
       where o.kind = 'market_snapshot' and o.candidate_id in (select candidate_id from candidate_research where observations >= 5)
       order by o.candidate_id, o.observed_at"
# all_obs.csv has no header; pocket.py and event_study.py expect one:
{ echo "cid,ts,v_m5,v_h1,v_h6,b_m5,s_m5,b_h1,s_h1,b_h6,s_h6,pc_m5,pc_h1,pc_h6,price,liq,boosts"; cat "$DATA/all_obs.csv"; } > "$DATA/all_obs.tmp" && mv "$DATA/all_obs.tmp" "$DATA/all_obs.csv"

# snapshot features at listing and 1/3/6/12/24/48/72 h later, and the on-chain enrichment (SQL files; they write with COPY ... TO)
for f in export_payloads.sql export_enrich.sql; do
  echo "export $f"
  docker cp "$(dirname "$0")/$f" aureus_postgres:/tmp/$f
  docker exec aureus_postgres psql -U aureus -d aureus -q -f /tmp/$f
done
docker cp aureus_postgres:/tmp/payload_feats.csv "$DATA/payload_feats.csv"
docker cp aureus_postgres:/tmp/enrich_feats.csv "$DATA/enrich_feats.csv"
echo "done -> $DATA   (next: python3 fetch_now.py; python3 fetch_jup.py; python3 tail_features.py)"
