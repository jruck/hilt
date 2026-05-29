import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { judgeConnections } from "../src/lib/library/connections";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { extractBullets, extractHeading, extractSection, parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { stripDetailsWrapper } from "../src/lib/library/media";
import type { ConnectionJudgment } from "../src/lib/library/types";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write"); // DEFAULT OFF = dry run

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

const vaultPath = argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();

const MAX_SOURCE_EXCERPT_CHARS = 5_000;

interface RejudgeTarget {
  filePath: string;
  isCandidate: boolean;
  sectionHeading: "Connections" | "Suggested Connections";
}

function resolveTargets(): string[] {
  const paths = argValues("--path").map((item) => (path.isAbsolute(item) ? item : path.resolve(item)));
  if (!paths.length) {
    throw new Error("Pass one or more --path <reference.md>.");
  }
  const limit = Number(argValue("--limit") || 0);
  return Number.isFinite(limit) && limit > 0 ? paths.slice(0, limit) : paths;
}

function connectionBody(judgment: ConnectionJudgment): string {
  if (!judgment.connections.length) return "";
  return judgment.connections.map((suggestion) => {
    const target = suggestion.target ? `[[${suggestion.target}]]` : suggestion.label;
    return `- ${target} — ${suggestion.relationship}`;
  }).join("\n");
}

/**
 * Replace ONLY the body of the given "## <heading>" section, leaving the heading line and every
 * other section (Summary, Key Points, Raw Content, Media, Assessment) byte-for-byte untouched.
 */
function replaceSectionBody(body: string, sectionName: string, newBody: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
  if (start === -1) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  const section = newBody.trim() ? ["", newBody.trim(), ""] : ["", ""];
  return [...before, ...section, ...after].join("\n");
}

async function main(): Promise<void> {
  const files = resolveTargets();
  // Build the KB index ONCE and reuse it across every file in this run.
  const kbIndex = buildKbIndex(vaultPath, { noWrite: true });
  const results: unknown[] = [];

  for (const filePath of files) {
    let target: RejudgeTarget;
    try {
      const { data } = parseMarkdownFile(filePath);
      const isCandidate = data.type === "reference-candidate";
      target = {
        filePath,
        isCandidate,
        sectionHeading: isCandidate ? "Suggested Connections" : "Connections",
      };
    } catch (error) {
      results.push({ path: filePath, status: "error", reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const { data, body } = parseMarkdownFile(target.filePath);
    const title = String(data.title || extractHeading(body, path.basename(target.filePath, ".md")));
    const summary = (extractSection(body, "Summary") || String(data.description || "")).trim();
    const keyPoints = extractBullets(extractSection(body, "Key Points"));
    const sourceExcerpt = stripDetailsWrapper(extractSection(body, "Raw Content")).slice(0, MAX_SOURCE_EXCERPT_CHARS);

    const judgment = await judgeConnections(kbIndex, {
      title,
      summary,
      keyPoints,
      sourceExcerpt: sourceExcerpt || summary,
    });

    if (write) {
      const nextBody = replaceSectionBody(body, target.sectionHeading, connectionBody(judgment));
      const nextData: Record<string, unknown> = { ...data };
      if (judgment.reasoning) nextData.connection_reasoning = judgment.reasoning;
      else delete nextData.connection_reasoning;
      if (judgment.reweave_candidates && judgment.reweave_candidates.length) {
        nextData.reweave_candidates = judgment.reweave_candidates;
      } else {
        delete nextData.reweave_candidates;
      }
      nextData.connection_suggestions = judgment.connections.length ? judgment.connections : undefined;
      nextData.reconnected_at = new Date().toISOString();
      for (const key of Object.keys(nextData)) {
        if (nextData[key] === undefined) delete nextData[key];
      }
      fs.writeFileSync(target.filePath, stringifyMarkdown(nextData, nextBody), "utf-8");
    }

    results.push({
      path: target.filePath,
      connects: judgment.connects,
      connection_verdict: judgment.connects ? "connects" : "no_connection",
      connections: judgment.connections.map((connection) => ({
        target: connection.target ?? null,
        relationship: connection.relationship,
      })),
      reweave_candidates: judgment.reweave_candidates || [],
      reasoning: judgment.reasoning,
      status: write ? "updated" : "dry_run",
    });
  }

  console.log(JSON.stringify({ write, vault: vaultPath, checked: files.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
