import { NextResponse } from "next/server";
import { buildDossier, MINT_RE } from "@/lib/dossier";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

/** Everything the free sources say about one coin (see lib/dossier.ts). Read-only. */
export async function GET(_req: Request, { params }: { params: { mint: string } }) {
  const mint = params.mint;
  if (!MINT_RE.test(mint)) return NextResponse.json({ error: "That is not a Solana coin address." }, { status: 400, headers: noStore });
  try {
    const d = await buildDossier(mint);
    if ("error" in d) return NextResponse.json(d, { status: 429, headers: noStore });
    return NextResponse.json(d, { headers: noStore });
  } catch (err) {
    console.error("[coin] dossier failed", err);
    return NextResponse.json({ error: "The dossier could not be built." }, { status: 500, headers: noStore });
  }
}
