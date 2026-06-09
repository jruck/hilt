import crypto from "crypto";
import fs from "fs";
import path from "path";

export function hashId(input: string, length = 16): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, length);
}

export function dateOnly(input: string | Date = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function dateTimestamp(input: string | null | undefined): number {
  if (!input) return 0;
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareDatesDesc(a: string | null | undefined, b: string | null | undefined): number {
  const byTimestamp = dateTimestamp(b) - dateTimestamp(a);
  if (byTimestamp !== 0) return byTimestamp;
  return String(b || "").localeCompare(String(a || ""));
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function addDays(date: string | Date, days: number): string {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnly(d);
}

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

export function canonicalUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      url.searchParams.delete(key);
    }
    const text = url.toString();
    return text.endsWith("/") ? text.slice(0, -1) : text;
  } catch {
    return input.trim();
  }
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function atomicWriteFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

export function walkMarkdown(root: string, options: { includeHidden?: boolean } = {}): string[] {
  if (!fs.existsSync(root)) return [];
  const results: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!options.includeHidden && entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) results.push(full);
    }
  };
  visit(root);
  return results.sort();
}

export function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function scoreClamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
