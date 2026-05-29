import * as fs from "fs";
import * as path from "path";
import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import { getGranolaRemoteHost, getGranolaVaultPath } from "./config";
import type { GranolaObsidianHandoffStatus, GranolaObsidianVaultStatus } from "./types";

const execFileAsync = promisify(execFile);
const PLUGIN_ID = "granola-sync";

export async function getObsidianHandoffStatus(): Promise<GranolaObsidianHandoffStatus> {
  const vaultPath = getGranolaVaultPath();
  const [local, remote] = await Promise.all([
    inspectVault("local", vaultPath),
    inspectRemoteVault(getGranolaRemoteHost(), vaultPath),
  ]);
  const statusesReadable = !local.error && !remote.error;
  return {
    safeForProductionWrites: Boolean(statusesReadable && !local.pluginEnabled && !local.pluginSyncEnabled && !remote.pluginEnabled && !remote.pluginSyncEnabled),
    local,
    remote,
  };
}

export async function assertObsidianGranolaSyncDisabled(): Promise<GranolaObsidianHandoffStatus> {
  const status = await getObsidianHandoffStatus();
  if (!status.safeForProductionWrites) {
    throw new Error("Obsidian Granola Sync is still enabled; production Hilt Granola writes are blocked.");
  }
  return status;
}

export async function disableObsidianGranolaSync(options: { dryRun?: boolean } = {}): Promise<GranolaObsidianHandoffStatus> {
  const vaultPath = getGranolaVaultPath();
  if (!options.dryRun) {
    quitObsidianLocal();
    await quitObsidianRemote(getGranolaRemoteHost());
    disablePluginLocal(vaultPath);
    await mutateRemotePlugin(getGranolaRemoteHost(), vaultPath, "disable");
  }
  return getObsidianHandoffStatus();
}

export async function restoreObsidianGranolaSync(options: { dryRun?: boolean } = {}): Promise<GranolaObsidianHandoffStatus> {
  const vaultPath = getGranolaVaultPath();
  if (!options.dryRun) {
    restorePluginLocal(vaultPath);
    await mutateRemotePlugin(getGranolaRemoteHost(), vaultPath, "restore");
  }
  return getObsidianHandoffStatus();
}

async function inspectRemoteVault(host: string, vaultPath: string): Promise<GranolaObsidianVaultStatus> {
  try {
    const script = statusScript();
    const stdout = await runRemotePython(host, vaultPath, script);
    return { ...(JSON.parse(stdout) as GranolaObsidianVaultStatus), host };
  } catch (error) {
    return emptyStatus(host, vaultPath, error instanceof Error ? error.message : String(error));
  }
}

async function mutateRemotePlugin(host: string, vaultPath: string, action: "disable" | "restore"): Promise<void> {
  const script = mutationScript(action);
  await runRemotePython(host, vaultPath, script);
}

function runRemotePython(host: string, vaultPath: string, script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [host, "/usr/bin/python3", "-", vaultPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `remote python exited with code ${code}`));
    });
    child.stdin.end(script);
  });
}

function inspectVault(host: string, vaultPath: string): GranolaObsidianVaultStatus {
  try {
    const obsidianRunning = isObsidianRunningLocal();
    const obsidianDir = path.join(vaultPath, ".obsidian");
    const communityPluginsPath = path.join(obsidianDir, "community-plugins.json");
    const pluginDataPath = path.join(obsidianDir, "plugins", PLUGIN_ID, "data.json");
    const pluginManifestPath = path.join(obsidianDir, "plugins", PLUGIN_ID, "manifest.json");
    const plugins = readJson<string[]>(communityPluginsPath, []);
    const pluginData = readJson<Record<string, unknown>>(pluginDataPath, {});
    return {
      host,
      vaultPath,
      obsidianRunning,
      pluginInstalled: fs.existsSync(pluginManifestPath),
      pluginEnabled: plugins.includes(PLUGIN_ID),
      pluginSyncEnabled: typeof pluginData.isSyncEnabled === "boolean" ? pluginData.isSyncEnabled : null,
      communityPluginsPath: fs.existsSync(communityPluginsPath) ? communityPluginsPath : null,
      pluginDataPath: fs.existsSync(pluginDataPath) ? pluginDataPath : null,
      error: null,
    };
  } catch (error) {
    return emptyStatus(host, vaultPath, error instanceof Error ? error.message : String(error));
  }
}

function disablePluginLocal(vaultPath: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const communityPluginsPath = path.join(vaultPath, ".obsidian", "community-plugins.json");
  const pluginDataPath = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID, "data.json");
  if (fs.existsSync(communityPluginsPath)) {
    backupFile(communityPluginsPath, stamp);
    const plugins = readJson<string[]>(communityPluginsPath, []);
    writeJson(communityPluginsPath, plugins.filter((plugin) => plugin !== PLUGIN_ID));
  }
  if (fs.existsSync(pluginDataPath)) {
    backupFile(pluginDataPath, stamp);
    const data = readJson<Record<string, unknown>>(pluginDataPath, {});
    writeJson(pluginDataPath, { ...data, isSyncEnabled: false });
  }
}

