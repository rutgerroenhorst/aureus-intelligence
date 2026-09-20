import { NextResponse } from "next/server";
import { pingDb } from "../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness of the things every page depends on. Used by app/error.tsx to detect
 * that Postgres came back and reload itself, so a dropped container recovers
 * without the user reloading by hand.
 */
export async function GET() {
  const db = await pingDb();
  return NextResponse.json({ db, at: new Date().toISOString() }, { status: db ? 200 : 503 });
}
