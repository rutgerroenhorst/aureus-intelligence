import { brand } from "@/lib/brand";
import { safeNext } from "@/lib/auth/policy";

/** The login page (docs/ACCESS.md): public by necessity, so it says nothing about what is behind it. */
export const metadata = { title: "Toegang", description: null, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { e?: string; next?: string } }) {
  const next = safeNext(searchParams.next);
  const message = searchParams.e === "2" ? "Te vaak geprobeerd. Probeer het over een kwartier opnieuw." : searchParams.e === "1" ? "Onjuiste code." : null;
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: brand.bg, color: brand.fg, boxSizing: "border-box" }}>
      <form method="post" action="/api/auth/login" style={{ width: "100%", maxWidth: 340 }}>
        <input type="hidden" name="next" value={next} />
        {/* a fixed name so a password manager can save the code under it */}
        <input type="text" name="username" value="owner" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }} />
        <label htmlFor="code" style={{ display: "block", fontSize: 13, color: "#8a8a8e", marginBottom: 8 }}>
          Toegangscode
        </label>
        <input
          id="code"
          name="code"
          type="password"
          autoComplete="current-password"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          style={{ width: "100%", height: 46, padding: "0 12px", boxSizing: "border-box", background: "#141418", color: brand.fg, border: "1px solid #2a2a2f", borderRadius: 8, fontSize: 16 }}
        />
        <button type="submit" style={{ width: "100%", height: 46, marginTop: 12, background: brand.blue, color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Open
        </button>
        {message && (
          <div role="alert" style={{ marginTop: 14, fontSize: 13, color: "#e5c07b" }}>
            {message}
          </div>
        )}
      </form>
    </main>
  );
}
