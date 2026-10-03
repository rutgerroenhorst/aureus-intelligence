import React, { ReactNode } from "react";

interface ElitePageWrapperProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

export default function ElitePageWrapper({ children, title, subtitle }: ElitePageWrapperProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "#0a0908",
    }}>
      {/* HEADER */}
      {(title || subtitle) && (
        <div style={{
          padding: "28px 32px 24px 32px",
          borderBottom: "1px solid #1a1a1f",
          background: "linear-gradient(180deg, rgba(15, 17, 22, 0.5) 0%, transparent 100%)",
        }}>
          {title && (
            <h1 style={{
              margin: "0 0 8px 0",
              fontSize: "28px",
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.5px",
            }}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p style={{
              margin: 0,
              fontSize: "13px",
              color: "#8a8a8e",
              fontWeight: 400,
            }}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* CONTENT */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        padding: "28px 32px",
      }}>
        {children}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
