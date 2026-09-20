import { workerStatus, liveCounts } from "../../../lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE stream of worker status + live counts, pushed every 3s. */
export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let iv: ReturnType<typeof setInterval> | null = null;
  let stop: ReturnType<typeof setTimeout> | null = null;
  // Clear BOTH timers on teardown — the previous version left them running on
  // cancel(), so the 10-min stop-timeout later called close() on an already
  // cancelled controller → uncaught ERR_INVALID_STATE.
  const cleanup = () => {
    closed = true;
    if (iv) { clearInterval(iv); iv = null; }
    if (stop) { clearTimeout(stop); stop = null; }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const safeClose = () => { try { controller.close(); } catch { /* already closed */ } };
      const send = async () => {
        if (closed) return;
        try {
          const [ws, counts] = await Promise.all([workerStatus(), liveCounts()]);
          const lastCycleAt = ws?.last_cycle_at ? Date.parse(ws.last_cycle_at) : null;
          const tickMs = Number((ws?.detail as { tickMs?: number })?.tickMs ?? 10000);
          const online = lastCycleAt != null && Date.now() - lastCycleAt < Math.max(tickMs * 3, 90_000);
          const payload = {
            online,
            status: ws?.status ?? "UNKNOWN",
            cycleCount: ws?.cycle_count ?? 0,
            lastCycleAt: ws?.last_cycle_at ?? null,
            lastCycleMs: ws?.last_cycle_ms ?? null,
            avgCycleMs: ws?.avg_cycle_ms ?? null,
            nextPollAt: lastCycleAt != null ? new Date(lastCycleAt + tickMs).toISOString() : null,
            ...counts,
            ts: new Date().toISOString(),
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // keep the stream alive even if a query hiccups
        }
      };
      await send();
      iv = setInterval(send, 3000);
      // Close after 10 min to avoid unbounded server streams; the client reconnects.
      stop = setTimeout(() => { cleanup(); safeClose(); }, 600_000);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
