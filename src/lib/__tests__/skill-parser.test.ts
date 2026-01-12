/**
 * Skill Parser Unit Tests
 *
 * These tests verify that skill files (.md with YAML frontmatter) are parsed correctly.
 * The parser extracts metadata like name, description, and Hilt configuration.
 *
 * Testing async file functions:
 * Since parseSkillFile reads from disk, we have two approaches:
 * 1. Create temporary test files (what we do here)
 * 2. Mock the file system (more complex, used in larger projects)
 *
 * To run: npx vitest src/lib/__tests__/skill-parser.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  parseSkillFile,
  getSkillContent,
  getGlobalSkillsPath,
  getProjectSkillsPath,
} from "../skill-parser";

// Create a temporary directory for test files
// This is a common pattern - create fixtures, test them, clean up
let testDir: string;

beforeAll(async () => {
  // Create temp directory for our test skill files
  testDir = path.join(os.tmpdir(), `skill-parser-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  // Clean up temp directory after tests
  try {
    await fs.rm(testDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

/**
 * Helper to create a test skill file
 * This writes a skill file to our temp directory so we can test parsing it
 */
async function createTestSkill(filename: string, content: string): Promise<string> {
  const filePath = path.join(testDir, filename);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("parseSkillFile", () => {
  // This function reads a .md file and extracts the YAML frontmatter

  describe("Basic parsing", () => {
    it("parses a simple skill file with name and description", async () => {
      // Create a minimal valid skill file
      const filePath = await createTestSkill(
        "simple.md",
        `---
name: test-skill
description: A test skill for unit testing
---

# Test Skill

This is the skill content.
`
      );

      const result = await parseSkillFile(filePath, "global");

      // Verify the parsed data
      expect(result).not.toBeNull();
      expect(result?.name).toBe("test-skill");
      expect(result?.description).toBe("A test skill for unit testing");
      expect(result?.source).toBe("global");
      expect(result?.path).toBe(filePath);
    });

    it("returns null for files without frontmatter", async () => {
      // A file with no --- markers
      const filePath = await createTestSkill(
        "no-frontmatter.md",
        `# Just a regular markdown file

No YAML frontmatter here.
`
      );

      const result = await parseSkillFile(filePath, "global");
      expect(result).toBeNull();
    });

    it("returns null when name is missing", async () => {
      const filePath = await createTestSkill(
        "no-name.md",
        `---
description: Missing the name field
---

Content here.
`
      );

      const result = await parseSkillFile(filePath, "global");
      expect(result).toBeNull();
    });

    it("returns null when description is missing", async () => {
      const filePath = await createTestSkill(
        "no-desc.md",
        `---
name: no-description
---

Content here.
`
      );

      const result = await parseSkillFile(filePath, "global");
      expect(result).toBeNull();
    });
  });

  describe("Hilt configuration parsing", () => {
    // Tests for the optional hilt: section in frontmatter

    it("parses hilt.modal configuration", async () => {
      const filePath = await createTestSkill(
        "with-modal.md",
        `---
name: modal-skill
description: A skill that needs a modal
hilt:
  modal: MyCustomModal
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "project");

      expect(result?.hilt).toBeDefined();
      expect(result?.hilt?.modal).toBe("MyCustomModal");
    });

    it("parses hilt.api configuration", async () => {
      const filePath = await createTestSkill(
        "with-api.md",
        `---
name: api-skill
description: A skill that uses an API
hilt:
  api: youtube-transcript
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "global");

      expect(result?.hilt?.api).toBe("youtube-transcript");
    });

    it("parses hilt.params array", async () => {
      const filePath = await createTestSkill(
        "with-params.md",
        `---
name: params-skill
description: A skill with parameters
hilt:
  modal: ConfigModal
  params:
    - name: maxIterations
      type: number
      default: 5
      label: Max Iterations
    - name: prompt
      type: text
      required: true
      placeholder: Enter your prompt
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "global");

      expect(result?.hilt?.params).toHaveLength(2);

      const param1 = result?.hilt?.params?.[0];
      expect(param1?.name).toBe("maxIterations");
      expect(param1?.type).toBe("number");
      expect(param1?.default).toBe(5);
      expect(param1?.label).toBe("Max Iterations");

      const param2 = result?.hilt?.params?.[1];
      expect(param2?.name).toBe("prompt");
      expect(param2?.type).toBe("text");
      expect(param2?.required).toBe(true);
      expect(param2?.placeholder).toBe("Enter your prompt");
    });

    it("handles skill with no hilt config", async () => {
      const filePath = await createTestSkill(
        "no-hilt.md",
        `---
name: plain-skill
description: No hilt configuration
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "global");

      expect(result?.hilt).toBeUndefined();
    });
  });

  describe("YAML value parsing", () => {
    // Tests for different YAML value types

    it("parses quoted strings correctly", async () => {
      const filePath = await createTestSkill(
        "quoted.md",
        `---
name: "quoted-name"
description: 'single quoted description'
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "global");
      expect(result?.name).toBe("quoted-name");
      expect(result?.description).toBe("single quoted description");
    });

    it("parses boolean values", async () => {
      const filePath = await createTestSkill(
        "booleans.md",
        `---
name: bool-test
description: Testing booleans
hilt:
  params:
    - name: isEnabled
      type: boolean
      default: true
      required: false
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "global");
      const param = result?.hilt?.params?.[0];
      expect(param?.default).toBe(true);
      expect(param?.required).toBe(false);
    });

    it("parses numeric values", async () => {
      const filePath = await createTestSkill(
        "numbers.md",
        `---
name: num-test
description: Testing numbers
hilt:
  params:
    - name: count
      type: number
      default: 42
---

Content.
`
      );

      const result = await parseSkillFile(filePath, "global");
      const param = result?.hilt?.params?.[0];
      expect(param?.default).toBe(42);
    });
  });

  describe("Error handling", () => {
    it("returns null for non-existent file", async () => {
      const result = await parseSkillFile(
        "/nonexistent/path/skill.md",
        "global"
      );
      expect(result).toBeNull();
    });
  });
});

describe("getSkillContent", () => {
  // This function returns the skill body (without frontmatter) for prompt injection

  it("returns content without frontmatter", async () => {
    const filePath = await createTestSkill(
      "content-test.md",
      `---
name: content-skill
description: Testing content extraction
---

# Skill Instructions

This is the actual skill content that gets injected into prompts.

## Section 1

More content here.
`
    );

    const content = await getSkillContent(filePath);

    expect(content).not.toBeNull();
    expect(content).not.toContain("---");
    expect(content).not.toContain("name: content-skill");
    expect(content).toContain("# Skill Instructions");
    expect(content).toContain("## Section 1");
  });

  it("returns null for non-existent file", async () => {
    const content = await getSkillContent("/nonexistent/file.md");
    expect(content).toBeNull();
  });
});

describe("Path helpers", () => {
  // These functions generate the expected paths for skill directories

  it("getGlobalSkillsPath returns ~/.claude/skills", () => {
    const globalPath = getGlobalSkillsPath();
    const expected = path.join(os.homedir(), ".claude", "skills");
    expect(globalPath).toBe(expected);
  });

  it("getProjectSkillsPath returns {project}/.claude/skills", () => {
    const projectPath = getProjectSkillsPath("/home/user/my-project");
    expect(projectPath).toBe("/home/user/my-project/.claude/skills");
  });
});
