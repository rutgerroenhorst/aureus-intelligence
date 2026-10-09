"use client";
import { PageHeader } from "@/components/PremiumUI";

const ForensicsOfflineState = () => (
  <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "var(--bg-base)", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "relative", zIndex: 1, padding: "40px 32px 24px", borderBottom: "1px solid var(--border-color)" }}>
      <PageHeader
        title="Forensics"
        subtitle="Structural verification and evidence investigation."
      />
    </div>

    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 32px", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", maxWidth: "520px" }}>
        <div style={{ fontSize: "40px", opacity: 0.12, marginBottom: "20px" }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--blue-electric)" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
          </svg>
        </div>
        <h2 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "12px" }}>
          Verification data unavailable
        </h2>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "28px" }}>
          Forensic scanner is currently offline. Structural verification and evidence analysis will be available when the backend reconnects.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 600, marginBottom: "32px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#FF546A" }} />
          Backend disconnected
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
          <div style={{ padding: "16px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Structural Verification</div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Unavailable</div>
          </div>
          <div style={{ padding: "16px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Evidence Analysis</div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Unavailable</div>
          </div>
        </div>
      </div>
    </div>

    {/* Background fog effect */}
    <svg style={{ position: "absolute", bottom: "-100px", right: "-100px", opacity: 0.04, width: "600px", height: "600px" }} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="forensicGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--blue-electric)" />
          <stop offset="100%" stopColor="var(--cyan-ice)" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#forensicGrad)" />
    </svg>
  </div>
);

export default function ForensicsPage() {
  return <ForensicsOfflineState />;
}
