import os from "node:os";
import path from "node:path";
import { formatBriefingRecommendationGather } from "../src/lib/briefing/recommendations";

const vaultPath = process.argv[2] || process.env.BRIDGE_VAULT_PATH;
const targetDate = process.argv[3] || new Date().toISOString().slice(0, 10);

process.env.DATA_DIR ||= path.join(os.homedir(), ".hilt", "data");

if (!vaultPath) {
  console.error("Usage: tsx scripts/briefing-library-recommendations.ts <vault-path> [target-date]");
  process.exit(1);
}

console.log(formatBriefingRecommendationGather(vaultPath, targetDate));
