import type { AttentionJudgment, ConnectionSuggestion } from "./types";

export type ConnectionPassState = "has" | "abstained" | "never";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function connectionSuggestionsFromFrontmatter(frontmatter: Record<string, unknown>): ConnectionSuggestion[] {
  return Array.isArray(frontmatter.connection_suggestions)
    ? frontmatter.connection_suggestions.filter((item): item is ConnectionSuggestion => (
      Boolean(item)
      && typeof item === "object"
      && typeof (item as ConnectionSuggestion).label === "string"
    ))
    : [];
}

export function attentionJudgmentFromFrontmatter(frontmatter: Record<string, unknown>): AttentionJudgment | null {
  const value = frontmatter.attention_judgment;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const tier = record.tier === "high" || record.tier === "medium" || record.tier === "low"
    ? record.tier
    : null;
  if (!tier) return null;
  return { tier, reason: stringValue(record.reason) || "" };
}

export function connectionPassEvidence(frontmatter: Record<string, unknown>): string[] {
  const evidence: string[] = [];
  if (connectionSuggestionsFromFrontmatter(frontmatter).length > 0) evidence.push("connection_suggestions");
  if (stringValue(frontmatter.reconnected_at)) evidence.push("reconnected_at");
  if (stringValue(frontmatter.connection_reasoning)) evidence.push("connection_reasoning");
  if (attentionJudgmentFromFrontmatter(frontmatter)) evidence.push("attention_judgment");
  return evidence;
}

export function hasConnectionPass(frontmatter: Record<string, unknown>): boolean {
  return connectionPassEvidence(frontmatter).length > 0;
}

export function connectionPassState(frontmatter: Record<string, unknown>): ConnectionPassState {
  const connections = connectionSuggestionsFromFrontmatter(frontmatter);
  if (connections.length > 0) return "has";
  return hasConnectionPass(frontmatter) ? "abstained" : "never";
}
