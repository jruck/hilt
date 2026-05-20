import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "path";
import { homedir } from "os";
import type { WorkFootprintEntry, WorkFootprintKind } from "./local-types";

interface WorkFootprintSignal {
  path: string;
  kind: WorkFootprintKind;
  weight: number;
  cwd?: string;
}

const MAX_FOOTPRINT_ENTRIES = 5;
const MAX_RELATIVE_DEPTH = 5;
const MAX_CODEX_FOOTPRINT_BYTES = 384 * 1024;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function cleanPathCandidate(value: string): string | undefined {
  const trimmed = value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[),;]+$/g, "");

  if (!trimmed || trimmed.length > 500) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;
  if (trimmed.startsWith("-")) return undefined;
  if (trimmed.includes("\n")) return undefined;
  return trimmed;
}

function resolveCandidate(path: string, cwd?: string): string | undefined {
  const cleaned = cleanPathCandidate(path);
  if (!cleaned) return undefined;

  const expanded = cleaned === "~" || cleaned.startsWith("~/")
    ? join(homedir(), cleaned.slice(2))
    : cleaned;

  if (isAbsolute(expanded)) return normalize(expanded);
  if (!cwd) return undefined;
  return normalize(resolve(cwd, expanded));
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function looksLikeFile(path: string): boolean {
  if (extname(path)) return true;
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function focusFolderForPath(path: string): string {
  return looksLikeFile(path) ? dirname(path) : path;
}

function capDepth(path: string, workspaceRoot?: string): string {
  if (!workspaceRoot || !isInside(path, workspaceRoot)) return path;

  const rel = relative(workspaceRoot, path);
  if (!rel) return path;

  const parts = rel.split(sep).filter(Boolean);
  if (parts.length <= MAX_RELATIVE_DEPTH) return path;
  return join(workspaceRoot, ...parts.slice(0, MAX_RELATIVE_DEPTH));
}

function labelForPath(path: string, workspaceRoot?: string): string {
  const rel = workspaceRoot && isInside(path, workspaceRoot) ? relative(workspaceRoot, path) : undefined;
  if (rel && rel !== "") return rel;

  const home = homedir();
  const homeRel = path.startsWith(home) ? path.slice(home.length + 1) : undefined;
  return homeRel || path;
}

function addSignal(signals: WorkFootprintSignal[], path: unknown, kind: WorkFootprintKind, weight: number, cwd?: string) {
  if (typeof path !== "string") return;
  const resolved = resolveCandidate(path, cwd);
  if (!resolved) return;
  signals.push({ path: resolved, kind, weight, cwd });
}

function walkPathFields(value: unknown, signals: WorkFootprintSignal[], kind: WorkFootprintKind, weight: number, cwd?: string) {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) walkPathFields(item, signals, kind, weight, cwd);
    return;
  }

  const object = asObject(value);
  if (!object) return;

  for (const [key, item] of Object.entries(object)) {
    const lower = key.toLowerCase();
    if (
      lower === "path" ||
      lower === "filepath" ||
      lower === "file_path" ||
      lower === "filename" ||
      lower === "folder" ||
      lower === "directory" ||
      lower === "cwd"
    ) {
      addSignal(signals, item, kind, weight, cwd);
      continue;
    }
    walkPathFields(item, signals, kind, weight, cwd);
  }
}

function extractPatchPaths(patchText: string, cwd: string | undefined, signals: WorkFootprintSignal[]) {
  const matches = patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm);
  for (const match of matches) {
    addSignal(signals, match[1], "write", 10, cwd);
  }
}

function extractCommandPaths(command: string, cwd: string | undefined, signals: WorkFootprintSignal[]) {
  const tokenPattern = /(?:^|\s)(['"]?)([~./A-Za-z0-9_-][A-Za-z0-9_./@%+-]*\/[A-Za-z0-9_./@%+-]+|[.]{1,2}\/[^\s'"`]+)\1/g;
  for (const match of command.matchAll(tokenPattern)) {
    addSignal(signals, match[2], "shell", 2, cwd);
  }
}

function toolKind(name: string | undefined): WorkFootprintKind {
  const lower = name?.toLowerCase() ?? "";
  if (/(edit|write|multiedit|apply_patch|patch)/.test(lower)) return "write";
  if (/(grep|glob|rg|search|find)/.test(lower)) return "search";
  if (/(bash|exec|command|shell)/.test(lower)) return "shell";
  return "read";
}

function readTailText(path: string): string {
  const stat = statSync(path);
  if (stat.size <= MAX_CODEX_FOOTPRINT_BYTES) return readFileSync(path, "utf-8");

  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_CODEX_FOOTPRINT_BYTES);
    readSync(fd, buffer, 0, MAX_CODEX_FOOTPRINT_BYTES, stat.size - MAX_CODEX_FOOTPRINT_BYTES);
    const text = buffer.toString("utf-8");
    const firstNewline = text.indexOf("\n");
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  } finally {
    closeSync(fd);
  }
}

