import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVaultPath } from "@/lib/bridge/vault";
import { libraryItemScope } from "@/lib/library/url";
import { hashId, walkMarkdown } from "@/lib/library/utils";
import { buildViewUrl, type ViewPrefix } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResolvedLibraryWikilink {
  exists: boolean;
  target: string;
  view?: ViewPrefix;
  scope?: string;
  href?: string;
  path?: string;
}

function normalizedRelativePath(vaultPath: string, filePath: string): string | null {
  const vaultRoot = path.resolve(vaultPath);
  const resolved = path.resolve(filePath);
  if (resolved !== vaultRoot && !resolved.startsWith(`${vaultRoot}${path.sep}`)) return null;
  return path.relative(vaultRoot, resolved).replace(/\\/g, "/");
}

function existingMarkdownCandidate(vaultPath: string, basePath: string): string | null {
  const vaultRoot = path.resolve(vaultPath);
  const normalizedBase = path.resolve(basePath);
  if (normalizedBase !== vaultRoot && !normalizedBase.startsWith(`${vaultRoot}${path.sep}`)) return null;

  const candidates = [
    normalizedBase,
    `${normalizedBase}.md`,
    `${normalizedBase}.markdown`,
    path.join(normalizedBase, "index.md"),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved !== vaultRoot && !resolved.startsWith(`${vaultRoot}${path.sep}`)) continue;
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile() && /\.(md|markdown)$/.test(resolved)) return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function buildMarkdownTargetMap(vaultPath: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const filePath of walkMarkdown(vaultPath)) {
    const relPath = normalizedRelativePath(vaultPath, filePath);
    if (!relPath) continue;

    const relLower = relPath.toLowerCase();
    const relWithoutExt = relLower.replace(/\.[^/.]+$/, "");
    const name = path.basename(relPath).toLowerCase();
    const nameWithoutExt = name.replace(/\.[^/.]+$/, "");
    const indexFolder = relLower.endsWith("/index.md") ? relLower.slice(0, -"/index.md".length) : null;

    for (const key of [relLower, relWithoutExt, name, nameWithoutExt, indexFolder].filter(Boolean) as string[]) {
      if (!map.has(key)) map.set(key, filePath);
    }
  }
  return map;
}

function resolveTargetPath(vaultPath: string, target: string, currentPath?: string): string | null {
  const rawTarget = target.split("|")[0]?.split("#")[0]?.trim().replace(/\\/g, "/") || "";
  if (!rawTarget) return null;

  const vaultRoot = path.resolve(vaultPath);
  const currentRelPath = currentPath?.replace(/\\/g, "/").replace(/^\/+/, "") || "";
  const currentFilePath = currentRelPath ? path.resolve(vaultRoot, currentRelPath) : null;
  const currentDir = currentFilePath && normalizedRelativePath(vaultPath, currentFilePath) ? path.dirname(currentFilePath) : vaultRoot;

  if (rawTarget.startsWith("./") || rawTarget.startsWith("../")) {
    return existingMarkdownCandidate(vaultPath, path.resolve(currentDir, rawTarget));
  }

  if (rawTarget.startsWith("/")) {
    return existingMarkdownCandidate(vaultPath, path.resolve(vaultRoot, rawTarget.slice(1)));
  }

  const vaultRelative = existingMarkdownCandidate(vaultPath, path.resolve(vaultRoot, rawTarget));
  if (vaultRelative) return vaultRelative;

  if (rawTarget.includes("/")) {
    const localRelative = existingMarkdownCandidate(vaultPath, path.resolve(currentDir, rawTarget));
    if (localRelative) return localRelative;
  }

  const targetKey = rawTarget.toLowerCase().replace(/\.[^/.]+$/, "");
  const map = buildMarkdownTargetMap(vaultPath);
  return map.get(rawTarget.toLowerCase()) || map.get(targetKey) || null;
}

function routeForPath(vaultPath: string, filePath: string): ResolvedLibraryWikilink | null {
  const relPath = normalizedRelativePath(vaultPath, filePath);
  if (!relPath) return null;

  if (relPath === "people/index.md") {
    return { exists: true, target: relPath, view: "people", scope: "", href: buildViewUrl("people", ""), path: relPath };
  }

  const peopleMatch = relPath.match(/^people\/([^/]+)\.md$/);
  if (peopleMatch && peopleMatch[1] !== "index") {
    const scope = `/${peopleMatch[1]}`;
    return { exists: true, target: relPath, view: "people", scope, href: buildViewUrl("people", scope), path: relPath };
  }

  if (relPath.startsWith("references/")) {
    const scope = libraryItemScope(hashId(relPath));
    return { exists: true, target: relPath, view: "library", scope, href: buildViewUrl("library", scope), path: relPath };
  }

  return { exists: true, target: relPath, view: "docs", scope: filePath, href: buildViewUrl("docs", filePath), path: relPath };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { target?: unknown; currentPath?: unknown };
    const target = typeof body.target === "string" ? body.target.trim() : "";
    const currentPath = typeof body.currentPath === "string" ? body.currentPath.trim() : undefined;
    if (!target) {
      return NextResponse.json({ error: "target is required" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    const filePath = resolveTargetPath(vaultPath, target, currentPath);
    if (!filePath) {
      return NextResponse.json({ exists: false, target });
    }

    const resolved = routeForPath(vaultPath, filePath);
    return NextResponse.json(resolved || { exists: false, target });
  } catch (error) {
    console.error("[library] wikilink resolution failed:", error);
    return NextResponse.json({ error: "Failed to resolve wikilink" }, { status: 500 });
  }
}
