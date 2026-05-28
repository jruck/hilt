import { loadEnvConfig } from "@next/env";
import path from "path";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { atomicWriteFile, walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const apply = process.argv.includes("--apply");
const referencesRoot = path.join(vaultPath, "references");

interface MigrationItem {
  path: string;
  from: string;
  action: "would_update" | "updated" | "skipped";
  reason?: string;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function main() {
  const items: MigrationItem[] = [];
  for (const filePath of walkMarkdown(referencesRoot)) {
    if (filePath.includes(`${path.sep}.cache${path.sep}`)) continue;
    const relativePath = path.relative(vaultPath, filePath).split(path.sep).join("/");
    try {
      const parsed = parseMarkdownFile(filePath);
      if (parsed.data.type !== "reference") continue;
      if (parsed.data.url) continue;
      if (!isHttpUrl(parsed.data.source)) continue;

      const sourceUrl = parsed.data.source;
      const nextData: Record<string, unknown> = { ...parsed.data, url: sourceUrl };
      delete nextData.source;
      if (apply) {
        atomicWriteFile(filePath, stringifyMarkdown(nextData, parsed.body));
      }
      items.push({
        path: relativePath,
        from: sourceUrl,
        action: apply ? "updated" : "would_update",
      });
    } catch (error) {
      items.push({
        path: relativePath,
        from: "",
        action: "skipped",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const blocked = items.filter((item) => item.action === "skipped");
  console.log(JSON.stringify({
    apply,
    checked_root: referencesRoot,
    updates: items.filter((item) => item.action !== "skipped").length,
    skipped: blocked.length,
    items,
  }, null, 2));
  process.exitCode = blocked.length ? 1 : 0;
}

main();
