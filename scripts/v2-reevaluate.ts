#!/usr/bin/env node
import { Pool } from "pg";
import { evaluateVerificationGates } from "../packages/intelligence-v2/src/revised-gates.js";
import { getIntelligenceV2ConfigHash, INTELLIGENCE_V2_VERSION } from "../packages/intelligence-v2/src/revised-config.js";
import type { VerificationGatesInput } from "../packages/intelligence-v2/src/revised-gates.js";

const main = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const args = process.argv.slice(2);

  if (!args.length) {
    console.error("Usage:");
    console.error("  --candidate <id>            Re-evaluate one candidate");
    console.error("  --affected-version <v>      Re-evaluate all affected by old evaluator version");
    console.error("  --all-current               Re-evaluate ALL 1,284 candidates (stored data only)");
    process.exit(1);
  }

  try {
    if (args[0] === "--candidate") {
      const candidateId = args[1];
      if (!candidateId) {
        console.error("Missing candidate ID");
        process.exit(1);
      }

      console.log(`Re-evaluating candidate: ${candidateId}\n`);

      const result = await pool.query(
        `SELECT intel, datasets FROM onchain_enrichment WHERE candidate_id = $1`,
        [candidateId]
      );

      if (!result.rows[0]) {
        console.log(`❌ ${candidateId}: NO ENRICHMENT`);
        await pool.end();
        return;
      }

      const { intel, datasets } = result.rows[0];

      const features = new Map();
      if (datasets?.deployer_identity?.evidence?.exposure != null) {
        const deployerExposure = Number(datasets.deployer_identity.evidence.exposure);
        features.set("deployerDirectHoldingPct", {
          status: "OK",
          value: String(deployerExposure),
        });
      }

      const topHolders = intel.onChain?.holderTop10Pct != null ? [
        { wallet: "top-10-aggregate", pct: intel.onChain.holderTop10Pct },
      ] : undefined;

      const deployerAddress = datasets?.deployer_identity?.evidence?.creator;

      const v2Input: VerificationGatesInput = {
        features,
        mint: {
          freezeAuthority: intel.flags?.freezeAuthorityActive != null ? {
            address: "unknown",
            isMutable: intel.flags.freezeAuthorityActive,
          } : undefined,
        },
        topHolders,
        deployer: deployerAddress ? { address: deployerAddress } : undefined,
        createdAt: 0,
        knownRugs: [],
      };

      const verdict = evaluateVerificationGates(v2Input);
      const configHash = getIntelligenceV2ConfigHash();

      await pool.query(
        `
        INSERT INTO intelligence_v2_scores
        (candidate_id, score_version, config_hash, v2_status, v2_confidence, result_json, computed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          candidateId,
          INTELLIGENCE_V2_VERSION,
          configHash,
          verdict.status,
          verdict.confidence,
          JSON.stringify(verdict),
          new Date(),
        ]
      );

      const statusLabel =
        verdict.status === "STRUCTURALLY_QUALIFIED" ? "✓ Qualified"
        : verdict.status === "INSUFFICIENT_DATA" ? "? More Data Required"
        : "✗ Rejected";

      console.log(`✓ ${candidateId}: ${statusLabel} (confidence ${verdict.confidence}%)`);

    } else if (args[0] === "--affected-version") {
      const oldVersion = args[1];
      if (!oldVersion) {
        console.error("Missing version");
        process.exit(1);
      }
      console.log(`Re-evaluating all candidates affected by version: ${oldVersion}\n`);

      const result = await pool.query(
        `SELECT DISTINCT candidate_id FROM intelligence_v2_scores WHERE score_version = $1 ORDER BY candidate_id`,
        [oldVersion]
      );

      const candidateIds = result.rows.map((r: any) => r.candidate_id);
      console.log(`Found ${candidateIds.length} candidates to re-evaluate\n`);

      let reCount = 0;
      for (const candidateId of candidateIds) {
        const enrResult = await pool.query(
          `SELECT intel, datasets FROM onchain_enrichment WHERE candidate_id = $1`,
          [candidateId]
        );

        if (!enrResult.rows[0]) {
          continue;
        }

        const { intel, datasets } = enrResult.rows[0];

        const features = new Map();
        if (datasets?.deployer_identity?.evidence?.exposure != null) {
          const deployerExposure = Number(datasets.deployer_identity.evidence.exposure);
          features.set("deployerDirectHoldingPct", {
            status: "OK",
            value: String(deployerExposure),
          });
        }

        const topHolders = intel.onChain?.holderTop10Pct != null ? [
          { wallet: "top-10-aggregate", pct: intel.onChain.holderTop10Pct },
        ] : undefined;

        const deployerAddress = datasets?.deployer_identity?.evidence?.creator;

        const v2Input: VerificationGatesInput = {
          features,
          mint: {
            freezeAuthority: intel.flags?.freezeAuthorityActive != null ? {
              address: "unknown",
              isMutable: intel.flags.freezeAuthorityActive,
            } : undefined,
          },
          topHolders,
          deployer: deployerAddress ? { address: deployerAddress } : undefined,
          createdAt: 0,
          knownRugs: [],
        };

        const verdict = evaluateVerificationGates(v2Input);
        const configHash = getIntelligenceV2ConfigHash();

        await pool.query(
          `INSERT INTO intelligence_v2_scores
           (candidate_id, score_version, config_hash, v2_status, v2_confidence, result_json, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            candidateId,
            INTELLIGENCE_V2_VERSION,
            configHash,
            verdict.status,
            verdict.confidence,
            JSON.stringify(verdict),
            new Date(),
          ]
        );
        reCount++;

        if (reCount % 50 === 0) {
          console.log(`... ${reCount} candidates re-evaluated ...`);
        }
      }

      console.log(`\n✓ Re-evaluated ${reCount}/${candidateIds.length} candidates`);

    } else if (args[0] === "--all-current") {
      console.log(`Re-evaluating ALL current candidates (stored data only)\n`);
      console.log(`Using version: ${INTELLIGENCE_V2_VERSION}\n`);

      const result = await pool.query(`SELECT COUNT(*) as total FROM onchain_enrichment`);
      const total = result.rows[0].total;
      console.log(`Total candidates: ${total}\n`);

      const candidatesResult = await pool.query(`SELECT candidate_id FROM onchain_enrichment ORDER BY candidate_id`);
      const candidateIds = candidatesResult.rows.map((r: any) => r.candidate_id);

      let evaluated = 0;
      let skipped = 0;
      const startTime = Date.now();

      for (const candidateId of candidateIds) {
        const enrResult = await pool.query(
          `SELECT intel, datasets FROM onchain_enrichment WHERE candidate_id = $1`,
          [candidateId]
        );

        if (!enrResult.rows[0]) {
          skipped++;
          continue;
        }

        const { intel, datasets } = enrResult.rows[0];

        const features = new Map();
        if (datasets?.deployer_identity?.evidence?.exposure != null) {
          const deployerExposure = Number(datasets.deployer_identity.evidence.exposure);
          features.set("deployerDirectHoldingPct", {
            status: "OK",
            value: String(deployerExposure),
          });
        }

        const topHolders = intel.onChain?.holderTop10Pct != null ? [
          { wallet: "top-10-aggregate", pct: intel.onChain.holderTop10Pct },
        ] : undefined;

        const deployerAddress = datasets?.deployer_identity?.evidence?.creator;

        const v2Input: VerificationGatesInput = {
          features,
          mint: {
            freezeAuthority: intel.flags?.freezeAuthorityActive != null ? {
              address: "unknown",
              isMutable: intel.flags.freezeAuthorityActive,
            } : undefined,
          },
          topHolders,
          deployer: deployerAddress ? { address: deployerAddress } : undefined,
          createdAt: 0,
          knownRugs: [],
        };

        const verdict = evaluateVerificationGates(v2Input);
        const configHash = getIntelligenceV2ConfigHash();

        await pool.query(
          `INSERT INTO intelligence_v2_scores
           (candidate_id, score_version, config_hash, v2_status, v2_confidence, result_json, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            candidateId,
            INTELLIGENCE_V2_VERSION,
            configHash,
            verdict.status,
            verdict.confidence,
            JSON.stringify(verdict),
            new Date(),
          ]
        );
        evaluated++;

        if (evaluated % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = (evaluated / elapsed).toFixed(1);
          console.log(`... ${evaluated}/${total} (${rate} eval/s) ...`);
        }
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✓ Evaluated ${evaluated}/${total} candidates in ${totalTime}s`);
      console.log(`Skipped: ${skipped}`);

    } else {
      console.error(`Unknown option: ${args[0]}`);
      process.exit(1);
    }

    await pool.end();
  } catch (err: any) {
    console.error("Error:", err.message);
    await pool.end();
    process.exit(1);
  }
};

main();
