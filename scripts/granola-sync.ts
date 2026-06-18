import { loadEnvConfig } from "@next/env";
import { disableObsidianGranolaSync, getObsidianHandoffStatus, restoreObsidianGranolaSync } from "../src/lib/granola/handoff";
import { getGranolaSyncStatus, runGranolaSync } from "../src/lib/granola/sync";
import type { GranolaSyncMode } from "../src/lib/granola/types";

loadEnvConfig(process.cwd());

async function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  const flags = parseFlags(args);

  if (command === "status") {
    print(await getGranolaSyncStatus());
    return;
  }

  if (command === "handoff-status") {
    print(await getObsidianHandoffStatus());
    return;
  }

  if (command === "handoff-disable") {
    print(await disableObsidianGranolaSync({ dryRun: !flags.write }));
    return;
  }

  if (command === "handoff-restore") {
    print(await restoreObsidianGranolaSync({ dryRun: !flags.write }));
    return;
  }

  if (["compare", "incremental", "backfill", "augment-existing"].includes(command)) {
    const mode = command as GranolaSyncMode;
    print(await runGranolaSync({
      mode,
      dryRun: mode === "compare" ? true : !flags.write,
      daysBack: stringFlag(flags.days) ? Number(flags.days) : mode === "compare" ? 30 : undefined,
      limit: stringFlag(flags.limit) ? Number(flags.limit) : mode === "compare" ? 50 : undefined,
      outputDir: stringFlag(flags.out),
    }));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") flags.write = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
      const next = args[i + 1];
      if (!next || next.startsWith("--")) flags[key] = true;
      else flags[key] = args[++i];
    }
  }
  return flags;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
