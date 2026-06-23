/**
 * Shared Tailwind-Typography (`prose`) treatment for Hilt's Markdown read surfaces.
 *
 * Docs read-mode is the documented typographic gold master (DESIGN-PHILOSOPHY §314), and the Library
 * reader is meant to match it. Both used to carry their own near-identical copy of this class string —
 * DocsEditor.tsx and LibraryMarkdown.tsx — which let the code/table/font treatment silently drift apart.
 * This is now the single source of truth for everything the two surfaces share.
 *
 * Callers compose it as: `prose ${invert} ${SHARED_PROSE_TUNING} <surface deltas>`.
 *
 * Deliberately NOT included here (legitimate per-surface deltas — keep them at the call site, documented):
 *   - Docs: `leading-normal` (its Lexical DOM wants the tighter line-height) + blue web-style links.
 *   - Library: app-token body colors (prose-p/li/strong/headings), prose-img/prose-hr, and
 *     document-style links via the `.library-markdown a` CSS (§523 — links are document affordances).
 *
 * Keep every class as a literal substring so Tailwind's content scanner still generates them.
 *
 * The leading `hilt-prose` is a non-utility marker (Tailwind ignores it): globals.css hangs the shared
 * vertical-rhythm scale off `.hilt-prose.prose`, so every surface composed from this base gets the same
 * compacted spacing from one knob (`--prose-rhythm`) — no per-element tweaking.
 */
export const SHARED_PROSE_TUNING =
  "hilt-prose " +
  "max-w-none font-[family-name:var(--font-geist-sans)] " +
  "prose-headings:font-semibold " +
  "prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:before:content-none prose-code:after:content-none " +
  "prose-pre:rounded-lg prose-pre:bg-[var(--bg-tertiary)] " +
  "prose-table:border-collapse prose-table:bg-[var(--bg-primary)] " +
  "prose-thead:bg-[var(--bg-secondary)] " +
  "prose-th:border prose-th:border-[var(--border-default)] prose-th:px-3 prose-th:py-2 " +
  "prose-td:border prose-td:border-[var(--border-default)] prose-td:px-3 prose-td:py-2 prose-td:bg-[var(--bg-primary)]";
