import { resetLibraryRefetchAttempt } from "./attention";
import { captureFailed } from "./capture-health";
import { retryProcessingArtifact } from "./processing";
import { clearLibrarySourceResolution, restoreArchivedProcessingRecord } from "./source-resolution";
import type { LibraryArtifactDetail } from "./types";

export type LibrarySourceRetryResult =
  | { artifact_uid: string; status: "queued"; recovery: "processing" }
  | { artifact_uid: string; status: "retry_reset"; recovery: "next_scheduled_refetch" };

/**
 * Retry both generations of source failure honestly:
 * - resumable processing failures restore/reset their exact queue payload for immediate worker pickup;
 * - legacy exhausted captures clear only their attempt cap and wait for the bounded refetch schedule.
 */
export function retryLibrarySource(
  vaultPath: string,
  artifact: LibraryArtifactDetail,
): LibrarySourceRetryResult | null {
  restoreArchivedProcessingRecord(vaultPath, artifact);
  const record = retryProcessingArtifact(vaultPath, artifact.id);
  if (record) {
    clearLibrarySourceResolution(vaultPath, artifact);
    return { artifact_uid: record.artifact_uid, status: "queued", recovery: "processing" };
  }

  if (!captureFailed({ body: artifact.content, frontmatter: artifact.raw_frontmatter })) return null;
  resetLibraryRefetchAttempt(vaultPath, artifact.path);
  clearLibrarySourceResolution(vaultPath, artifact);
  return { artifact_uid: artifact.id, status: "retry_reset", recovery: "next_scheduled_refetch" };
}
