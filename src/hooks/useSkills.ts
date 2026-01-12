"use client";

import useSWR from "swr";
import type { SkillInfo, SkillsResponse, SkillContentResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

/**
 * Hook for fetching available skills for a given scope
 * Merges global (~/.claude/skills) and project ({scope}/.claude/skills) skills
 */
export function useSkills(scope: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<SkillsResponse>(
    scope ? `/api/skills?scope=${encodeURIComponent(scope)}` : null,
    fetcher,
    {
      revalidateOnFocus: false, // Skills are static files, no need to refetch often
      dedupingInterval: 60000,  // Cache for 1 minute
    }
  );

  return {
    skills: data?.skills ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * Hook for fetching the full content of a specific skill
 * Used when you need to inject skill instructions into a prompt
 */
export function useSkillContent(
  skillName: string | undefined,
  scope: string | undefined
) {
  const { data, error, isLoading } = useSWR<SkillContentResponse>(
    skillName && scope
      ? `/api/skills/${encodeURIComponent(skillName)}?scope=${encodeURIComponent(scope)}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    skill: data?.skill,
    content: data?.content,
    isLoading,
    error,
  };
}

/**
 * Fetch skill content imperatively (for use in handlers)
 */
export async function fetchSkillContent(
  skillName: string,
  scope: string
): Promise<{ skill: SkillInfo; content: string } | null> {
  try {
    const response = await fetch(
      `/api/skills/${encodeURIComponent(skillName)}?scope=${encodeURIComponent(scope)}`
    );

    if (!response.ok) {
      console.error(`Failed to fetch skill '${skillName}':`, response.statusText);
      return null;
    }

    const data: SkillContentResponse = await response.json();
    return {
      skill: data.skill,
      content: data.content,
    };
  } catch (error) {
    console.error(`Error fetching skill '${skillName}':`, error);
    return null;
  }
}
