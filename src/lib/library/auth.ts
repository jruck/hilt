import { fetchArtifactsForSource } from "./adapters";
import { LibrarySourceBlockedError } from "./errors";
import { hasGoogleRefreshCredentials, hasXRefreshCredentials } from "./oauth";
import { loadSources } from "./source-config";
import { isoNow } from "./utils";
import type { LibraryAuthVerificationReport, LibraryAuthVerificationResult, LibrarySourceConfig } from "./types";

function authEnvNames(source: LibrarySourceConfig): string[] {
  const env = source.auth?.env;
  if (!env) return [];
  return Array.isArray(env) ? env : [env];
}

function envChecks(source: LibrarySourceConfig) {
  return authEnvNames(source).map((name) => ({ name, present: Boolean(process.env[name]) }));
}

function missingCredentialNames(source: LibrarySourceConfig, checks: ReturnType<typeof envChecks>): string[] {
  const missing = checks.filter((item) => !item.present).map((item) => item.name);
  if (source.channel === "youtube" && missing.includes("YOUTUBE_OAUTH_ACCESS_TOKEN") && hasGoogleRefreshCredentials()) {
    return missing.filter((name) => name !== "YOUTUBE_OAUTH_ACCESS_TOKEN");
  }
  if (source.signal === "twitter_bookmark" && missing.includes("X_ACCESS_TOKEN") && (process.env.X_BEARER_TOKEN || hasXRefreshCredentials())) {
    return missing.filter((name) => name !== "X_ACCESS_TOKEN");
  }
  return missing;
}

function sourceNeedsVerification(source: LibrarySourceConfig): boolean {
  return Boolean(source.auth?.required) || source.url.startsWith("superhuman://");
}

function withLiveLimit(source: LibrarySourceConfig, limit: number): LibrarySourceConfig {
  return {
    ...source,
    metadata: {
      ...source.metadata,
      max_results: Math.max(1, Math.min(limit, Number(source.metadata.max_results || limit))),
    },
  };
}

export async function verifyLibraryAuth(
  vaultPath: string,
  options: { sourceIds?: string[]; live?: boolean; limit?: number } = {},
): Promise<LibraryAuthVerificationReport> {
  const live = options.live !== false;
  const limit = options.limit && options.limit > 0 ? options.limit : 1;
  const sources = loadSources(vaultPath)
    .filter((source) => source.enabled)
    .filter((source) => !options.sourceIds?.length || options.sourceIds.includes(source.id))
    .filter(sourceNeedsVerification);

  const results: LibraryAuthVerificationResult[] = [];

  for (const source of sources) {
    const requiredEnv = envChecks(source);
    const missing = missingCredentialNames(source, requiredEnv);
    if (missing.length) {
      results.push({
        source_id: source.id,
        source_name: source.name,
        channel: source.channel,
        status: "missing",
        required_env: requiredEnv,
        scopes: source.auth?.scopes || [],
        live_checked: false,
        sample_count: 0,
        message: `Missing required credential(s): ${missing.join(", ")}`,
      });
      continue;
    }

    if (!live) {
      results.push({
        source_id: source.id,
        source_name: source.name,
        channel: source.channel,
        status: "skipped",
        required_env: requiredEnv,
        scopes: source.auth?.scopes || [],
        live_checked: false,
        sample_count: 0,
        message: "Credential names are present; live check skipped.",
      });
      continue;
    }

    try {
      const artifacts = await fetchArtifactsForSource(withLiveLimit(source, limit));
      results.push({
        source_id: source.id,
        source_name: source.name,
        channel: source.channel,
        status: "ok",
        required_env: requiredEnv,
        scopes: source.auth?.scopes || [],
        live_checked: true,
        sample_count: artifacts.length,
        message: `Live check succeeded with ${artifacts.length} sample artifact(s).`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        source_id: source.id,
        source_name: source.name,
        channel: source.channel,
        status: error instanceof LibrarySourceBlockedError ? "blocked" : "failed",
        required_env: requiredEnv,
        scopes: source.auth?.scopes || [],
        live_checked: true,
        sample_count: 0,
        message,
      });
    }
  }

  return {
    checked_at: isoNow(),
    live,
    ok: results.every((result) => result.status === "ok" || result.status === "skipped"),
    sources: results,
  };
}
