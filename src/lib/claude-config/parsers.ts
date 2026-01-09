import * as fs from "fs/promises";
import * as yaml from "yaml";
import {
  ConfigFile,
  ConfigFileContent,
  CommandConfig,
  SkillConfig,
  SettingsConfig,
  HookConfig,
  MCPServerConfig,
  HookMatcher,
} from "./types";

// Parse frontmatter from markdown files
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = yaml.parse(match[1]) || {};
    return { frontmatter, body: match[2].trim() };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export async function readConfigFile(file: ConfigFile): Promise<ConfigFileContent> {
  // Don't read sensitive files
  if (file.type === "env") {
    return {
      ...file,
      content: null,
      isSensitive: true,
      isEditable: false,
    };
  }

  // Can't read non-existent files
  if (!file.exists) {
    return {
      ...file,
      content: null,
      isEditable: file.layer !== "system",
    };
  }

  try {
    const content = await fs.readFile(file.path, "utf-8");
    const isEditable = file.layer !== "system";

    // Parse based on file type
    if (file.type === "settings" || file.path.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        return {
          ...file,
          content,
          parsed: { frontmatter: parsed },
          isEditable,
        };
      } catch {
        return {
          ...file,
          content,
          isEditable,
        };
      }
    }

    if (file.path.endsWith(".md")) {
      const { frontmatter, body } = parseFrontmatter(content);
      return {
        ...file,
        content,
        parsed: { frontmatter, body },
        description: frontmatter.description as string | undefined,
        isEditable,
      };
    }

    // Hook scripts - just return content
    return {
      ...file,
      content,
      isEditable,
    };
  } catch {
    return {
      ...file,
      content: null,
      isEditable: false,
    };
  }
}

export function parseCommand(file: ConfigFileContent): CommandConfig | null {
  if (!file.content || file.type !== "command") return null;

  const { frontmatter, body } = parseFrontmatter(file.content);
  const name = file.name.replace(/\.md$/, "");

  return {
    name,
    path: file.path,
    layer: file.layer,
    description: frontmatter.description as string | undefined,
    argumentHint: frontmatter["argument-hint"] as string | undefined,
    allowedTools: frontmatter["allowed-tools"] as string[] | undefined,
    model: frontmatter.model as string | undefined,
    body: body || "",
  };
}

export function parseSkill(file: ConfigFileContent): SkillConfig | null {
  if (!file.content || file.type !== "skill") return null;

  const { frontmatter } = parseFrontmatter(file.content);

  return {
    name: (frontmatter.name as string) || file.name,
    path: file.path,
    layer: file.layer,
    description: frontmatter.description as string | undefined,
    allowedTools: frontmatter["allowed-tools"] as string[] | undefined,
  };
}

export function parseSettings(file: ConfigFileContent): SettingsConfig | null {
  if (!file.content || file.type !== "settings") return null;

  try {
    return JSON.parse(file.content) as SettingsConfig;
  } catch {
    return null;
  }
}

export function extractHooks(settings: SettingsConfig, source: string): HookConfig[] {
  const hooks: HookConfig[] = [];
  const rawHooks = settings.hooks as Record<string, HookMatcher[]> | undefined;

  if (!rawHooks) return hooks;

  for (const [type, configs] of Object.entries(rawHooks)) {
    if (!Array.isArray(configs)) continue;

    for (const config of configs) {
      const hookList = config.hooks || [];
      for (const hook of hookList) {
        if (hook.command) {
          hooks.push({
            type: type as HookConfig["type"],
            matcher: config.matcher || "",
            command: hook.command,
            source,
          });
        }
      }
    }
  }

  return hooks;
}

export function extractMCPServers(settings: SettingsConfig, source: string): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];
  const rawServers = settings.mcp?.servers;

  if (!rawServers) return servers;

  for (const [name, config] of Object.entries(rawServers)) {
    servers.push({
      name,
      command: config.command,
      args: config.args,
      env: config.env,
      source,
    });
  }

  return servers;
}
