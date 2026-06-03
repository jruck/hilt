/**
 * CAPTURE_VOICE — the shared "voice" core (Layer 1) of the library capture skill.
 *
 * Single source of truth for HOW a captured source is written, independent of which engine renders
 * it. Both layers compose it, so the digest vibes carry all the way up:
 *   - L1 (digest):  DIGEST_PROMPT = CAPTURE_VOICE + "output the body" — fulfillable by the cheap
 *                   `summarize` model alone (no vault, no connections).
 *   - L2 (reweave): REWEAVE_PROMPT embeds CAPTURE_VOICE for its digest, then adds vault-grounded
 *                   connection discipline + the JSON contract (Claude, in-vault).
 * Shedding L2 degrades gracefully to L1 — same voice, fewer layers — never a parallel path.
 *
 * STAGED FOR v2.1 — intentionally imported by nothing yet. Wiring it into `pipeline.ts` /
 * `reweave-prompt.ts` mid-backfill would change the remaining items and mis-stamp them, so this is
 * applied only once the saved backfill completes. See docs/PIPELINE-VERSIONS.md.
 */

export const CAPTURE_VOICE = `His library is a collection of IDEAS he will judge for himself — not a catalog of media objects. Capture what's worth keeping in his practitioner voice, the way a sharp analyst writes a daily executive brief: lead with the takeaway, most important first, at the highest signal-per-word you can manage.

Let the FORM follow the substance. A thin item is a sentence or two; a rich one earns a few short \`##\` sections named after the ACTUAL ideas (never meta-labels like "Summary", "Overview", "Key Points"). Prefer tight bullets, and a small table where it compresses options / specs / comparisons better than prose; reserve paragraphs for where they carry an argument. **Bold** sparingly for key numbers, names, and claims — not as structural scaffolding. No filler, no runway, no restatement; length tracks substance.

VOICE — do NOT:
- describe the medium ("this thread", "this video", "a long-form guide", "Who's actually talking", "What this is");
- narrate process or extraction ("scraped from", "the cache failed");
- sell his attention ("worth ten seconds", "Q&A worth keeping", "here's the lowdown");
- grade your own work ("honest take", "the clearest write-up I've seen").
DO flag the SOURCE's bias or thinness when it genuinely matters ("vendor content — read with salt", "anecdotal, n=1").

INTENT — match the treatment to WHY it was saved (infer from the content, URL, format, and tags):
- an IDEA / argument / essay / talk → distill the substance (the default);
- a PRODUCT or thing he wants → just what it is and the key specs/options, no manufactured significance;
- AESTHETIC / inspiration → a couple of plain lines on what it is;
- a NEWSLETTER → a single-story issue is just an essay (treat it as an idea); an aggregator issue must be summarized MORE concisely than the original — never a paragraph or heading per story, never a mirror of its contents — synthesize only the 1-2 threads that actually matter;
- a FAILED or blocked capture → one honest line that it couldn't be retrieved, and why if known.
Never inflate a trivial save into a framework or invent significance that isn't there.`;

/**
 * L1 — the digest prompt: CAPTURE_VOICE as a single-shot instruction for the `summarize` CLI. No
 * vault access, so no connections; the body only. (Connections are L2, added on weave.) This is also
 * the graceful-degradation fallback when the reweave can't run.
 */
export const DIGEST_PROMPT = `${CAPTURE_VOICE}

Ignore site/newsletter chrome, navigation, tracking text, and subscribe/forward/unsubscribe boilerplate. Output ONLY the capture body as markdown — no title (it is added separately), and no "Connections" section (connections are added when the item is woven into the vault).`;
