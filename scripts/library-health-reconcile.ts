import { loadEnvConfig } from "@next/env";
import { reconcileProcessingQueue } from "../src/lib/library/processing";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const valueAfter = (name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};
const vaultPath = valueAfter("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();

const report = reconcileProcessingQueue(vaultPath, { write: args.includes("--write") });
console.log(JSON.stringify(report, null, 2));
