import fs from "fs";
import path from "path";

/**
 * Muted senders — newsletters (by sender email) the user doesn't want in the Library. Muted senders are
 * skipped at ingestion (no fetch/digest/reweave → no tokens), excluded from the feed, and their existing
 * items are deletable. Stored in the vault at `meta/library-muted-senders.json` (a flat list of emails),
 * so ingestion (which may run headless) reads it alongside the source configs.
 */
const MUTED_SENDERS_FILE = path.join("meta", "library-muted-senders.json");

export function extractEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/[^\s<>]+@[^\s<>]+/);
  return (match ? match[0] : String(value)).trim().toLowerCase() || null;
}

export function readMutedSenders(vaultPath: string): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(vaultPath, MUTED_SENDERS_FILE), "utf-8"));
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((s) => extractEmail(String(s))).filter((s): s is string => Boolean(s)));
  } catch {
    return new Set();
  }
}

export function isMutedSender(muted: Set<string>, sender: string | null | undefined): boolean {
  if (!muted.size) return false;
  const email = extractEmail(sender);
  return email ? muted.has(email) : false;
}
