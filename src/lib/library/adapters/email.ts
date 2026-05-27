import type { LibrarySourceConfig, RawArtifact } from "../types";
import { MissingCredentialError } from "../errors";

export async function fetchEmailArtifacts(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  if (source.fixtures?.length) return source.fixtures;
  throw new MissingCredentialError(source.id, "GMAIL_ACCESS_TOKEN");
}

