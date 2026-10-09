"use client";
import { useEffect, useState } from "react";

interface Live {
  online: boolean;
  status: string;
  cycleCount: number;
  lastCycleAt: string | null;
  avgCycleMs: number | null;
  nextPollAt: string | null;
  scannedToday: number;
  alertsToday: number;
  deliveredToday: number;
  queueDepth: number;
  latestAlert: { level: string; symbol_label: string | null; created_at: string } | null;
  telegramMode: string | null;
}

export function LiveBar({ initial }: { initial: Live }) {
  const [live, setLive] = useState<Live>(initial);
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onmessage = (e) => { try { setLive(JSON.parse(e.data)); } catch { /* ignore */ } };
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => es.close();
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      if (!live.nextPollAt) { setCountdown(0); return; }
      const s = Math.round((Date.parse(live.nextPollAt) - Date.now()) / 1000);
      setCountdown(s);
    }, 500);
    return () => clearInterval(iv);
  }, [live.nextPollAt]);

  const cd = live.online ? (countdown > 0 ? `next poll in ${countdown}s` : "scanning…") : "worker offline";
  return (
    <div className="livebar">
      <span className={`livedot ${live.online ? "on" : "off"}`} />
      <span className="lbl-strong">{live.online ? "LIVE" : "OFFLINE"}</span>
      <span className="lb-sep">·</span>
      <span>{cd}</span>
      <span className="lb-sep">·</span>
      <span>cycles {live.cycleCount}{live.avgCycleMs ? ` (~${live.avgCycleMs}ms)` : ""}</span>
      <span className="lb-grow" />
      <span>scanned today <b>{live.scannedToday}</b></span>
      <span className="lb-sep">·</span>
      <span>alerts today <b>{live.alertsToday}</b></span>
      <span className="lb-sep">·</span>
      <span>queue <b>{live.queueDepth}</b></span>
      <span className="lb-sep">·</span>
      <span>telegram <b className={live.telegramMode === "LIVE" ? "tg-on" : "tg-off"}>{live.telegramMode ?? "—"}</b></span>
    </div>
  );
}
