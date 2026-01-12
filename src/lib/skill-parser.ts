/**
 * Skill Parser - Parses Claude skill files (.md) with YAML frontmatter
 *
 * Skills are markdown files with YAML frontmatter containing:
 * - name: string (required)
 * - description: string (required)
 * - hilt: object (optional) - Hilt-specific config
 *   - modal: string - Name of modal component to show
 *   - params: array - Parameter definitions for the modal
 *   - api: string - Hilt API this skill uses
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { SkillInfo, SkillHiltConfig, SkillParamDef } from "./types";

// YAML frontmatter regex - matches content between --- markers
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/**
 * Simple YAML parser for skill frontmatter
 * Handles the subset of YAML we need: strings, numbers, booleans, arrays, objects
 */
function parseYamlValue(value: string): unknown {
  const trimmed = value.trim();

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Plain string
  return trimmed;
}

/**
 * Parse YAML frontmatter into an object
 * This is a simplified parser that handles our skill frontmatter format
 */
function parseFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  let currentKey: string | null = null;
  let currentIndent = 0;
  let arrayItems: unknown[] = [];
  let inArray = false;
  let objectStack: { key: string; obj: Record<string, unknown>; indent: number }[] = [];

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Count leading spaces
    const indent = line.search(/\S/);
    const content = line.trim();

    // Array item (starts with -)
    if (content.startsWith("- ")) {
      const itemContent = content.slice(2).trim();

      // Check if it's a simple value or start of object
      if (itemContent.includes(":")) {
        // Object in array - parse key: value
        const colonIdx = itemContent.indexOf(":");
        const key = itemContent.slice(0, colonIdx).trim();
        const value = itemContent.slice(colonIdx + 1).trim();

        if (inArray && currentKey) {
          // Start new object in array
          const obj: Record<string, unknown> = {};
          obj[key] = value ? parseYamlValue(value) : "";
          arrayItems.push(obj);
          objectStack = [{ key: currentKey, obj, indent }];
        }
      } else {
        // Simple array item
        if (inArray) {
          arrayItems.push(parseYamlValue(itemContent));
        }
      }
      continue;
    }

    // Key: value pair
    if (content.includes(":")) {
      const colonIdx = content.indexOf(":");
      const key = content.slice(0, colonIdx).trim();
      const value = content.slice(colonIdx + 1).trim();

      // Check if we need to close array
      if (inArray && currentKey && indent <= currentIndent) {
        result[currentKey] = arrayItems;
        inArray = false;
        arrayItems = [];
      }

      // Check if we're inside an object in array
      if (objectStack.length > 0 && indent > objectStack[objectStack.length - 1].indent) {
        const parentObj = objectStack[objectStack.length - 1].obj;
        parentObj[key] = value ? parseYamlValue(value) : "";
        continue;
      }

      // Pop object stack if we've dedented
      while (objectStack.length > 0 && indent <= objectStack[objectStack.length - 1].indent) {
        objectStack.pop();
      }

      if (value === "") {
        // Could be start of nested object or array
        currentKey = key;
        currentIndent = indent;
        // Check next line to determine if array
        const nextLineIdx = lines.indexOf(line) + 1;
        if (nextLineIdx < lines.length) {
          const nextLine = lines[nextLineIdx].trim();
          if (nextLine.startsWith("-")) {
            inArray = true;
            arrayItems = [];
          } else {
            // Nested object
            result[key] = {};
          }
        }
      } else {
        // Simple key: value
        if (objectStack.length > 0) {
          objectStack[objectStack.length - 1].obj[key] = parseYamlValue(value);
        } else {
          result[key] = parseYamlValue(value);
        }
      }
    }
  }

  // Close any open array
  if (inArray && currentKey) {
    result[currentKey] = arrayItems;
  }

  return result;
}

/**
 * Parse hilt config from frontmatter
 */
function parseHiltConfig(hiltData: unknown): SkillHiltConfig | undefined {
  if (!hiltData || typeof hiltData !== "object") return undefined;

  const data = hiltData as Record<string, unknown>;
  const config: SkillHiltConfig = {};

  if (typeof data.modal === "string") {
    config.modal = data.modal;
  }

  if (typeof data.api === "string") {
    config.api = data.api;
  }

  if (Array.isArray(data.params)) {
    config.params = data.params.map((p: unknown) => {
      const param = p as Record<string, unknown>;
      return {
        name: String(param.name || ""),
        type: (param.type as SkillParamDef["type"]) || "text",
        default: param.default,
        required: Boolean(param.required),
        label: param.label ? String(param.label) : undefined,
        placeholder: param.placeholder ? String(param.placeholder) : undefined,
      };
    });
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Parse a skill file and extract metadata
 */
export async function parseSkillFile(
  filePath: string,
  source: "global" | "project"
): Promise<SkillInfo | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
      console.warn(`Skill file ${filePath} has no frontmatter`);
      return null;
    }

    const frontmatter = parseFrontmatter(match[1]);

    // Validate required fields
    if (typeof frontmatter.name !== "string" || !frontmatter.name) {
      console.warn(`Skill file ${filePath} missing required 'name' field`);
      return null;
    }

    if (typeof frontmatter.description !== "string" || !frontmatter.description) {
      console.warn(`Skill file ${filePath} missing required 'description' field`);
      return null;
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      path: filePath,
      source,
      hilt: parseHiltConfig(frontmatter.hilt),
    };
  } catch (error) {
    console.error(`Error parsing skill file ${filePath}:`, error);
    return null;
  }
}

/**
 * Get the full content of a skill file (for injection into prompts)
 */
export async function getSkillContent(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    // Remove frontmatter, return just the markdown body
    const withoutFrontmatter = content.replace(FRONTMATTER_REGEX, "").trim();
    return withoutFrontmatter;
  } catch (error) {
    console.error(`Error reading skill file ${filePath}:`, error);
    return null;
  }
}

/**
 * Scan a directory for skill files
 */
export async function scanSkillsDirectory(
  dirPath: string,
  source: "global" | "project"
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile() && entry.name.endsWith(".md")) {
        const skill = await parseSkillFile(fullPath, source);
        if (skill) {
          skills.push(skill);
        }
      } else if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subSkills = await scanSkillsDirectory(fullPath, source);
        skills.push(...subSkills);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read - that's fine
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Error scanning skills directory ${dirPath}:`, error);
    }
  }

  return skills;
}

/**
 * Get global skills directory path
 */
export function getGlobalSkillsPath(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

/**
 * Get project skills directory path
 */
export function getProjectSkillsPath(projectPath: string): string {
  return path.join(projectPath, ".claude", "skills");
}

/**
 * Discover all skills for a given scope
 * Merges global and project skills, with project skills taking precedence
 */
export async function discoverSkills(scope: string): Promise<SkillInfo[]> {
  const globalPath = getGlobalSkillsPath();
  const projectPath = getProjectSkillsPath(scope);

  // Scan both directories in parallel
  const [globalSkills, projectSkills] = await Promise.all([
    scanSkillsDirectory(globalPath, "global"),
    scanSkillsDirectory(projectPath, "project"),
  ]);

  // Merge, with project skills overriding global by name
  const skillMap = new Map<string, SkillInfo>();

  for (const skill of globalSkills) {
    skillMap.set(skill.name, skill);
  }

  for (const skill of projectSkills) {
    skillMap.set(skill.name, skill); // Override global
  }

  // Return sorted by name
  return Array.from(skillMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}
