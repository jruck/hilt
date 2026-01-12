/**
 * Skill Modal Resolver
 *
 * Maps hilt.modal names from skill frontmatter to actual React components.
 * This is a hardcoded map - add new modals here as needed.
 */

import type { SkillInfo } from "./types";

// Modal names that Hilt recognizes
export type KnownModal = "RalphSetupModal";

// Check if a skill requires a modal
export function skillRequiresModal(skill: SkillInfo): boolean {
  return Boolean(skill.hilt?.modal);
}

// Get the modal name for a skill
export function getSkillModalName(skill: SkillInfo): KnownModal | null {
  const modal = skill.hilt?.modal;
  if (!modal) return null;

  // Validate it's a known modal
  const knownModals: KnownModal[] = ["RalphSetupModal"];
  if (knownModals.includes(modal as KnownModal)) {
    return modal as KnownModal;
  }

  console.warn(`Unknown modal '${modal}' specified in skill '${skill.name}'`);
  return null;
}

// Check if a skill uses a specific Hilt API
export function skillUsesHiltApi(skill: SkillInfo, apiName: string): boolean {
  return skill.hilt?.api === apiName;
}

/**
 * Inject parameter values into skill content
 * Replaces {{paramName}} and {{#if paramName}}...{{else}}...{{/if}} patterns
 */
export function injectSkillParams(
  content: string,
  params: Record<string, unknown>
): string {
  let result = content;

  // Handle {{#if param}}...{{else}}...{{/if}} conditionals
  const ifElseRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(ifElseRegex, (_, paramName, ifContent, elseContent) => {
    const value = params[paramName];
    const isTruthy = value !== undefined && value !== null && value !== "" && value !== false;
    return isTruthy ? ifContent : elseContent;
  });

  // Handle {{#if param}}...{{/if}} (no else)
  const ifOnlyRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(ifOnlyRegex, (_, paramName, ifContent) => {
    const value = params[paramName];
    const isTruthy = value !== undefined && value !== null && value !== "" && value !== false;
    return isTruthy ? ifContent : "";
  });

  // Handle simple {{paramName}} replacements
  const simpleRegex = /\{\{(\w+)\}\}/g;
  result = result.replace(simpleRegex, (_, paramName) => {
    const value = params[paramName];
    if (value === undefined || value === null) return "";
    return String(value);
  });

  return result;
}
