const INSTALL_MARKER = Symbol.for("hilt.gemini-network-tripwire");

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Block Gemini's public and Vertex AI model endpoints without interfering with
 * unrelated Google services such as YouTube ingestion.
 */
export function assertNotGeminiEndpoint(input: RequestInfo | URL): void {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl(input));
  } catch {
    return;
  }
  const host = parsed.hostname.toLowerCase();
  const target = `${parsed.pathname}${parsed.search}`.toLowerCase();
  const publicGeminiApi = host === "generativelanguage.googleapis.com";
  const vertexGeminiApi = /(?:^|\.)aiplatform\.googleapis\.com$/.test(host) && target.includes("gemini");
  const otherGoogleGeminiApi = host.endsWith(".googleapis.com") && target.includes("gemini");
  if (publicGeminiApi || vertexGeminiApi || otherGoogleGeminiApi) {
    throw new Error(`Blocked retired Gemini endpoint: ${host}`);
  }
}

/** Install once in each long-lived Hilt Node process. */
export function installGeminiNetworkTripwire(): void {
  const state = globalThis as typeof globalThis & Record<symbol, true | undefined>;
  if (state[INSTALL_MARKER] || typeof globalThis.fetch !== "function") return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    assertNotGeminiEndpoint(input);
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
  state[INSTALL_MARKER] = true;
}
