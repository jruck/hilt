import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Ralph Wiggum Plugin Integration
 *
 * Utilities for detecting the Ralph Wiggum plugin and generating
 * loop commands for iterative AI development workflows.
 */

// Ralph loop configuration
export interface RalphConfig {
  prompt: string;
  maxIterations: number;
  completionPromise: string;
}

// Ralph loop state for active sessions
export interface RalphLoopState {
  active: boolean;
  currentIteration: number;
  maxIterations: number;
  completionPromise: string;
  startedAt: string;
}

// Plugin detection result
export interface RalphPluginStatus {
  installed: boolean;
  pluginPath?: string;
  version?: string;
}

// Default values
export const RALPH_DEFAULTS = {
  maxIterations: 10,
  completionPromise: "RALPH_COMPLETE: All tasks finished successfully",
};

/**
 * Check if Ralph Wiggum plugin is installed
 */
export function checkRalphPlugin(): RalphPluginStatus {
  const homeDir = os.homedir();

  // Check common plugin locations
  const pluginPaths = [
    path.join(homeDir, ".claude", "plugins", "ralph-wiggum"),
    path.join(homeDir, ".claude", "plugins", "anthropics-ralph-wiggum"),
  ];

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

/**
 * Escape a prompt string for use in shell command
 */
function escapeForShell(str: string): string {
  // Replace backslashes first, then double quotes
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

/**
 * Generate the /ralph-loop command string
 */
export function generateRalphCommand(config: RalphConfig): string {
  const escapedPrompt = escapeForShell(config.prompt);
  const escapedPromise = escapeForShell(config.completionPromise);

  return `/ralph-loop "${escapedPrompt}" --max-iterations ${config.maxIterations} --completion-promise "${escapedPromise}"`;
}

/**
 * Generate a PRD refinement prompt from a seed idea
 */
export function generatePrdPrompt(seedIdea: string): string {
  return `I have a task I want to run through Ralph Wiggum's iterative loop methodology:

---
${seedIdea}
---

Help me create a proper PRD (Product Requirements Document) for this task. We need:

1. **Clear Objective**: What exactly should be built/achieved?
2. **Success Criteria**: Specific, testable conditions (e.g., tests must pass, linter clean, feature works as specified)
3. **Scope Boundaries**: What's in scope, what's explicitly out of scope
4. **Technical Approach**: High-level implementation strategy
5. **Completion Promise**: A specific string I should output ONLY when the task is truly complete

IMPORTANT GUIDELINES:
- Success criteria should be automatically verifiable (tests, builds, linter checks)
- The completion promise should follow this pattern:
  - "RALPH_COMPLETE: All tests passing"
  - "RALPH_COMPLETE: Feature X implemented and documented"
- Be specific - vague requirements lead to infinite loops

Ask me clarifying questions if needed to ensure the PRD is complete and unambiguous.

When the PRD is finalized, output it in this exact format:

\`\`\`ralph-prd
# [Task Title]

## Objective
[Clear description]

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Scope
**In Scope:**
- Item 1
- Item 2

**Out of Scope:**
- Item 1

## Technical Approach
[High-level approach]

## Completion Promise
RALPH_COMPLETE: [specific completion text]
\`\`\``;
}

/**
 * Parse a PRD from Claude's response to extract Ralph config
 */
export function parsePrdResponse(response: string): Partial<RalphConfig> | null {
  // Look for the ralph-prd code block
  const prdMatch = response.match(/```ralph-prd\n([\s\S]*?)```/);
  if (!prdMatch) {
    return null;
  }

  const prd = prdMatch[1];

  // Extract completion promise
  const promiseMatch = prd.match(/## Completion Promise\s*\n\s*(.+)/);
  const completionPromise = promiseMatch
    ? promiseMatch[1].trim()
    : RALPH_DEFAULTS.completionPromise;

  // The full PRD becomes the prompt
  return {
    prompt: prd.trim(),
    completionPromise,
  };
}

/**
 * Parse iteration progress from terminal output
 * Returns [current, max] or null if not found
 */
export function parseIterationProgress(output: string): [number, number] | null {
  // Common patterns Ralph might output
  const patterns = [
    /iteration\s+(\d+)\s*\/\s*(\d+)/i,
    /loop\s+(\d+)\s*of\s*(\d+)/i,
    /\[(\d+)\/(\d+)\]/,
    /ralph.*?(\d+)\s*\/\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
  }

  return null;
}

/**
 * Check if output indicates Ralph loop completion
 */
export function isRalphComplete(output: string, completionPromise: string): boolean {
  return output.includes(completionPromise);
}

/**
 * Installation command for Ralph plugin
 */
export const RALPH_INSTALL_COMMAND = "claude plugins install anthropics/ralph-wiggum";
