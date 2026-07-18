export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installGeminiNetworkTripwire } = await import("./lib/ai/gemini-tripwire");
  installGeminiNetworkTripwire();
}
