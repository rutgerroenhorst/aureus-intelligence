import { Pool } from "pg";
import { TelemetryHeader } from "../../../components/TelemetryHeader";

interface WalletDetailPageProps {
  params: Promise<{ address: string }>;
}

export const dynamic = "force-dynamic";

export default async function WalletDetailPage({ params }: WalletDetailPageProps) {
  const { address } = await params;
  const walletAddress = decodeURIComponent(address);

  let wallet: any = null;
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    const result = await pool.query(
      "SELECT id, address, label, role, source_type, source_id FROM wallet_entities WHERE address = $1",
      [walletAddress]
    );
    wallet = result.rows[0] || null;
    await pool.end();
  } catch (err) {
    console.error("Failed to fetch wallet:", err);
  }

  const hasWalletData = wallet !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" }}>
      <TelemetryHeader />

      <div style={{ flex: 1, overflow: "auto" }}>
        <div className="page">
          <div className="page-head">
            <div>
              <h1 className="page-title">Wallet</h1>
              <p className="page-sub" style={{ fontFamily: "monospace", fontSize: "12px" }}>
                {walletAddress}
              </p>
            </div>
          </div>

          {!hasWalletData ? (
            <div style={{
              padding: "64px 24px",
              textAlign: "center",
              color: "var(--muted)"
            }}>
              <div style={{ fontSize: "14px", marginBottom: "12px", fontWeight: 500 }}>
                Wallet not yet tracked
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted-2)", maxWidth: "400px", margin: "0 auto" }}>
                Start tracking this wallet from Wallets page, or it will be added when discovered through Radar/Stream.
              </div>
            </div>
          ) : (
            <>
              <section style={{ padding: "24px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Overview</h2>
              </section>

              <section style={{ padding: "24px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Performance</h2>
              </section>

              <section style={{ padding: "24px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Current Positions</h2>
              </section>

              <section style={{ padding: "24px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Recent Trades</h2>
              </section>

              <section style={{ padding: "24px" }}>
                <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Risk Assessment</h2>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
