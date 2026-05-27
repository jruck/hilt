import type { LibrarySourceConfig, RawArtifact } from "../types";
import { fetchEmailArtifacts } from "./email";
import { fetchFixtureArtifacts } from "./fixture";
import { fetchRaindropArtifacts } from "./raindrop";
import { fetchRssArtifacts } from "./rss";
import { fetchTwitterArtifacts } from "./twitter";
import { fetchYouTubeArtifacts } from "./youtube";

export async function fetchArtifactsForSource(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  if (source.fixtures?.length || source.channel === "fixture") return fetchFixtureArtifacts(source);
  switch (source.channel) {
    case "rss":
      return fetchRssArtifacts(source);
    case "youtube":
      return fetchYouTubeArtifacts(source);
    case "twitter":
      return fetchTwitterArtifacts(source);
    case "raindrop":
      return fetchRaindropArtifacts(source);
    case "email":
      return fetchEmailArtifacts(source);
    case "manual":
      return [];
    default:
      return [];
  }
}

