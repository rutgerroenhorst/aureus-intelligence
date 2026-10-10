/**
 * Run one Learning Lab round by hand (what the hosted learning tick does every 15 minutes):
 *
 *   corepack pnpm exec tsx scripts/lab-tick.ts [force]
 *   LAB_AS_ROLE=aureus_app DATABASE_URL=<hosted, as postgres> corepack pnpm exec tsx scripts/lab-tick.ts force
 *
 * LAB_AS_ROLE runs every query as that role (SET ROLE), which is how the hosted web role's limited rights are rehearsed from here.
 */
import { closePool, getPool } from "@aureus/db";
import { runLab } from "../apps/web/lib/lab/tick";

const force = process.argv.includes("force");
const role = process.env.LAB_AS_ROLE;
if (role) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(role)) throw new Error("LAB_AS_ROLE must be a plain role name");
  // Queued on the new connection before anything the pool sends, so every query of this run uses the role.
  getPool().on("connect", (c) => void c.query(`SET ROLE ${role}`));
}
runLab({ force })
  .then((r) => console.log(JSON.stringify(r, null, 1)))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => closePool());
