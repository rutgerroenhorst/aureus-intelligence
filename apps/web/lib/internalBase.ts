// Base URL for server-side calls from one API route to another.
// Locally that is localhost; on Vercel it must be the public production domain
// (the unique deployment URL sits behind Vercel auth and would answer 401).
export function internalBase(): string {
  const explicit = process.env.AUREUS_INTERNAL_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL) {
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (prod) return `https://${prod}`;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