function restorePluginLocal(vaultPath: string): void {
  restoreNewestBackup(path.join(vaultPath, ".obsidian", "community-plugins.json"));
  restoreNewestBackup(path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID, "data.json"));
}

function quitObsidianLocal(): void {
  try {
    execFileSync("osascript", ["-e", 'tell application "Obsidian" to quit'], { stdio: "ignore" });
  } catch {
    // Obsidian may not be running or Apple Events may not be available.
  }
}

async function quitObsidianRemote(host: string): Promise<void> {
  try {
    await execFileAsync("ssh", [host, "osascript", "-e", 'tell application "Obsidian" to quit']);
  } catch {
    // Same as local: best effort.
  }
}

function isObsidianRunningLocal(): boolean {
  try {
    const output = execFileSync("ps", ["-axo", "comm,args"], { encoding: "utf-8" });
    return /Obsidian\.app|\/Obsidian\b/i.test(output);
  } catch {
    return false;
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function backupFile(filePath: string, stamp: string): void {
  fs.copyFileSync(filePath, `${filePath}.hilt-granola-handoff-${stamp}.bak`);
}

function restoreNewestBackup(filePath: string): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  if (!fs.existsSync(dir)) return;
  const newest = fs.readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.hilt-granola-handoff-`) && name.endsWith(".bak"))
    .sort()
    .pop();
  if (newest) fs.copyFileSync(path.join(dir, newest), filePath);
}

function emptyStatus(host: string, vaultPath: string, error: string | null): GranolaObsidianVaultStatus {
  return {
    host,
    vaultPath,
    obsidianRunning: false,
    pluginInstalled: false,
    pluginEnabled: false,
    pluginSyncEnabled: null,
    communityPluginsPath: null,
    pluginDataPath: null,
    error,
  };
}

function statusScript(): string {
  return String.raw`
import json, os, subprocess, sys
vault = sys.argv[1]
plugin_id = "granola-sync"
def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback
def running():
    try:
        out = subprocess.check_output(["ps", "-axo", "comm,args"], text=True)
        return "Obsidian.app" in out or "/Obsidian " in out
    except Exception:
        return False
obs = os.path.join(vault, ".obsidian")
community = os.path.join(obs, "community-plugins.json")
data_path = os.path.join(obs, "plugins", plugin_id, "data.json")
manifest = os.path.join(obs, "plugins", plugin_id, "manifest.json")
plugins = read_json(community, [])
data = read_json(data_path, {})
print(json.dumps({
    "host": "remote",
    "vaultPath": vault,
    "obsidianRunning": running(),
    "pluginInstalled": os.path.exists(manifest),
    "pluginEnabled": plugin_id in plugins,
    "pluginSyncEnabled": data.get("isSyncEnabled") if isinstance(data.get("isSyncEnabled"), bool) else None,
    "communityPluginsPath": community if os.path.exists(community) else None,
    "pluginDataPath": data_path if os.path.exists(data_path) else None,
    "error": None,
}))
`;
}

function mutationScript(action: "disable" | "restore"): string {
  if (action === "restore") {
    return String.raw`
import os, shutil, sys
vault = sys.argv[1]
targets = [
    os.path.join(vault, ".obsidian", "community-plugins.json"),
    os.path.join(vault, ".obsidian", "plugins", "granola-sync", "data.json"),
]
for target in targets:
    directory = os.path.dirname(target)
    base = os.path.basename(target)
    if not os.path.isdir(directory):
        continue
    backups = sorted([name for name in os.listdir(directory) if name.startswith(base + ".hilt-granola-handoff-") and name.endswith(".bak")])
    if backups:
        shutil.copyfile(os.path.join(directory, backups[-1]), target)
`;
  }
  return String.raw`
import json, os, shutil, sys, datetime
vault = sys.argv[1]
plugin_id = "granola-sync"
stamp = datetime.datetime.utcnow().isoformat().replace(":", "-").replace(".", "-")
community = os.path.join(vault, ".obsidian", "community-plugins.json")
data_path = os.path.join(vault, ".obsidian", "plugins", plugin_id, "data.json")
def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback
def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
def backup(path):
    if os.path.exists(path):
        shutil.copyfile(path, path + ".hilt-granola-handoff-" + stamp + ".bak")
if os.path.exists(community):
    backup(community)
    plugins = [p for p in read_json(community, []) if p != plugin_id]
    write_json(community, plugins)
if os.path.exists(data_path):
    backup(data_path)
    data = read_json(data_path, {})
    data["isSyncEnabled"] = False
    write_json(data_path, data)
`;
}
