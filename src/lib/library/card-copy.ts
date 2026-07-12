import type { LibraryArtifact, RecommendationPresentation } from "./types";

export type LibraryCardVariant = "standard" | "recommendation";

export interface LibraryCardCopy {
  sourceDescription: string | null;
  recommendationPitch: string | null;
  description: string | null;
}

/** Compact cards show one narrative layer: source identity OR current recommendation context. */
export function libraryCardCopy(artifact: LibraryArtifact, variant: LibraryCardVariant): LibraryCardCopy {
  const sourceDescription = artifact.summary?.trim() || null;
  const recommendationPitch = artifact.recommendation?.why_now.trim() || null;
  return {
    sourceDescription,
    recommendationPitch,
    description: variant === "recommendation" ? recommendationPitch : sourceDescription,
  };
}

export interface ReaderRecommendationContext {
  requestedEpisodeId?: string | null;
  exactRecommendation?: RecommendationPresentation | null;
  currentRecommendation?: RecommendationPresentation | null;
  exactUnavailable?: boolean;
}

/** Hold an exact deep link steady while it loads; fall back only after that episode is known missing. */
export function readerRecommendationContext({
  requestedEpisodeId,
  exactRecommendation,
  currentRecommendation,
  exactUnavailable = false,
}: ReaderRecommendationContext): RecommendationPresentation | null {
  if (!requestedEpisodeId) return currentRecommendation || null;
  if (exactRecommendation) return exactRecommendation;
  return exactUnavailable ? currentRecommendation || null : null;
}
