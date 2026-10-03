export const metadata = {
  title: "Aureus Intelligence",
  description: "Solana Trading Radar",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#0a0908", color: "#fff", fontFamily: "sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
