COPY (
with first_obs as (
  select c.id cid, min(o.observed_at) t0
  from candidates c join observations o on o.candidate_id = c.id and o.kind = 'market_snapshot'
  group by c.id
), taus(tau_h) as (values (0),(1),(3),(6),(12),(24),(48),(72))
select f.cid, t.tau_h, extract(epoch from x.observed_at)::bigint ts,
       x.p->>'dexId' dex, x.p->'quoteToken'->>'symbol' quote_sym,
       (x.p->'info') is not null has_info,
       coalesce(jsonb_array_length(x.p->'info'->'websites'),0) n_web,
       coalesce(jsonb_array_length(x.p->'info'->'socials'),0) n_soc,
       (select string_agg(s->>'type', '+' order by s->>'type') from jsonb_array_elements(coalesce(x.p->'info'->'socials','[]'::jsonb)) s) soc_types,
       (x.p->'info'->>'header') is not null has_header,
       (x.p->'info'->>'imageUrl') is not null has_image,
       coalesce((x.p->'boosts'->>'active')::int,0) boosts,
       (x.p->'priceChange'->>'m5')::numeric pc_m5, (x.p->'priceChange'->>'h1')::numeric pc_h1, (x.p->'priceChange'->>'h6')::numeric pc_h6, (x.p->'priceChange'->>'h24')::numeric pc_h24,
       (x.p->'volume'->>'m5')::numeric v_m5, (x.p->'volume'->>'h1')::numeric v_h1, (x.p->'volume'->>'h6')::numeric v_h6, (x.p->'volume'->>'h24')::numeric v_h24,
       (x.p->'txns'->'m5'->>'buys')::int b_m5, (x.p->'txns'->'m5'->>'sells')::int s_m5,
       (x.p->'txns'->'h1'->>'buys')::int b_h1, (x.p->'txns'->'h1'->>'sells')::int s_h1,
       (x.p->'txns'->'h6'->>'buys')::int b_h6, (x.p->'txns'->'h6'->>'sells')::int s_h6,
       (x.p->'txns'->'h24'->>'buys')::int b_h24, (x.p->'txns'->'h24'->>'sells')::int s_h24,
       (x.p->'liquidity'->>'usd')::numeric liq, (x.p->'liquidity'->>'base')::numeric liq_base, (x.p->'liquidity'->>'quote')::numeric liq_quote,
       (x.p->>'marketCap')::numeric mcap, (x.p->>'fdv')::numeric fdv, (x.p->>'priceUsd')::numeric price, (x.p->>'priceNative')::numeric price_native,
       (x.p->>'pairCreatedAt')::bigint created_ms
from first_obs f cross join taus t
join lateral (
  select o.observed_at, re.payload p
  from observations o join raw_events re on re.id = o.raw_event_id
  where o.candidate_id = f.cid and o.kind = 'market_snapshot'
    and o.observed_at between f.t0 + make_interval(secs => greatest(t.tau_h*3600*0.8, 0)) and f.t0 + make_interval(secs => t.tau_h*3600*1.2 + 1200)
  order by abs(extract(epoch from (o.observed_at - (f.t0 + make_interval(secs => t.tau_h*3600)))))
  limit 1
) x on true
) TO '/tmp/payload_feats.csv' WITH CSV HEADER;
