import fs from "fs";
import os from "os";
import path from "path";
import { settingsSchema } from "./contracts";
import type { Settings, SettingsMetadata } from "./types";

export function isLocalAppsEnabled(): boolean {
  return process.env.HILT_LOCAL_APPS_ENABLED === "true";
}

export function isPreviewCaptureEnabled(): boolean {
  return process.env.HILT_LOCAL_APPS_PREVIEWS === "true";
}

export function isPeerDiscoveryEnabled(): boolean {
  return process.env.HILT_LOCAL_APPS_PEERS !== "false";
}

export function localAppsDataDir(): string {
  const base = process.env.DATA_DIR || path.join(os.homedir(), ".hilt");
  return path.join(base, "local-apps");
}

export function settingsPath(): string {
  return path.join(localAppsDataDir(), "settings.json");
}

export function previewDir(): string {
  return path.join(localAppsDataDir(), "previews");
}

export function defaultSettings(): Settings {
  const home = os.homedir();
  const devRoots = ["work", "code", "Code", "Projects", "Development", "dev"]
    .map((part) => path.join(home, part))
    .filter((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });

  return {
    dev_roots: devRoots,
    rules: [],
    scan_interval_ms: 5_000,
    api_port: 47_878,
    ai: {
      enabled: true,
      endpoint: "http://127.0.0.1:11434",
      model: "llama3.2",
    },
  };
}

function portAuthoritySettingsPath(): string {
  return path.join(os.homedir(), "Library", "Application Support", "Port Authority", "settings.json");
}

function readSettingsFile(filePath: string): Settings | null {
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(localAppsDataDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

export function loadSettings(): Settings {
  const ownPath = settingsPath();
  const own = readSettingsFile(ownPath);
  if (own) return own;

  const imported = readSettingsFile(portAuthoritySettingsPath());
  if (imported) {
    saveSettings(imported);
    return imported;
  }

  const settings = defaultSettings();
  saveSettings(settings);
  return settings;
}

export function settingsMetadata(): SettingsMetadata {
  return {
    settings: loadSettings(),
    api_url: null,
    settings_path: settingsPath(),
    preview_dir: previewDir(),
  };
}
