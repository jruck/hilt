import type { ArtifactFetchBatch, FetchArtifactsOptions, LibrarySourceConfig, RawArtifact } from "../types";
import { fetchEmailArtifacts } from "./email";
import { fetchFixtureArtifacts } from "./fixture";
import { fetchRaindropArtifacts } from "./raindrop";
import { fetchRssArtifacts } from "./rss";
import { fetchTwitterArtifacts } from "./twitter";
import { fetchYouTubeArtifacts } from "./youtube";

type AdapterFetchResult = RawArtifact[] | ArtifactFetchBatch;

function normalizeFetchResult(result: AdapterFetchResult, cursor?: string | null): ArtifactFetchBatch {
  return Array.isArray(result) ? { artifacts: result, cursor } : { cursor, ...result };
}

export async function fetchArtifactBatchForSource(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  if (source.fixtures?.length || source.channel === "fixture") {
    return normalizeFetchResult(await fetchFixtureArtifacts(source), options.cursor);
  }

  let result: AdapterFetchResult;
  switch (source.channel) {
    case "rss":
      result = await fetchRssArtifacts(source);
      break;
    case "youtube":
      result = await fetchYouTubeArtifacts(source, options);
      break;
    case "twitter":
      result = await fetchTwitterArtifacts(source, options);
      break;
    case "raindrop":
      result = await fetchRaindropArtifacts(source, options);
      break;
    case "email":
      result = await fetchEmailArtifacts(source, options);
      break;
    case "manual":
      result = [];
      break;
    default:
      result = [];
      break;
  }

  return normalizeFetchResult(result, options.cursor);
}

export async function fetchArtifactsForSource(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<RawArtifact[]> {
  return (await fetchArtifactBatchForSource(source, options)).artifacts;
}
