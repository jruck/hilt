/**
 * Skill Matcher - Auto-selects the best skill for a given prompt
 *
 * Uses heuristics to suggest which skill might be most appropriate:
 * - URL detection → process-reference
 * - Planning/discussion keywords → refine
 * - Default → no suggestion (plain run)
 */

import type { SkillInfo } from "./types";

// URL patterns to detect
const URL_REGEX = /https?:\/\/[^\s]+/i;
const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/i;

// Keywords that suggest refinement/planning
const REFINE_KEYWORDS = [
  "refine",
  "discuss",
  "plan",
  "think about",
  "explore",
  "brainstorm",
  "consider",
  "what if",
  "how should",
  "let's talk",
  "help me think",
  "feedback on",
];

/**
 * Match a prompt to the best skill
 * Returns the skill if a good match is found, null otherwise
 */
export function matchSkillToPrompt(
  prompt: string,
  skills: SkillInfo[]
): SkillInfo | null {
  const lowerPrompt = prompt.toLowerCase();

  // Check for URL - suggest process-reference
  if (URL_REGEX.test(prompt)) {
    const processRef = skills.find((s) => s.name === "process-reference");
    if (processRef) {
      return processRef;
    }
  }

  // Check for refine keywords
  const hasRefineKeyword = REFINE_KEYWORDS.some((keyword) =>
    lowerPrompt.includes(keyword)
  );
  if (hasRefineKeyword) {
    const refine = skills.find((s) => s.name === "refine");
    if (refine) {
      return refine;
    }
  }

  // No strong match - return null (plain run)
  return null;
}

/**
 * Check if a prompt contains a YouTube URL
 */
export function containsYouTubeUrl(prompt: string): boolean {
  return YOUTUBE_REGEX.test(prompt);
}

/**
 * Check if a prompt contains any URL
 */
export function containsUrl(prompt: string): boolean {
  return URL_REGEX.test(prompt);
}

/**
 * Extract the first URL from a prompt
 */
export function extractFirstUrl(prompt: string): string | null {
  const match = prompt.match(URL_REGEX);
  return match ? match[0] : null;
}

/**
 * Get match reason for UI display
 */
export function getMatchReason(
  prompt: string,
  skill: SkillInfo
): string | null {
  if (skill.name === "process-reference" && containsUrl(prompt)) {
    if (containsYouTubeUrl(prompt)) {
      return "YouTube URL detected";
    }
    return "URL detected";
  }

  if (skill.name === "refine") {
    const lowerPrompt = prompt.toLowerCase();
    const matchedKeyword = REFINE_KEYWORDS.find((k) => lowerPrompt.includes(k));
    if (matchedKeyword) {
      return `Contains "${matchedKeyword}"`;
    }
  }

  return null;
}
