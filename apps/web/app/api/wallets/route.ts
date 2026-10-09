import { getPool, closePool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  
  try {
    const result = await pool.query(
      "SELECT id, address, label, first_seen_at FROM wallet_entities ORDER BY first_seen_at DESC LIMIT 100;"
    );
    
    return Response.json({
      wallets: result.rows.map(row => ({
        id: row.id,
        address: row.address,
        label: row.label || "Unnamed Wallet",
        firstSeen: row.first_seen_at,
      })),
    });
  } catch (err) {
    console.error("Error fetching wallets:", err);
    return Response.json({ wallets: [], error: (err as Error).message }, { status: 500 });
  } finally {
    await closePool();
  }
}
