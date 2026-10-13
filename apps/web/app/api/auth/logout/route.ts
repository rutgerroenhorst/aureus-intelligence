import { NextResponse } from "next/server";
import { cookieName } from "@/lib/auth/policy";

export const dynamic = "force-dynamic";

/** Logging out: the cookie is cleared on this device. (POST only: a plain link could be fetched in advance by a browser and log you out by itself.) */
export async function POST() {
  const production = process.env.NODE_ENV === "production";
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login", "cache-control": "no-store" } });
  res.cookies.set({ name: cookieName(production), value: "", httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
