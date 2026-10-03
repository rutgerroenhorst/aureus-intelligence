"use client";
import { useEffect, useState } from "react";

/**
 * Honest failure page.
 *
 * Every unknown in this system is labelled with a reason rather than guessed at —
 * except, until now, the one the user actually hits: when Postgres is unreachable
 * the whole site returned a raw Next.js 500. "Site doesn't work" is exactly as much
 * as that told you. A dead datastore is a KNOWN, diagnosable state and should read
 * like the rest of the product.
 *
 * Detection is by PROBING /api/health, not by matching the error message: Next
 * sanitizes server errors before they reach the client ("An error occurred in the
 * Server Components render but no message was provided"), so the ECONNREFUSED text
 * never survives the boundary. The probe is also what lets a recovered database
 * reload the page on its own.
 */
type Cause = "checking" | "db-down" | "other";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [cause, setCause] = useState<Cause>("checking");
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    let alive = true;
    // The boundary remounts on every reset, so "have we already triggered recovery"
    // has to live outside React state or the recovery fires again on the new mount.
    const KEY = "aureus:db-recovery-armed";
    const probe = async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { db?: boolean } | null;
        return res.ok && body?.db === true;
      } catch {
        return false; // the app itself is unreachable — treat as infrastructure down
      }
    };

    let iv: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const healthy = await probe();
      if (!alive) return;
      if (healthy) {
        // Healthy database + a failed render means the fault is in the PAGE, not the
        // infrastructure — do not blame Postgres for a bug. If we got here because the
        // database just came back, reload once (see below) instead of looping.
        if (sessionStorage.getItem(KEY) === "1") {
          sessionStorage.removeItem(KEY);
          setRecovered(true);
          window.location.reload();
          return;
        }
        setCause("other");
        return;
      }
      setCause("db-down");
      sessionStorage.setItem(KEY, "1"); // we are down; a later recovery may reload
      iv = setInterval(async () => {
        if (!(await probe()) || !alive) return;
        clearInterval(iv);
        setRecovered(true);
        sessionStorage.removeItem(KEY);
        // A hard reload, NOT reset(): reset() re-renders the boundary's children but
        // does not reliably re-run the server component that failed, so it remounts,
        // fails again, and the retry loop hammers /api/health forever.
        window.location.reload();
      }, 5_000);
    })();

    return () => { alive = false; if (iv) clearInterval(iv); };
  }, []);

  if (cause === "checking") {
    return (
      <div className="errpage">
        <div className="err-kicker">CHECKING</div>
        <h1 className="err-h">Working out what failed…</h1>
        <p className="err-p dim">Probing the database before blaming it.</p>
      </div>
    );
  }

  const dbDown = cause === "db-down";
  return (
    <div className="errpage">
      <div className="err-kicker">{dbDown ? "DATASTORE UNREACHABLE" : "PAGE RENDER FAILED"}</div>
      <h1 className="err-h">
        {dbDown ? "Aureus cannot reach its database" : "This page failed to render"}
      </h1>

      {dbDown ? (
        <>
          <p className="err-p">
            The scanner writes to Postgres and every surface reads from it. Nothing is lost —
            the container is simply not running, which usually happens after the machine
            sleeps and Docker Desktop stops.
          </p>
          <p className="err-p dim">
            No market data is shown rather than stale data: a cached board would be
            indistinguishable from a live one.
          </p>
          <div className="err-fix">
            <div className="err-fix-h">Start it</div>
            <pre>docker compose up -d</pre>
            <div className="err-fix-n">
              The containers use <code>restart: unless-stopped</code>, so this recovers on its
              own once Docker Desktop is running.
            </div>
          </div>
          <p className="err-p dim">
            {recovered
              ? "Database answered — reloading…"
              : "Checking every 5s; this page reloads itself when the database is back."}
          </p>
        </>
      ) : (
        <>
          <p className="err-p">
            The database is reachable, so this is a fault in the page itself rather than the
            infrastructure.
          </p>
          {error.digest ? <p className="err-p dim mono">digest {error.digest}</p> : null}
          <p className="err-p dim">Server logs hold the stack trace; it is withheld from the browser.</p>
        </>
      )}

      <button className="btn primary" onClick={() => reset()}>Retry now</button>
    </div>
  );
}
