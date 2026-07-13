import { listLibraryArtifactDetails } from "./library";
import { listStoredFeedback } from "./library-feedback";
import { readMutedSenders } from "./library-mute";
import { friendlyNewsletterSender } from "./taxonomy";
import { evaluateLibrary } from "./recommendations";
import { connectionPassState, connectionSuggestionsFromFrontmatter } from "./connection-state";
import { contentTypeForArtifact, type LibraryContentType } from "./content-type";

/**
 * Workbench data — a flat, inspectable row per library item exposing every signal across the pipeline
 * (digest → reweave → connections → eval) so the steps and systems can be troubleshot side by side.
 * Read-only; computed on demand.
 */
export interface WorkbenchRow {
  id: string;
  title: string;
  url: string;
  source: string;
  channel: string;
  created_at: string;
  // disposition + eval
  disposition: "study" | "keep";
  lifecycle: import("./types").LibraryLifecycle;
  worth: number | null;
  relevance: number | null;
  substance: number | null;
  why: string | null;
  // pipeline / generation status
  pipeline_version: string | null;
  digested_with: string | null;
  reweave_pending: boolean;
  connection_state: "has" | "abstained" | "never";
  connections: number;
  substance_graded: boolean;
  youtube_clip_policy: string | null;
  youtube_content_form: string | null;
  content_type: LibraryContentType;
  attention: import("./types").LibraryArtifactAttentionKind | null;
}

export interface WorkbenchData {
  rows: WorkbenchRow[];
  facets: Record<string, Record<string, number>>;
  /** Sorted worth values of scored study items — lets the UI count "≥ threshold" instantly. */
  worths: number[];
  /** Muted newsletter senders (config-driven; items deleted), surfaced for the sidebar's "Show muted". */
  muted: Array<{ email: string; name: string }>;
  total: number;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildWorkbenchRows(vaultPath: string): WorkbenchData {
  // evaluateLibrary scores study items (worth/relevance/substance/lifecycle); the full detail listing
  // provides keep items + the raw frontmatter for every pipeline-status field.
  const scoredById = new Map(evaluateLibrary(vaultPath).map((s) => [s.id, s]));
  const all = listLibraryArtifactDetails(vaultPath, { limit: 5000, includeCandidates: true, includeSkippedCandidates: true, mode: "all" }).artifacts;

  const rows: WorkbenchRow[] = all.map((a) => {
    const fm = a.raw_frontmatter;
    const connections = connectionSuggestionsFromFrontmatter(fm).length;
    const scored = scoredById.get(a.id);
    const disposition = a.library_mode === "keep" ? "keep" : "study";
    return {
      id: a.id,
      title: a.title || "(untitled)",
      url: a.url || "",
      source: a.source_name || a.source_id || a.channel || "?",
      channel: a.channel || "?",
      created_at: a.created_at,
      disposition,
      lifecycle: fm.archived === true ? "archived" : scored?.lifecycle ?? "active",
      worth: scored ? scored.worth : null,
      relevance: scored ? scored.relevance : null,
      substance: scored ? scored.substance : null,
      why: scored ? scored.why : null,
      pipeline_version: str(fm.pipeline_version),
      digested_with: str(fm.digested_with),
      reweave_pending: fm.reweave_pending === true,
      connection_state: connectionPassState(fm),
      connections,
      substance_graded: typeof fm.substance === "number",
      youtube_clip_policy: a.youtube_clip?.policy_action || null,
      youtube_content_form: a.youtube_clip?.content_form || null,
      content_type: contentTypeForArtifact(a),
      attention: a.attention?.kind || null,
    };
  });

  const stored = listStoredFeedback(vaultPath);
  const hasComments = new Set(stored.filter((s) => s.comments.length).map((s) => s.id));
  const hasUnprocessed = new Set(stored.filter((s) => s.comments.some((c) => !c.processed_at)).map((s) => s.id));

  const facets: Record<string, Record<string, number>> = {
    disposition: {}, lifecycle: {}, content_type: {}, pipeline_version: {}, digested_with: {}, connection_state: {}, substance: {}, feedback: {}, youtube_clip_policy: {}, youtube_content_form: {}, attention: {},
  };
  const bump = (facet: string, key: string) => { facets[facet][key] = (facets[facet][key] || 0) + 1; };
  for (const r of rows) {
    bump("disposition", r.disposition);
    bump("lifecycle", r.lifecycle);
    bump("content_type", r.content_type);
    bump("pipeline_version", r.pipeline_version || "(none)");
    bump("digested_with", r.digested_with || "(none)");
    bump("connection_state", r.connection_state);
    bump("substance", r.substance_graded ? "graded" : "ungraded");
    bump("feedback", hasUnprocessed.has(r.id) ? "unprocessed" : hasComments.has(r.id) ? "processed" : "none");
    if (r.youtube_clip_policy) bump("youtube_clip_policy", r.youtube_clip_policy);
    if (r.youtube_content_form) bump("youtube_content_form", r.youtube_content_form);
    if (r.attention) bump("attention", r.attention);
  }

  rows.sort((a, b) => (b.worth ?? -1) - (a.worth ?? -1));
  const worths = rows.filter((r) => typeof r.worth === "number").map((r) => r.worth as number).sort((a, b) => a - b);
  const muted = [...readMutedSenders(vaultPath)].sort().map((email) => ({ email, name: friendlyNewsletterSender(email) || email }));
  return { rows, facets, worths, muted, total: rows.length };
}
