import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { ensureDir } from "../library/utils";
import type { GranolaDocument } from "./types";

export interface GranolaCompareItem {
  granolaId: string;
  title: string;
  existingPath: string | null;
  candidatePath: string;
  status: "missing-existing" | "same-body" | "different-body";
  missingFrontmatterKeys: string[];
  extraFrontmatterKeys: string[];
  bodyLineDelta: number;
}

export interface GranolaCompareReport {
  generatedAt: string;
  sampleSize: number;
  items: GranolaCompareItem[];
  markdownPath: string;
  jsonPath: string;
}

export function writeGranolaCompareReport(input: {
  outputDir: string;
  docs: GranolaDocument[];
  items: GranolaCompareItem[];
}): GranolaCompareReport {
  ensureDir(input.outputDir);
  const generatedAt = new Date().toISOString();
  const jsonPath = path.join(input.outputDir, "comparison-report.json");
  const markdownPath = path.join(input.outputDir, "comparison-report.md");
  const report: GranolaCompareReport = {
    generatedAt,
    sampleSize: input.docs.length,
    items: input.items,
    markdownPath,
    jsonPath,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
  fs.writeFileSync(markdownPath, renderMarkdownReport(report), "utf-8");
  return report;
}

export function compareMarkdownPair(input: {
  granolaId: string;
  title: string;
  existingPath: string | null;
  candidatePath: string;
  candidateContent: string;
}): GranolaCompareItem {
  if (!input.existingPath || !fs.existsSync(input.existingPath)) {
    return {
      granolaId: input.granolaId,
      title: input.title,
      existingPath: input.existingPath,
      candidatePath: input.candidatePath,
      status: "missing-existing",
      missingFrontmatterKeys: [],
      extraFrontmatterKeys: [],
      bodyLineDelta: lineCount(matter(input.candidateContent).content),
    };
  }

  const existing = matter(fs.readFileSync(input.existingPath, "utf-8"));
  const candidate = matter(input.candidateContent);
  const existingKeys = new Set(Object.keys(existing.data));
  const candidateKeys = new Set(Object.keys(candidate.data));
  const missingFrontmatterKeys = Array.from(existingKeys).filter((key) => !candidateKeys.has(key)).sort();
  const extraFrontmatterKeys = Array.from(candidateKeys).filter((key) => !existingKeys.has(key)).sort();
  const existingBody = normalizeBody(existing.content);
  const candidateBody = normalizeBody(candidate.content);
  return {
    granolaId: input.granolaId,
    title: input.title,
    existingPath: input.existingPath,
    candidatePath: input.candidatePath,
    status: existingBody === candidateBody ? "same-body" : "different-body",
    missingFrontmatterKeys,
    extraFrontmatterKeys,
    bodyLineDelta: lineCount(candidateBody) - lineCount(existingBody),
  };
}

function renderMarkdownReport(report: GranolaCompareReport): string {
  const totals = {
    missingExisting: report.items.filter((item) => item.status === "missing-existing").length,
    sameBody: report.items.filter((item) => item.status === "same-body").length,
    differentBody: report.items.filter((item) => item.status === "different-body").length,
  };
  const lines = [
    "# Granola Sync Comparison",
    "",
    `Generated: ${report.generatedAt}`,
    `Sample size: ${report.sampleSize}`,
    "",
    `- Same body: ${totals.sameBody}`,
    `- Different body: ${totals.differentBody}`,
    `- Missing existing file: ${totals.missingExisting}`,
    "",
    "## Items",
    "",
  ];

  for (const item of report.items) {
    lines.push(`### ${item.title}`);
    lines.push("");
    lines.push(`- Granola ID: \`${item.granolaId}\``);
    lines.push(`- Status: \`${item.status}\``);
    lines.push(`- Existing: ${item.existingPath ? `\`${item.existingPath}\`` : "_none_"}`);
    lines.push(`- Candidate: \`${item.candidatePath}\``);
    if (item.missingFrontmatterKeys.length) lines.push(`- Missing existing frontmatter keys: ${item.missingFrontmatterKeys.map((key) => `\`${key}\``).join(", ")}`);
    if (item.extraFrontmatterKeys.length) lines.push(`- Added frontmatter keys: ${item.extraFrontmatterKeys.map((key) => `\`${key}\``).join(", ")}`);
    if (item.bodyLineDelta) lines.push(`- Body line delta: ${item.bodyLineDelta > 0 ? "+" : ""}${item.bodyLineDelta}`);
    lines.push("");
  }

  return lines.join("\n");
}

function normalizeBody(value: string): string {
  return value.trim().replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
}

function lineCount(value: string): number {
  return value.trim() ? value.trim().split("\n").length : 0;
}
