import fs from "node:fs";
import path from "node:path";
import { getRecommendationFeed } from "@/lib/library/recommendations";
import type { RecommendedArtifact } from "@/lib/library/types";
import { extractHeading, parseMarkdownFile } from "@/lib/library/markdown";
import { libraryBriefingHealthSummary } from "@/lib/library/briefing-health";

export interface BriefingLibraryMemoContext {
  date: string;
  title: string;
  description: string;
  path: string;
}

export interface BriefingLibraryHealthContext {
  date: string;
  available: boolean;
  summary: string;
  path: string | null;
}

function dateAtNoonUtc(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

export function weekendBriefingAnchor(targetDate: string): string | null {
  const date = dateAtNoonUtc(targetDate);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay();
  if (day === 6) return targetDate;
  if (day !== 0) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function briefingLibraryMemoContext(vaultPath: string, targetDate: string): BriefingLibraryMemoContext | null {
  const anchor = weekendBriefingAnchor(targetDate);
  if (!anchor) return null;
  const candidates = [
    path.join(vaultPath, "meta", "loops", "references", "memos", `${anchor}-editors-memo.md`),
    path.join(vaultPath, "references", "process", "memos", `${anchor}-editors-memo.md`),
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return null;
  const parsed = parseMarkdownFile(filePath);
  return {
    date: anchor,
    title: String(parsed.data.title || extractHeading(parsed.body, "Editor's memo")),
    description: String(parsed.data.description || "").trim(),
    path: path.relative(vaultPath, filePath).split(path.sep).join("/"),
  };
}

function reportHealthSummary(data: Record<string, unknown>): string | null {
  const health = data.health && typeof data.health === "object" ? data.health as Record<string, unknown> : null;
  if (!health) return null;
  if (typeof health.briefing_summary === "string" && health.briefing_summary.trim()) return health.briefing_summary.trim();
  const qualityNotes = typeof health.quality_notes === "string" ? health.quality_notes : "";
  const scorecardText = qualityNotes.startsWith("scorecard: ") ? qualityNotes.slice("scorecard: ".length) : "";
  let scorecard: Record<string, unknown> | null = null;
  try { scorecard = scorecardText ? JSON.parse(scorecardText) as Record<string, unknown> : null; } catch { /* old truncated report */ }
  const proposalCount = Array.isArray(health.proposal_ids) ? health.proposal_ids.length : 0;
  return scorecard ? libraryBriefingHealthSummary({ scorecard, proposalCount }) : null;
}

export function briefingLibraryHealthContext(vaultPath: string, targetDate: string): BriefingLibraryHealthContext {
  const candidates = [
    path.join(vaultPath, "meta", "loops", "references", "reports", `${targetDate}.md`),
    path.join(vaultPath, "meta", "library-reports", `${targetDate}.md`),
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return { date: targetDate, available: false, summary: "Daily library report unavailable for this briefing.", path: null };
  }
  const parsed = parseMarkdownFile(filePath);
  return {
    date: targetDate,
    available: true,
    summary: reportHealthSummary(parsed.data) || "The daily Library report is available; open it for processing health, calibration, and steering proposals.",
    path: path.relative(vaultPath, filePath).split(path.sep).join("/"),
  };
}

function previousBriefingDate(vaultPath: string, targetDate: string): string | null {
  const dir = path.join(vaultPath, "briefings");
  try {
    return fs.readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name) && name.slice(0, 10) < targetDate)
      .sort()
      .at(-1)?.slice(0, 10) || null;
  } catch {
    return null;
  }
}

/** Six AM Eastern on the prior published briefing date; rollout day falls back to 24 hours. */
export function briefingRecommendationCutoff(vaultPath: string, targetDate: string): string {
  const previous = previousBriefingDate(vaultPath, targetDate);
  if (previous) {
    // July is daylight time. Intl-derived offset keeps historical winter runs deterministic too.
    const noonUtc = new Date(`${previous}T12:00:00.000Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(noonUtc);
    const easternHourAtNoonUtc = Number(parts.find((part) => part.type === "hour")?.value || 8);
    const offsetHours = easternHourAtNoonUtc - 12;
    return new Date(new Date(`${previous}T06:00:00.000Z`).getTime() - offsetHours * 3_600_000).toISOString();
  }
  return new Date(new Date(`${targetDate}T10:00:00.000Z`).getTime() - 24 * 3_600_000).toISOString();
}

export function selectBriefingRecommendationItems(
  items: RecommendedArtifact[],
  cutoff: string,
  limit = 3,
): RecommendedArtifact[] {
  return items
    .filter((item) => Boolean(item.is_unread && item.recommendation?.episode_id))
    .filter((item) => (item.recommendation?.recommended_at || "") > cutoff)
    .slice(0, Math.max(0, limit));
}

export function briefingRecommendationItems(vaultPath: string, targetDate: string, limit = 3): {
  cutoff: string;
  items: RecommendedArtifact[];
} {
  const cutoff = briefingRecommendationCutoff(vaultPath, targetDate);
  const feed = getRecommendationFeed(vaultPath, { limit: 100 });
  return { cutoff, items: selectBriefingRecommendationItems(feed.items, cutoff, limit) };
}

export function formatBriefingRecommendationGather(vaultPath: string, targetDate: string): string {
  const { cutoff, items } = briefingRecommendationItems(vaultPath, targetDate);
  const memo = briefingLibraryMemoContext(vaultPath, targetDate);
  const health = briefingLibraryHealthContext(vaultPath, targetDate);
  const lines = [
    "## Briefing recommendation episodes (frozen placements)",
    `Cutoff: ${cutoff}`,
    "Use only the supplied IDs. Place each selected episode on its own Library-section line exactly as shown; do not rewrite the token.",
  ];
  if (!items.length) {
    lines.push("(No new unread recommendation cleared the bar. Do not pad with older items.)");
  } else {
    for (const [index, item] of items.entries()) {
      const recommendation = item.recommendation!;
      lines.push(`Episode ${index + 1}:`);
      lines.push(`- \`rec:${recommendation.episode_id}\``);
      lines.push(`  Reference title (context only; never append to the token line): ${item.title}`);
      lines.push(`  Stored recommendation pitch (rendered by Hilt; do not restate): ${recommendation.why_now}`);
    }
  }
  lines.push(
    "",
    "## Library & knowledge module contract",
    "Use these level-three headings in this exact order: Recommended for you, Editor's memo when supplied, Library health.",
    "For 2-3 recommendations, precede the episode tokens with a 2-3 sentence, 40-90 word editorial lead explaining the shared tension or consequence. Do not recap each card or merely name categories.",
    "For one recommendation, use 1-2 sentences and 20-45 words. With zero, write only: Nothing new was selected for this briefing.",
    "",
    "## Weekly editor's memo",
  );
  if (memo) {
    lines.push(`Memo date: ${memo.date}`, `Title: ${memo.title}`, `Description: ${memo.description || "(no description supplied)"}`, `Path: ${memo.path}`, "Use [Read the memo](/api/reports/memo).");
  } else {
    lines.push("(No memo for this briefing's exact Saturday anchor. Omit the Editor's memo module.)");
  }
  lines.push(
    "",
    "## Daily Library health",
    `Report date: ${health.date}`,
    `Available: ${health.available ? "yes" : "no"}`,
    `Use this exact summary: ${health.summary}`,
    health.available ? "Use [Daily library report](/api/reports/morning)." : "Do not emit a report link; preserve the explicit unavailable warning.",
  );
  return lines.join("\n");
}
