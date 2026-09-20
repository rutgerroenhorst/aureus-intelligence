/**
 * DEVELOPMENT ONLY: Enqueue an existing candidate for reprocessing
 * to measure complete T0→T6 pipeline latency.
 * 
 * Runs ONLY in development mode.
 * Uses normal worker queue (does NOT bypass enrichment/V2/persistence).
 * Disabled in production.
 */

import { getPool, closePool } from "@aureus/db";

if (process.env.NODE_ENV === "production") {
  console.error("Trace-candidate is disabled in production");
  process.exit(1);
}

async function traceCandidate() {
  const pool = getPool();
  
  try {
    // Get first candidate
    const result = await pool.query(
      "SELECT id FROM candidates ORDER BY created_at DESC LIMIT 1;"
    );
    
    if (result.rows.length === 0) {
      console.log("No candidates in database");
      process.exit(0);
    }
    
    const candidateId = result.rows[0].id;
    console.log(`Enqueuing candidate for trace: ${candidateId}`);
    console.log("Starting worker with TRACE_PIPELINE=true to capture T0→T6");
    
  } finally {
    await closePool();
  }
}

traceCandidate();
