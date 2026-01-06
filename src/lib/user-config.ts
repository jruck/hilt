import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(process.cwd(), "data");
const CONFIG_FILE = join(CONFIG_DIR, "user-config.json");

export interface UserConfig {
  firecrawlApiKey?: string;
  // Future: other API keys, preferences
}

/**
 * Get the current user configuration.
 * Returns empty object if config doesn't exist yet.
 */
export function getUserConfig(): UserConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return {};
    }
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as UserConfig;
  } catch {
    return {};
  }
}

/**
 * Update user configuration (merges with existing).
 */
export function setUserConfig(config: Partial<UserConfig>): void {
  // Ensure data directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const current = getUserConfig();
  const updated = { ...current, ...config };

  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf-8");
}

/**
 * Check if Firecrawl API key is configured.
 */
export function hasFirecrawlKey(): boolean {
  const config = getUserConfig();
  return !!config.firecrawlApiKey && config.firecrawlApiKey.length > 0;
}

/**
 * Get Firecrawl API key (or undefined if not set).
 */
export function getFirecrawlKey(): string | undefined {
  return getUserConfig().firecrawlApiKey;
}
