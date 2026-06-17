#!/usr/bin/env tsx
import * as path from "path";
import * as os from "os";
import { buildAreaGoalContextBlock } from "../src/lib/bridge/area-goal-context";

const vaultPath = process.argv[2] || path.join(os.homedir(), "work/bridge");

buildAreaGoalContextBlock(vaultPath)
  .then((block) => process.stdout.write(block))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
