import * as fs from "fs";
import * as path from "path";
import type {
  BridgeArea,
  BridgeAreaFocus,
  BridgeAreaFocusSection,
  BridgeAreaLink,
  BridgeAreasResponse,
} from "../types";

const FOCUS_SECTION_LABELS: Record<string, BridgeAreaFocusSection> = {
  now: "now",
  ongoing: "ongoing",
  "long-term": "long-term",
  "long term": "long-term",
};

const FOCUS_RANK: Record<BridgeAreaFocusSection, number> = {
  now: 0,
  ongoing: 1,
  "long-term": 2,
};

interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

interface RollupFocus extends BridgeAreaFocus {
  slug: string | null;
  order: number;
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function parseMarkdown(content: string): ParsedMarkdown {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of content.slice(4, endIdx).split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = cleanScalar(value);
  }

  return { frontmatter, body: content.slice(endIdx + 4) };
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleFromBody(body: string, fallback: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : fallback;
}

function stripH1(body: string): string {
  return body.replace(/^#\s+.+(?:\r?\n)?/m, "").trim();
}

function sectionsFromBody(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let current: string | null = null;
  let buffer: string[] = [];

  function flush() {
    if (current) sections.set(current, buffer.join("\n").trim());
    buffer = [];
  }

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      flush();
      current = match[1].trim().toLowerCase();
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  return sections;
}

function bulletsFromSection(section: string | undefined): string[] {
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

function firstIntroParagraph(body: string): string {
  const withoutH1 = stripH1(body);
  const beforeFirstH2 = withoutH1.split(/^##\s+/m)[0]?.trim() ?? "";
  return beforeFirstH2
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .find(Boolean) ?? "";
}

function getLatestMtime(dir: string, depth = 2): number {
  let latest = 0;
  try {
    const dirStat = fs.statSync(dir);
    latest = dirStat.mtimeMs;
    if (depth <= 0) return latest;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      try {
        if (entry.isFile()) {
          latest = Math.max(latest, fs.statSync(full).mtimeMs);
        } else if (entry.isDirectory()) {
          latest = Math.max(latest, getLatestMtime(full, depth - 1));
        }
      } catch {
        // Skip unreadable files.
      }
    }
  } catch {
    return 0;
  }
  return latest;
}

function parseWikilink(raw: string): { target: string; label: string } | null {
  const match = raw.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/);
  if (!match) return null;
  const target = match[1].trim();
  const label = (match[2]?.trim() || path.basename(target.replace(/\/index$/, "")) || target).trim();
  return { target, label };
}

function slugFromWikilinkTarget(target: string): string | null {
  const normalized = target
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/^\/+/, "")
    .replace(/^areas\//, "")
    .replace(/^\.\.\//, "");

  if (!normalized) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[parts.length - 1] === "index" && parts.length > 1) return parts[parts.length - 2];
  return parts[0] === "index" ? null : parts[0];
}

function textBeforeWikilink(raw: string): string {
  const withoutLink = raw.replace(/\s*(?:->|→)?\s*\[\[[^\]]+\]\]\s*/g, "").trim();
  return withoutLink || raw.replace(/\[\[|\]\]/g, "").trim();
}

function parseRollupFocus(rollupPath: string): RollupFocus[] {
  if (!fs.existsSync(rollupPath)) return [];
  const content = fs.readFileSync(rollupPath, "utf-8");
  const sections = sectionsFromBody(parseMarkdown(content).body);
  const focus: RollupFocus[] = [];
  let order = 0;

  for (const [heading, body] of sections) {
    const section = FOCUS_SECTION_LABELS[heading];
    if (!section) continue;

    for (const raw of bulletsFromSection(body)) {
      const link = parseWikilink(raw);
      focus.push({
        section,
        text: textBeforeWikilink(raw),
        target: link?.target ?? "",
        label: link?.label ?? "",
        raw,
        slug: link ? slugFromWikilinkTarget(link.target) : null,
        order: order++,
      });
    }
  }

  return focus;
}

function parseAreaLinks(items: string[]): BridgeAreaLink[] {
  return items.map((raw) => {
    const link = parseWikilink(raw);
    return {
      target: link?.target ?? "",
      label: link?.label ?? textBeforeWikilink(raw),
      raw,
    };
  });
}

function buildArea(areaDir: string, vaultPath: string, focus: BridgeAreaFocus[]): BridgeArea {
  const slug = path.basename(areaDir);
  const indexPath = path.join(areaDir, "index.md");
  const relativePath = path.relative(vaultPath, areaDir);
  let title = humanizeSlug(slug);
  let description = "";
  let goals: string[] = [];
  let standards: string[] = [];
  let activeProjects: BridgeAreaLink[] = [];

  if (fs.existsSync(indexPath)) {
    try {
      const parsed = parseMarkdown(fs.readFileSync(indexPath, "utf-8"));
      title = titleFromBody(parsed.body, title);
      description = parsed.frontmatter.description || firstIntroParagraph(parsed.body);
      const sections = sectionsFromBody(parsed.body);
      goals = bulletsFromSection(sections.get("goals"));
      standards = bulletsFromSection(sections.get("standards"));
      activeProjects = parseAreaLinks(bulletsFromSection(sections.get("active projects")));
    } catch {
      // Keep fallbacks.
    }
  }

  const sortedFocus = [...focus].sort((a, b) => FOCUS_RANK[a.section] - FOCUS_RANK[b.section]);
  const primaryFocus = sortedFocus[0]?.section ?? null;

  return {
    slug,
    path: areaDir,
    indexPath,
    relativePath,
    title,
    description,
    goals,
    standards,
    activeProjects,
    focus: sortedFocus,
    primaryFocus,
    lastModified: getLatestMtime(areaDir),
  };
}

export async function getAllAreas(vaultPath: string): Promise<BridgeAreasResponse> {
  const areasDir = path.join(vaultPath, "areas");
  const rollupPath = path.join(areasDir, "index.md");
  if (!fs.existsSync(areasDir)) {
    return { vaultPath, rollupPath: null, areas: [] };
  }

  const rollupFocus = parseRollupFocus(rollupPath);
  const focusBySlug = new Map<string, RollupFocus[]>();
  for (const focus of rollupFocus) {
    if (!focus.slug) continue;
    const list = focusBySlug.get(focus.slug) ?? [];
    list.push(focus);
    focusBySlug.set(focus.slug, list);
  }

  const areas: BridgeArea[] = [];
  for (const entry of fs.readdirSync(areasDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const areaDir = path.join(areasDir, entry.name);
    const areaFocus = (focusBySlug.get(entry.name) ?? []).map((focus) => ({
      section: focus.section,
      text: focus.text,
      target: focus.target,
      label: focus.label,
      raw: focus.raw,
    }));
    areas.push(buildArea(areaDir, vaultPath, areaFocus));
  }

  const firstFocusOrder = new Map<string, number>();
  for (const focus of rollupFocus) {
    if (!focus.slug || firstFocusOrder.has(focus.slug)) continue;
    firstFocusOrder.set(focus.slug, focus.order);
  }

  areas.sort((a, b) => {
    const rankA = a.primaryFocus ? FOCUS_RANK[a.primaryFocus] : 3;
    const rankB = b.primaryFocus ? FOCUS_RANK[b.primaryFocus] : 3;
    if (rankA !== rankB) return rankA - rankB;
    const orderA = firstFocusOrder.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const orderB = firstFocusOrder.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });

  return { vaultPath, rollupPath: fs.existsSync(rollupPath) ? rollupPath : null, areas };
}

export const areaParserInternals = {
  bulletsFromSection,
  parseRollupFocus,
  slugFromWikilinkTarget,
};
