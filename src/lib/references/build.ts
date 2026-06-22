import type { HiltRef } from "./types";

/**
 * buildReference — the single place that decides what a copied reference contains for every object
 * kind. Output shape (user-confirmed), generalizing the original Bridge-task "Copy reference":
 *
 *     <location>
 *
 *     <one line: what this is / how to read it>
 *
 *     Title: <title>  [+ key metadata]      (omitted when it adds nothing beyond <location>)
 *
 * File-backed kinds lead with an ABSOLUTE path (+ `:line` when known) so a local agent can open it
 * immediately. Kinds with no file (session, calendar-event) lead with a how-to-reach line instead.
 * Tune reference content here and nowhere else.
 */
export function buildReference(ref: HiltRef): string {
  switch (ref.kind) {
    case "bridge-task": {
      // Preserve the original gold-standard wording verbatim (locked by build.test.ts).
      const location = ref.absPath
        ? `${ref.absPath}${ref.line ? `:${ref.line}` : ""}`
        : ref.title;
      const howto = ref.line
        ? "Use the current file contents as source of truth. The referenced item is the top-level markdown checkbox at that line; indented lines below it are child details until the next top-level checkbox or section heading."
        : "Use the current file contents as source of truth. Find the top-level markdown checkbox matching this title; indented lines below it are child details until the next top-level checkbox or section heading.";
      const title = `Title: ${ref.title}${ref.dueDate ? ` [due:: ${ref.dueDate}]` : ""}`;
      return assemble(location, howto, [title]);
    }
    case "library-artifact":
      return assemble(
        ref.absPath,
        "Saved Library reference (markdown). Open the file as source of truth; frontmatter holds the metadata, the body holds the digest and cached source.",
        [`Title: ${ref.title}${ref.url ? ` — ${ref.url}` : ""}`],
      );
    case "doc":
      // The path's basename is the title, so a Title line would just repeat it — omit it.
      return assemble(ref.absPath, "File in the vault. Open it as the source of truth.", []);
    case "meeting":
      return assemble(
        ref.absPath,
        "Meeting note / transcript (markdown). Open as the source of truth.",
        ref.title ? [`Title: ${ref.title}`] : [],
      );
    case "person":
      return assemble(
        ref.absPath,
        "Person note (markdown) — notes, meetings, and context for this person. Open as the source of truth.",
        [`Title: ${ref.name}`],
      );
    case "stack-plugin":
      return assemble(ref.absPath, "Installed plugin (config / install directory).", [`Title: ${ref.title}`]);
    case "stack-mcp":
      return assemble(ref.absPath, "MCP server configuration file.", [`Title: ${ref.title}`]);
    case "session": {
      const provider = ref.provider ? ` (${ref.provider})` : "";
      const howto = `Coding-agent session id${provider}. Use it to locate the session via CASS or the provider's transcript store${ref.cwd ? ` — workspace: ${ref.cwd}` : ""}.`;
      return assemble(ref.sessionId, howto, ref.title ? [`Title: ${ref.title}`] : []);
    }
    case "briefing-item":
      return assemble(
        ref.absPath,
        "Bridge briefing item — open the file and find the top-level bullet matching this headline; its indented sub-bullets are the source / trace for why it was surfaced.",
        [`Title: ${ref.headline}`],
      );
    case "calendar-event": {
      const when = formatWhen(ref.start, ref.end);
      const titleMeta = [when, ref.sourceName].filter(Boolean).join(" — ");
      return assemble(
        `Fetch via: GET /api/calendar/events/${ref.id}`,
        `Calendar event. Fetch full detail from the endpoint above (events are cached in Hilt's calendar DB).${ref.uid ? ` iCal uid: ${ref.uid}.` : ""}`,
        [`Title: ${ref.title}${titleMeta ? ` — ${titleMeta}` : ""}`],
      );
    }
  }
}

/** location → blank → how-to → blank → identity lines (identity section dropped when empty). */
function assemble(location: string, howto: string, identity: string[]): string {
  const lines = [location, "", howto];
  const id = identity.filter((line) => line && line.trim());
  if (id.length) lines.push("", ...id);
  return lines.join("\n");
}

function formatWhen(start?: string | null, end?: string | null): string {
  if (!start) return "";
  const startDate = new Date(start);
  if (!Number.isFinite(startDate.getTime())) return start;
  const date = startDate.toISOString().slice(0, 10);
  const startTime = start.includes("T") ? startDate.toISOString().slice(11, 16) : "";
  if (!startTime) return date;
  const endDate = end ? new Date(end) : null;
  const endTime = endDate && Number.isFinite(endDate.getTime()) && end?.includes("T")
    ? endDate.toISOString().slice(11, 16)
    : "";
  return `${date} ${startTime}${endTime ? `–${endTime}` : ""}`;
}
