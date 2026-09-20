import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://aureus:aureus@localhost:5432/aureus",
});

const tokenMint = "C5tGuxaPnbxHHP6RTpAQs34x8TN8A9ZfJxcfizd2WF3u";
const creator = "H9bTL6R4rrbsEbsaoKPM4PKqvFkdHucQLwSRFFWSviEa";
const creationSig = "XxE1YDD1NNDWmS83jviK3NL1TQW3Q2gg79oR6pXB3F9";

console.log("\n=== Wallet Validation ===");

// 1. Validate Solana base58 (44 chars)
const isValidBase58 = creator.length === 44 && /^[1-9A-HJ-NP-Z]+$/.test(creator);
console.log(`✓ Valid Solana base58: ${isValidBase58}`);

// 2. Creator !== mint
console.log(`✓ Creator != Mint: ${creator !== tokenMint}`);

// 3. Not a known program
console.log(`✓ Not TokenProgram: ${creator !== "TokenkegQfeZyiNwAJsyFbPVwwQQfg5bgLjGstSHqf1o"}`);

console.log("\n=== Tracking Creator Wallet ===");

// Check if already tracked
const existing = await pool.query(
  "SELECT id, role, source_type FROM wallet_entities WHERE address = $1",
  [creator]
);

if (existing.rows.length > 0) {
  const row = existing.rows[0];
  console.log(`⚠ Already tracked`);
  console.log(`  ID: ${row.id}`);
  console.log(`  Role: ${row.role || "N/A"}`);
  console.log(`  Source: ${row.source_type || "N/A"}`);
} else {
  console.log("New wallet - inserting...");
  
  // Insert with provenance
  const insertRes = await pool.query(`
    INSERT INTO wallet_entities (
      chain,
      address,
      label,
      role,
      source_type,
      source_id,
      source_token_mint,
      observed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, address, role, source_type, observed_at
  `, [
    'solana',      // chain
    creator,       // address
    'Stocklana Creator',  // label
    'CREATOR',     // role
    'enrichment',  // source_type (came from Helius enrichment)
    creationSig,   // source_id (creation transaction sig)
    tokenMint,     // source_token_mint
    new Date().toISOString()  // observed_at
  ]);

  if (insertRes.rows.length > 0) {
    const wallet = insertRes.rows[0];
    console.log(`✓ Wallet tracked: ${wallet.id}`);
    console.log(`  Address: ${wallet.address}`);
    console.log(`  Role: ${wallet.role}`);
    console.log(`  Source: ${wallet.source_type} (${creationSig.slice(0, 20)}...)`);
    console.log(`  Observed: ${wallet.observed_at}`);
  }
}

// Verify final state
const finalCheck = await pool.query(
  "SELECT id, address, role, source_type, source_token_mint FROM wallet_entities WHERE address = $1",
  [creator]
);

console.log("\n=== Final State ===");
if (finalCheck.rows.length > 0) {
  const w = finalCheck.rows[0];
  console.log("✓ Wallet in database");
  console.log(`  ID: ${w.id}`);
  console.log(`  Address: ${w.address}`);
  console.log(`  Role: ${w.role}`);
  console.log(`  Source: ${w.source_type}`);
  console.log(`  Context: ${w.source_token_mint}`);
} else {
  console.log("✗ Wallet NOT found");
}

await pool.end();
