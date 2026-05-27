import type { LibrarySourceConfig, RawArtifact } from "../types";

export async function fetchFixtureArtifacts(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  return source.fixtures || [];
}

