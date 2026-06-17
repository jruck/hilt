import fs from "fs";
import path from "path";
import { hashId } from "@/lib/library/utils";

export type BriefingNativeLinkView = "docs" | "library";

export interface BriefingNativeLinkTarget {
  kind: "library-morning-report" | "library-editors-memo";
  view: BriefingNativeLinkView;
  scope: string;
  path: string;
}
function validDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function reportNameFromHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  let pathname = "";
  try {
    pathname = new URL(trimmed, "http://hilt.local").pathname;
  } catch {
    pathname = trimmed.split(/[?#]/)[0] || "";
  }
  const match = pathname.match(/(?:^|\/)api\/reports\/([a-z0-9][a-z0-9-]{0,63})$/i);
  return match?.[1]?.toLowerCase() || null;
}

function newestDatedMarkdown(
  dir: string,
  pattern: RegExp,
  asOfDate: string | null,
): string | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir)
    .map((name) => {
      const match = name.match(pattern);
      if (!match?.[1]) return null;
      if (asOfDate && match[1] > asOfDate) return null;
      return { date: match[1], filePath: path.join(dir, name) };
    })
    .filter((entry): entry is { date: string; filePath: string } => Boolean(entry))
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0]?.filePath || null;
}

function relativeVaultPath(vaultPath: string, filePath: string): string {
  return path.relative(vaultPath, filePath).split(path.sep).join("/");
}

function resolveMorningReport(vaultPath: string, date: string | null): BriefingNativeLinkTarget | null {
  const reportsDir = path.join(vaultPath, "meta", "library-reports");
  const exact = date ? path.join(reportsDir, `${date}.md`) : null;
  const filePath = exact && fs.existsSync(exact)
    ? exact
    : newestDatedMarkdown(reportsDir, /^(\d{4}-\d{2}-\d{2})\.md$/, date);
  if (!filePath) return null;
  return {
    kind: "library-morning-report",
    view: "docs",
    scope: filePath,
    path: relativeVaultPath(vaultPath, filePath),
  };
}

function resolveEditorsMemo(vaultPath: string, date: string | null): BriefingNativeLinkTarget | null {
  const memosDir = path.join(vaultPath, "references", "process", "memos");
  const filePath = newestDatedMarkdown(memosDir, /^(\d{4}-\d{2}-\d{2})-editors-memo\.md$/, date);
  if (!filePath) return null;
  const relPath = relativeVaultPath(vaultPath, filePath);
  return {
    kind: "library-editors-memo",
    view: "library",
    scope: `/item/${encodeURIComponent(hashId(relPath))}`,
    path: relPath,
  };
}

export function resolveBriefingNativeLinkTarget(
  vaultPath: string,
  href: string,
  date?: string | null,
): BriefingNativeLinkTarget | null {
  const reportName = reportNameFromHref(href);
  const asOfDate = validDate(date);
  if (reportName === "morning") return resolveMorningReport(vaultPath, asOfDate);
  if (reportName === "memo") return resolveEditorsMemo(vaultPath, asOfDate);
  return null;
}
