import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write");
const verify = args.includes("--verify");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

const vaultPath = path.resolve(
  argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || "/Users/jruck/work/bridge",
);

const legacyReportsDir = path.join(vaultPath, "meta", "library-reports");
const editorMemosDir = path.join(vaultPath, "references", "process", "memos");
const reportsDir = path.join(vaultPath, "meta", "loops", "references", "reports");
const migratedPointerPath = path.join(legacyReportsDir, "MIGRATED.md");

const sourceSpecs = [
  {
    group: "library-reports",
    dir: legacyReportsDir,
    match: (filename: string) => filename.endsWith(".md") && filename !== "MIGRATED.md",
  },
  {
    group: "editor-memos",
    dir: editorMemosDir,
    match: (filename: string) => filename.endsWith("-editors-memo.md"),
  },
] as const;

type SourceGroup = typeof sourceSpecs[number]["group"];
type CopyAction = "would_copy" | "copied" | "skipped_existing" | "error";
type PointerAction = "would_create" | "created" | "skipped_existing" | "skipped_missing_source_dir" | "error";

interface SourceFile {
  group: SourceGroup;
  filename: string;
  from: string;
  to: string;
}

interface CopyResult extends SourceFile {
  action: CopyAction;
  source_sha256?: string;
  destination_sha256?: string;
  error?: string;
}

interface PointerResult {
  path: string;
  action: PointerAction;
  points_to: string;
  error?: string;
}

interface ParityRow {
  group: SourceGroup | "total";
  source_count: number;
  destination_count: number;
  matched: number;
  missing: number;
  mismatched: number;
}

interface ParityFile extends SourceFile {
  status: "matched" | "missing" | "mismatched";
  source_sha256: string;
  destination_sha256: string | null;
}

