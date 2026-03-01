import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getBridgeVaultPath, getActiveFolder } from "../db";

let cachedVaultPath: string | null = null;

export async function getVaultPath(): Promise<string> {
  if (cachedVaultPath) return cachedVaultPath;
  cachedVaultPath = await getBridgeVaultPath();
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
