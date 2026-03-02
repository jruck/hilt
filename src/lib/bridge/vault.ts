import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getBridgeVaultPath, getActiveFolder } from "../db";

const VAULT_DIRS = [
  "lists/now",
  "briefings",
  "people",
  "projects",
  "thoughts",
];

let cachedVaultPath: string | null = null;
let ensured = false;

/** Create expected vault directories and seed a starter weekly list if empty. */
function ensureVaultStructure(vaultPath: string): void {
  if (ensured) return;
  ensured = true;

  for (const dir of VAULT_DIRS) {
    const full = path.join(vaultPath, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }

  // Seed a starter weekly list so Bridge doesn't 404 on first run
  const listsDir = path.join(vaultPath, "lists/now");
  const hasFiles = fs.readdirSync(listsDir).some(f => f.endsWith(".md"));
  if (!hasFiles) {
    const today = new Date();
    // Find the Monday of this week
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    const week = monday.toISOString().slice(0, 10);
    const content = `---\ntype: weekly-list\nweek: ${week}\n---\n\n# Week of ${week}\n\n## Tasks\n\n## Notes\n`;
    fs.writeFileSync(path.join(listsDir, `${week}.md`), content, "utf-8");
  }
}

export async function getVaultPath(): Promise<string> {
  if (cachedVaultPath) return cachedVaultPath;
  cachedVaultPath = await getBridgeVaultPath();
  ensureVaultStructure(cachedVaultPath);
  return cachedVaultPath;
}

export function getVaultPathSync(): string {
  if (cachedVaultPath) return cachedVaultPath;
  // Try active source folder, then legacy env var, then default
  const folder = getActiveFolder();
  if (folder) return folder;
  return process.env.BRIDGE_VAULT_PATH || path.join(os.homedir(), "work/bridge");
}

export async function readVaultFile(relativePath: string): Promise<string> {
  const vaultPath = await getVaultPath();
  const fullPath = path.join(vaultPath, relativePath);
  return fs.readFileSync(fullPath, "utf-8");
}

export async function writeVaultFileAtomic(relativePath: string, content: string): Promise<string> {
  const vaultPath = await getVaultPath();
  const fullPath = path.join(vaultPath, relativePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = fullPath + ".tmp." + Date.now();
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, fullPath);
  return fullPath;
}

export async function listVaultDir(relativePath: string): Promise<string[]> {
  const vaultPath = await getVaultPath();
  const fullPath = path.join(vaultPath, relativePath);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath).filter(f => !f.startsWith("."));
}