function listMatchingFiles(spec: typeof sourceSpecs[number]): SourceFile[] {
  if (!fs.existsSync(spec.dir)) return [];
  return fs.readdirSync(spec.dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && spec.match(entry.name))
    .map((entry) => ({
      group: spec.group,
      filename: entry.name,
      from: path.join(spec.dir, entry.name),
      to: path.join(reportsDir, entry.name),
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

function discoverSources(): SourceFile[] {
  return sourceSpecs.flatMap((spec) => listMatchingFiles(spec));
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pointerContent(): string {
  const relativeDestination = path.relative(legacyReportsDir, reportsDir).split(path.sep).join("/");
  return [
    "# Migrated",
    "",
    "Legacy Library report markdown has moved to:",
    "",
    `- \`${relativeDestination || "."}\``,
    "",
    "The original files are intentionally left here for compatibility. New loop-era reference reports live in the destination above.",
    "",
  ].join("\n");
}

function ensurePointer(): PointerResult {
  const result: PointerResult = {
    path: migratedPointerPath,
    action: "would_create",
    points_to: reportsDir,
  };

  if (!fs.existsSync(legacyReportsDir)) {
    result.action = "skipped_missing_source_dir";
    return result;
  }
  if (fs.existsSync(migratedPointerPath)) {
    result.action = "skipped_existing";
    return result;
  }
  if (!write) return result;

  try {
    fs.writeFileSync(migratedPointerPath, pointerContent(), { encoding: "utf-8", flag: "wx" });
    result.action = "created";
  } catch (error) {
    result.action = "error";
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function copyOne(file: SourceFile): CopyResult {
  const result: CopyResult = {
    ...file,
    action: "would_copy",
    source_sha256: sha256File(file.from),
  };

  if (fs.existsSync(file.to)) {
    result.action = "skipped_existing";
    result.destination_sha256 = sha256File(file.to);
    return result;
  }
  if (!write) return result;

  try {
    fs.mkdirSync(path.dirname(file.to), { recursive: true });
    fs.copyFileSync(file.from, file.to, fs.constants.COPYFILE_EXCL);
    result.action = "copied";
    result.destination_sha256 = sha256File(file.to);
  } catch (error) {
    result.action = "error";
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function migrate(): { files: CopyResult[]; pointer: PointerResult } {
  const files = discoverSources().map(copyOne);
  return {
    files,
    pointer: ensurePointer(),
  };
}

function buildParity(): { rows: ParityRow[]; files: ParityFile[] } {
  const files = discoverSources().map((file): ParityFile => {
    const sourceSha = sha256File(file.from);
    if (!fs.existsSync(file.to)) {
      return { ...file, status: "missing", source_sha256: sourceSha, destination_sha256: null };
    }
    const destinationSha = sha256File(file.to);
    return {
      ...file,
      status: sourceSha === destinationSha ? "matched" : "mismatched",
      source_sha256: sourceSha,
      destination_sha256: destinationSha,
    };
  });

  const rows = sourceSpecs.map((spec): ParityRow => {
    const groupFiles = files.filter((file) => file.group === spec.group);
    return {
      group: spec.group,
      source_count: groupFiles.length,
      destination_count: groupFiles.filter((file) => file.destination_sha256).length,
      matched: groupFiles.filter((file) => file.status === "matched").length,
      missing: groupFiles.filter((file) => file.status === "missing").length,
      mismatched: groupFiles.filter((file) => file.status === "mismatched").length,
    };
  });
  rows.push({
    group: "total",
    source_count: rows.reduce((sum, row) => sum + row.source_count, 0),
    destination_count: rows.reduce((sum, row) => sum + row.destination_count, 0),
    matched: rows.reduce((sum, row) => sum + row.matched, 0),
    missing: rows.reduce((sum, row) => sum + row.missing, 0),
    mismatched: rows.reduce((sum, row) => sum + row.mismatched, 0),
  });

  return { rows, files };
}

function formatParityTable(rows: ParityRow[]): string {
  const headers = ["group", "source", "dest", "matched", "missing", "mismatched"];
  const body = rows.map((row) => [
    row.group,
    String(row.source_count),
    String(row.destination_count),
    String(row.matched),
    String(row.missing),
    String(row.mismatched),
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...body.map((row) => row[index].length)));
  const renderRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [
    "Parity",
    renderRow(headers),
    renderRow(widths.map((width) => "-".repeat(width))),
    ...body.map(renderRow),
  ].join("\n");
}

function sourceDirSummaries() {
  return sourceSpecs.map((spec) => ({
    group: spec.group,
    path: spec.dir,
    exists: fs.existsSync(spec.dir),
  }));
}

const migration = verify && !write ? null : migrate();
const errors = migration?.files.filter((file) => file.action === "error") || [];
if (migration?.pointer.action === "error") errors.push({
  group: "library-reports",
  filename: "MIGRATED.md",
  from: legacyReportsDir,
  to: migratedPointerPath,
  action: "error",
  error: migration.pointer.error,
});

if (verify) {
  const parity = buildParity();
  console.log(formatParityTable(parity.rows));
  console.log(JSON.stringify({
    mode: write ? "write+verify" : "verify",
    dry_run: !write,
    vault: vaultPath,
    destination_dir: reportsDir,
    source_dirs: sourceDirSummaries(),
    migration,
    parity: parity.rows,
    mismatches: parity.files.filter((file) => file.status !== "matched"),
  }, null, 2));
  const total = parity.rows.find((row) => row.group === "total");
  if (errors.length || (total && (total.missing > 0 || total.mismatched > 0))) process.exitCode = 1;
} else {
  const files = migration?.files || [];
  console.log(JSON.stringify({
    mode: write ? "write" : "dry-run",
    dry_run: !write,
    vault: vaultPath,
    destination_dir: reportsDir,
    source_dirs: sourceDirSummaries(),
    counts: {
      discovered: files.length,
      would_copy: files.filter((file) => file.action === "would_copy").length,
      copied: files.filter((file) => file.action === "copied").length,
      skipped_existing: files.filter((file) => file.action === "skipped_existing").length,
      errors: errors.length,
    },
    pointer: migration?.pointer,
    files,
  }, null, 2));
  if (errors.length) process.exitCode = 1;
}
