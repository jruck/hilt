import * as fs from "fs";
import * as path from "path";
import type { BridgeArea, BridgeAreaLink } from "../types";
import { getAllAreas } from "./area-parser";

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return null;
  }
}

function compactList(items: string[], maxItems = 6): string[] {
  const visible = items.slice(0, maxItems);
  if (items.length > maxItems) {
    visible.push(`... ${items.length - maxItems} more`);
  }
  return visible;
}

function formatItems(label: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [
    `${label}:`,
    ...compactList(items).map((item) => `- ${item}`),
  ];
}

function formatActiveProject(link: BridgeAreaLink): string {
  return link.raw || link.label || link.target;
}

function formatArea(area: BridgeArea): string[] {
  const focus = area.focus.map((item) => item.text).filter(Boolean);
  const activeProjects = area.activeProjects.map(formatActiveProject).filter(Boolean);
  const lines = [`### ${area.title} (${area.relativePath}/index.md)`];

  lines.push(...formatItems("North Stars", focus));
  lines.push(...formatItems("Goals", area.goals));
  lines.push(...formatItems("Standards", area.standards));
  lines.push(...formatItems("Active Projects", activeProjects));

  if (lines.length === 1) {
    lines.push("(no goals, standards, or active projects recorded)");
  }

  return lines;
}

export async function buildAreaGoalContextBlock(vaultPath: string): Promise<string> {
  const areasDir = path.join(vaultPath, "areas");
  const rollupPath = path.join(areasDir, "index.md");
  const rollup = readIfExists(rollupPath);
  const { areas } = await getAllAreas(vaultPath);

  const lines = [
    "=== NORTH STARS / AREAS ===",
    "Use this as a relevance lens, not a daily checklist.",
    "",
    "## areas/index.md",
    rollup || "(missing areas/index.md)",
    "",
    "## Area files: Goals, Standards, Active Projects",
  ];

  for (const area of areas) {
    lines.push("", ...formatArea(area));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
