/**
 * Skill Matcher Unit Tests
 *
 * These tests verify that the skill auto-selection logic works correctly.
 * The matcher looks at a prompt and suggests the best skill based on content.
 *
 * How these tests work:
 * 1. We create mock SkillInfo objects (fake skills)
 * 2. We call the matcher functions with test prompts
 * 3. We verify the output matches our expectations
 *
 * To run: npx vitest src/lib/__tests__/skill-matcher.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  matchSkillToPrompt,
  containsYouTubeUrl,
  containsUrl,
  extractFirstUrl,
  getMatchReason,
} from "../skill-matcher";
import type { SkillInfo } from "../types";

// Mock skills for testing - these simulate what the API would return
const mockSkills: SkillInfo[] = [
  {
    name: "process-reference",
    description: "Process URLs as references",
    path: "/mock/path/process-reference.md",
    source: "global",
    hilt: { api: "youtube-transcript" },
  },
  {
    name: "refine",
    description: "Discuss and refine ideas",
    path: "/mock/path/refine.md",
    source: "global",
  },
  {
    name: "ralph-loop",
    description: "Iterative refinement loop",
    path: "/mock/path/ralph-loop.md",
    source: "global",
    hilt: { modal: "RalphSetupModal" },
  },
];

describe("containsUrl", () => {
  // This function checks if a string contains any URL

  it("detects http URLs", () => {
    expect(containsUrl("Check out http://example.com")).toBe(true);
  });

  it("detects https URLs", () => {
    expect(containsUrl("Check out https://example.com")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(containsUrl("This is just plain text")).toBe(false);
  });

  it("returns false for partial URLs", () => {
    expect(containsUrl("Visit example.com for more")).toBe(false);
  });

  it("handles URLs in the middle of text", () => {
    expect(containsUrl("Go to https://foo.bar and then")).toBe(true);
  });
});

describe("containsYouTubeUrl", () => {
  // This function specifically checks for YouTube URLs

  it("detects youtube.com/watch URLs", () => {
    expect(containsYouTubeUrl("https://youtube.com/watch?v=abc123")).toBe(true);
  });

  it("detects www.youtube.com/watch URLs", () => {
    expect(containsYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
  });

  it("detects youtu.be short URLs", () => {
    expect(containsYouTubeUrl("https://youtu.be/abc123")).toBe(true);
  });

  it("detects YouTube Shorts URLs", () => {
    expect(containsYouTubeUrl("https://youtube.com/shorts/abc123")).toBe(true);
  });

  it("returns false for regular URLs", () => {
    expect(containsYouTubeUrl("https://example.com")).toBe(false);
  });

  it("returns false for non-YouTube video sites", () => {
    expect(containsYouTubeUrl("https://vimeo.com/123456")).toBe(false);
  });
});

describe("extractFirstUrl", () => {
  // This function extracts the first URL from text

  it("extracts URL from start of string", () => {
    expect(extractFirstUrl("https://foo.com is the site")).toBe("https://foo.com");
  });

  it("extracts URL from middle of string", () => {
    expect(extractFirstUrl("Check out https://bar.com please")).toBe("https://bar.com");
  });

  it("returns first URL when multiple present", () => {
    expect(extractFirstUrl("See https://first.com and https://second.com")).toBe("https://first.com");
  });

  it("returns null when no URL present", () => {
    expect(extractFirstUrl("No URLs here")).toBe(null);
  });

  it("handles complex URLs with paths", () => {
    const url = "https://example.com/path/to/page?query=value&foo=bar";
    expect(extractFirstUrl(`Visit ${url} for more`)).toBe(url);
  });
});

describe("matchSkillToPrompt", () => {
  // This is the main matching function - it takes a prompt and skills,
  // returns the best matching skill or null

  describe("URL detection → process-reference", () => {
    it("matches https URLs to process-reference skill", () => {
      const result = matchSkillToPrompt(
        "Please summarize https://example.com/article",
        mockSkills
      );
      expect(result?.name).toBe("process-reference");
    });

    it("matches YouTube URLs to process-reference skill", () => {
      const result = matchSkillToPrompt(
        "Watch this video https://youtube.com/watch?v=abc123",
        mockSkills
      );
      expect(result?.name).toBe("process-reference");
    });

    it("matches http URLs to process-reference skill", () => {
      const result = matchSkillToPrompt(
        "Check http://old-site.com",
        mockSkills
      );
      expect(result?.name).toBe("process-reference");
    });
  });

  describe("Keyword detection → refine", () => {
    // Tests for various keywords that should trigger the refine skill

    it("matches 'refine' keyword", () => {
      const result = matchSkillToPrompt("Help me refine this idea", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("matches 'discuss' keyword", () => {
      const result = matchSkillToPrompt("Let's discuss the approach", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("matches 'plan' keyword", () => {
      const result = matchSkillToPrompt("I need to plan this feature", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("matches 'brainstorm' keyword", () => {
      const result = matchSkillToPrompt("Let's brainstorm solutions", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("matches 'think about' keyword", () => {
      const result = matchSkillToPrompt("Help me think about this problem", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("matches 'what if' keyword", () => {
      const result = matchSkillToPrompt("What if we tried a different approach?", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("matches 'feedback on' keyword", () => {
      const result = matchSkillToPrompt("Give me feedback on this design", mockSkills);
      expect(result?.name).toBe("refine");
    });

    it("is case insensitive", () => {
      const result = matchSkillToPrompt("Let's DISCUSS this PLAN", mockSkills);
      expect(result?.name).toBe("refine");
    });
  });

  describe("No match cases", () => {
    // Tests for prompts that shouldn't match any skill

    it("returns null for plain implementation requests", () => {
      const result = matchSkillToPrompt(
        "Create a new user authentication system",
        mockSkills
      );
      expect(result).toBeNull();
    });

    it("returns null for simple tasks", () => {
      const result = matchSkillToPrompt("Fix the bug in login.ts", mockSkills);
      expect(result).toBeNull();
    });

    it("returns null for code requests", () => {
      const result = matchSkillToPrompt(
        "Write a function to sort an array",
        mockSkills
      );
      expect(result).toBeNull();
    });
  });

  describe("Edge cases", () => {
    it("returns null when skills array is empty", () => {
      const result = matchSkillToPrompt("https://example.com", []);
      expect(result).toBeNull();
    });

    it("returns null when matching skill doesn't exist", () => {
      // Skills array without process-reference
      const limitedSkills = mockSkills.filter(
        (s) => s.name !== "process-reference"
      );
      const result = matchSkillToPrompt("https://example.com", limitedSkills);
      expect(result).toBeNull();
    });

    it("URL takes priority over keywords", () => {
      // A prompt with both a URL and refine keywords
      const result = matchSkillToPrompt(
        "Let's discuss this article https://example.com",
        mockSkills
      );
      // URL detection runs first, so process-reference wins
      expect(result?.name).toBe("process-reference");
    });
  });
});

describe("getMatchReason", () => {
  // This function explains WHY a skill was matched (for UI display)

  const processRefSkill = mockSkills.find((s) => s.name === "process-reference")!;
  const refineSkill = mockSkills.find((s) => s.name === "refine")!;

  it("returns 'YouTube URL detected' for YouTube URLs", () => {
    const reason = getMatchReason(
      "Check https://youtube.com/watch?v=abc",
      processRefSkill
    );
    expect(reason).toBe("YouTube URL detected");
  });

  it("returns 'URL detected' for regular URLs", () => {
    const reason = getMatchReason("See https://example.com", processRefSkill);
    expect(reason).toBe("URL detected");
  });

  it("returns keyword reason for refine skill", () => {
    const reason = getMatchReason("Let's discuss this", refineSkill);
    expect(reason).toBe('Contains "discuss"');
  });

  it("returns null when no specific reason", () => {
    const reason = getMatchReason("Just do the thing", refineSkill);
    expect(reason).toBeNull();
  });
});