function extractCodexSignalsFromRows(rows: Array<{ row: Record<string, unknown>; lineNo?: number }>, cwd?: string): WorkFootprintSignal[] {
  const signals: WorkFootprintSignal[] = [];

  for (const { row } of rows) {
    if (row.type !== "response_item") continue;
    const payload = asObject(parseMaybeJson(row.payload));
    if (!payload || payload.type !== "function_call") continue;

    const name = typeof payload.name === "string" ? payload.name : undefined;
    const args = parseMaybeJson(payload.arguments);
    const argsObject = asObject(args);
    const kind = toolKind(name);
    const activeCwd = typeof argsObject?.workdir === "string" ? argsObject.workdir : cwd;

    if (name === "apply_patch" && typeof args === "string") {
      extractPatchPaths(args, activeCwd, signals);
    } else if (argsObject) {
      if (typeof argsObject.cmd === "string") extractCommandPaths(argsObject.cmd, activeCwd, signals);
      walkPathFields(argsObject, signals, kind, kind === "write" ? 8 : 3, activeCwd);
    } else if (typeof args === "string") {
      if (name === "apply_patch") extractPatchPaths(args, activeCwd, signals);
      extractCommandPaths(args, activeCwd, signals);
    }
  }

  return signals;
}

export function extractCodexWorkFootprintFromRows(rows: Array<{ row: Record<string, unknown>; lineNo?: number }>, cwd?: string): WorkFootprintEntry[] {
  return buildWorkFootprint(extractCodexSignalsFromRows(rows, cwd), cwd, cwd);
}

export function extractClaudeWorkFootprintFromRows(rows: Array<{ row: Record<string, unknown>; cwd?: string }>, workspaceRoot?: string, fallbackCwd?: string): WorkFootprintEntry[] {
  const signals: WorkFootprintSignal[] = [];

  for (const { row, cwd } of rows) {
    const message = asObject(row.message);
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      const item = asObject(part);
      if (!item || item.type !== "tool_use") continue;
      const name = typeof item.name === "string" ? item.name : undefined;
      const input = asObject(item.input);
      const kind = toolKind(name);
      const activeCwd = cwd || fallbackCwd;
      walkPathFields(input, signals, kind, kind === "write" ? 8 : 3, activeCwd);
      if (typeof input?.command === "string") extractCommandPaths(input.command, activeCwd, signals);
    }
  }

  return buildWorkFootprint(signals, workspaceRoot, fallbackCwd);
}

export function readCodexWorkFootprint(path: string | undefined, workspaceRoot?: string, cwd?: string): WorkFootprintEntry[] | undefined {
  if (!path || !existsSync(path)) return undefined;

  const rows: Array<{ row: Record<string, unknown> }> = [];
  for (const line of readTailText(path).split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push({ row: JSON.parse(line) as Record<string, unknown> });
    } catch {
      // Ignore malformed JSONL rows from append-only logs.
    }
  }

  return buildWorkFootprint(extractCodexSignalsFromRows(rows, cwd), workspaceRoot ?? cwd, cwd);
}

export function buildWorkFootprint(signals: WorkFootprintSignal[], workspaceRoot?: string, cwd?: string): WorkFootprintEntry[] {
  const root = workspaceRoot ? normalize(workspaceRoot) : cwd ? normalize(cwd) : undefined;
  const byFolder = new Map<string, { weight: number; eventCount: number; kinds: Set<WorkFootprintKind> }>();

  for (const signal of signals) {
    const folder = capDepth(focusFolderForPath(signal.path), root);
    if (root && !isInside(folder, root)) continue;
    if (root && folder === root) continue;

    const current = byFolder.get(folder) ?? { weight: 0, eventCount: 0, kinds: new Set<WorkFootprintKind>() };
    current.weight += signal.weight;
    current.eventCount += 1;
    current.kinds.add(signal.kind);
    byFolder.set(folder, current);
  }

  return [...byFolder.entries()]
    .map(([path, value]) => ({
      path,
      label: labelForPath(path, root),
      weight: Number(value.weight.toFixed(2)),
      eventCount: value.eventCount,
      kinds: [...value.kinds].sort(),
    }))
    .sort((a, b) => b.weight - a.weight || b.eventCount - a.eventCount || a.label.localeCompare(b.label))
    .slice(0, MAX_FOOTPRINT_ENTRIES);
}
