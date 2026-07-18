/** The only model Hilt may ask the external `summarize` CLI to use. */
export const HILT_LIBRARY_SUMMARIZE_MODEL = "cli/claude/claude-sonnet-4-6";

/**
 * Validate the optional machine-local override. Hilt deliberately does not
 * support provider selection here: an override may only restate the pin.
 */
export function validateLibrarySummarizeModel(
  configured: string | undefined = process.env.LIBRARY_SUMMARIZE_MODEL,
): string {
  if (configured === undefined) return HILT_LIBRARY_SUMMARIZE_MODEL;
  const value = configured.trim();
  if (!value) {
    throw new Error("LIBRARY_SUMMARIZE_MODEL is empty; remove it or set the pinned Claude model");
  }
  if (value !== HILT_LIBRARY_SUMMARIZE_MODEL) {
    const provider = /(?:^|\/)(?:google|gemini)(?:\/|$)|gemini/i.test(value)
      ? "Google/Gemini models are disabled"
      : "alternate summarize models are disabled";
    throw new Error(`${provider}; expected ${HILT_LIBRARY_SUMMARIZE_MODEL}`);
  }
  return value;
}

export function withPinnedLibrarySummarizeModel(args: string[]): string[] {
  return [...args, "--model", HILT_LIBRARY_SUMMARIZE_MODEL];
}

/**
 * Runtime tripwire at Hilt's process boundary. Extraction-only calls do not
 * invoke an LLM; every other summarize call must carry the exact Claude pin.
 */
export function assertLibrarySummarizeInvocation(
  args: readonly string[],
  configured: string | undefined = process.env.LIBRARY_SUMMARIZE_MODEL,
): void {
  const extractOnly = args.includes("--extract");
  const modelIndex = args.indexOf("--model");
  const model = modelIndex >= 0 ? args[modelIndex + 1] : undefined;

  if (extractOnly && model === undefined) return;

  const expected = validateLibrarySummarizeModel(configured);
  if (model !== expected) {
    throw new Error(
      `Blocked summarize invocation without the pinned Claude model (${HILT_LIBRARY_SUMMARIZE_MODEL})`,
    );
  }
}
