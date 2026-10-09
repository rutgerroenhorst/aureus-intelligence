/** pnpm env:check — validate environment and print the resolved source modes. */
import { loadConfig, describeConfig } from "@aureus/config";

try {
  const cfg = loadConfig();
  console.log("Environment OK.\n");
  console.log(describeConfig(cfg));
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
