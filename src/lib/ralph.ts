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
  // The completion promise is the text inside <promise> tags
  completionPromise: "TASK_COMPLETE",
};

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
 *
 * The prompt should instruct Claude to output <promise>TEXT</promise> when done.
 * The --completion-promise flag specifies what TEXT to look for.
 */
export function generateRalphCommand(config: RalphConfig): string {
  const escapedPromise = escapeForShell(config.completionPromise);

  // Append the promise instruction to the prompt if not already present
  let fullPrompt = config.prompt;
  if (!fullPrompt.includes("<promise>")) {
    fullPrompt += `\n\nWhen the task is fully complete and verified, output: <promise>${config.completionPromise}</promise>`;
  }

  const escapedPrompt = escapeForShell(fullPrompt);

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
5. **Completion Promise**: A short identifier that signals the task is done

IMPORTANT GUIDELINES:
- Success criteria should be automatically verifiable (tests, builds, linter checks)
- The completion promise should be a short, unique identifier like:
  - "TESTS_PASSING"
  - "FEATURE_COMPLETE"
  - "REFACTOR_DONE"
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
[SHORT_IDENTIFIER]
\`\`\`

Note: The completion promise will be wrapped in \`<promise>IDENTIFIER</promise>\` tags when running the loop.`;
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
 * Looks for <promise>TEXT</promise> pattern
 */
export function isRalphComplete(output: string, completionPromise: string): boolean {
  // Check for the promise tag format
  const promiseTagPattern = new RegExp(`<promise>\\s*${escapeRegex(completionPromise)}\\s*</promise>`, "i");
  if (promiseTagPattern.test(output)) {
    return true;
  }
  // Fallback to raw text match
  return output.includes(completionPromise);
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate the /cancel-ralph command
 */
export function generateCancelCommand(): string {
  return "/cancel-ralph";
}

/**
 * Installation command for Ralph plugin
 */
export const RALPH_INSTALL_COMMAND = "claude plugins install anthropics/ralph-wiggum";
