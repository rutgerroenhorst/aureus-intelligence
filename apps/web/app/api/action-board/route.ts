import { getBoardView } from "../../../lib/boardSections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Canonical board snapshot — the ONLY source the client polls. */
export async function GET() {
  try {
    return Response.json(await getBoardView(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
