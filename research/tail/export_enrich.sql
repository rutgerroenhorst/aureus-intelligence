COPY (
select e.candidate_id cid,
  (e.intel->'onChain'->>'top5Pct')::numeric top5, (e.intel->'onChain'->>'largestHolderPct')::numeric top1,
  (e.intel->'onChain'->>'insiderPct')::numeric insider, (e.intel->'onChain'->>'holderTop10Pct')::numeric top10,
  (e.intel->'onChain'->>'fundingRiskScore')::numeric funding_risk, (e.intel->'onChain'->>'available') onchain_avail,
  (e.intel->'flags'->>'sellable') sellable, (e.intel->'flags'->>'mintAuthorityActive') mint_active, (e.intel->'flags'->>'freezeAuthorityActive') freeze_active,
  (e.intel->'flags'->>'blacklistMatch') blacklist,
  (e.datasets->'rug_risk'->>'value')::numeric rug_value, e.datasets->'rug_risk'->'evidence'->>'verdict' rug_verdict,
  e.datasets->'sellability'->>'classification' sell_class,
  (e.datasets->'sellability'->'evidence'->'quotes'->0->>'priceImpactPct')::numeric imp50,
  (e.datasets->'sellability'->'evidence'->'quotes'->1->>'priceImpactPct')::numeric imp250,
  (e.datasets->'sellability'->'evidence'->'quotes'->2->>'priceImpactPct')::numeric imp500,
  (e.datasets->'sellability'->'evidence'->'quotes'->3->>'priceImpactPct')::numeric imp1000,
  e.datasets->'supply'->>'status' st_supply, e.datasets->'holders'->>'status' st_holders, e.datasets->'authorities'->>'status' st_auth,
  e.datasets->'sellability'->>'status' st_sell, e.datasets->'rug_risk'->>'status' st_rug, e.datasets->'liquidity_drain'->>'status' st_drain,
  e.datasets->'deployer_funding'->>'status' st_depfund, e.datasets->'deployer_identity'->>'status' st_depid,
  e.datasets->'bundle_contamination'->>'status' st_bundle, e.datasets->'wallet_clusters'->>'status' st_cluster,
  e.datasets->'holder_concentration'->>'status' st_holderconc, e.datasets->'insider_concentration'->>'status' st_insider, e.datasets->'deployer_sales'->>'status' st_depsales,
  extract(epoch from e.computed_at)::bigint computed_at
from onchain_enrichment e
) TO '/tmp/enrich_feats.csv' WITH CSV HEADER;
