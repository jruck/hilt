/**
 * Ralph Wiggum Plugin Detection (Server-side only)
 *
 * This file uses Node.js fs/path/os modules and can only be
 * imported in server components or API routes.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RalphPluginStatus } from "./ralph";

/**
 * Check if Ralph Wiggum plugin is installed
 */
export function checkRalphPlugin(): RalphPluginStatus {
  const homeDir = os.homedir();
  const pluginsDir = path.join(homeDir, ".claude", "plugins");

  // Check common plugin locations
  const pluginPaths = [
    path.join(pluginsDir, "ralph-wiggum"),
    path.join(pluginsDir, "anthropics-ralph-wiggum"),
    path.join(pluginsDir, "anthropics", "ralph-wiggum"),
  ];

  // Also scan the plugins directory for any folder containing "ralph"
  try {
    if (fs.existsSync(pluginsDir)) {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().includes("ralph")) {
          const fullPath = path.join(pluginsDir, entry.name);
          if (!pluginPaths.includes(fullPath)) {
            pluginPaths.push(fullPath);
          }
        }
      }
    }
  } catch {
    // Ignore scan errors
  }

  for (const pluginPath of pluginPaths) {
    if (fs.existsSync(pluginPath)) {
      // Try to read version from package.json or manifest
      const manifestPath = path.join(pluginPath, ".claude-plugin", "manifest.json");
      const packagePath = path.join(pluginPath, "package.json");

      let version: string | undefined;

      try {
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          version = manifest.version;
        } else if (fs.existsSync(packagePath)) {
          const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
          version = pkg.version;
        }
      } catch {
        // Ignore version read errors
      }

      return {
        installed: true,
        pluginPath,
        version,
      };
    }
  }

  return { installed: false };
}
