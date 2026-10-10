import { internalBase } from "@/lib/internalBase";

type Handler = (req: Request) => Promise<Response> | Response;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "DELETE", Handler>>;

// Static import() calls (not computed) so the bundler includes every target route.
const routes: Record<string, () => Promise<RouteModule>> = {
  "/api/candidates": () => import("@/app/api/candidates/route"),
  "/api/safety-gate": () => import("@/app/api/safety-gate/route"),
  "/api/cate-hunter": () => import("@/app/api/cate-hunter/route"),
  "/api/board": () => import("@/app/api/board/route"),
  "/api/honeypot-check": () => import("@/app/api/honeypot-check/route"),
  "/api/elite-whale-tracking": () => import("@/app/api/elite-whale-tracking/route"),
  "/api/elite-risk-analysis": () => import("@/app/api/elite-risk-analysis/route"),
  "/api/elite-early-warning": () => import("@/app/api/elite-early-warning/route"),
  "/api/elite-signal-consensus": () => import("@/app/api/elite-signal-consensus/route"),
  "/api/learning-update-outcomes": () => import("@/app/api/learning-update-outcomes/route"),
  "/api/learning-generate-suggestions": () => import("@/app/api/learning-generate-suggestions/route"),
  "/api/elite-validator": () => import("@/app/api/elite-validator/route"),
  "/api/ultra-early": () => import("@/app/api/ultra-early/route"),
  "/api/ultra-early-momentum": () => import("@/app/api/ultra-early-momentum/route"),
  "/api/incubation": () => import("@/app/api/incubation/route"),
  "/api/signals": () => import("@/app/api/signals/route"),
  "/api/positions": () => import("@/app/api/positions/route"),
  "/api/trends": () => import("@/app/api/trends/route"),
  "/api/momentum": () => import("@/app/api/momentum/route"),
  "/api/performance": () => import("@/app/api/performance/route"),
  "/api/network-sentiment": () => import("@/app/api/network-sentiment/route"),
  "/api/runners": () => import("@/app/api/runners/route"),
  "/api/lab-odds": () => import("@/app/api/lab-odds/route"),
};

/**
 * fetch() for calling another API route of this app. Known routes run in-process (no network hop,
 * so it works behind Vercel Authentication and avoids one serverless invocation per call).
 * Unknown paths fall back to a real HTTP request against internalBase().
 */
export async function internalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, internalBase());
  const load = routes[url.pathname];
  if (!load) return fetch(url, init);
  const mod = await load();
  const handler = mod[(init.method ?? "GET").toUpperCase() as keyof RouteModule];
  if (!handler) return new Response("Method Not Allowed", { status: 405 });
  return handler(new Request(url, init));
}
