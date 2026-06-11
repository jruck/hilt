"use client";

import useSWR from "swr";
import type { PersonDetail } from "@/lib/types";
import { withBasePath } from "@/lib/base-path";

const fetcher = async (url: string) => {
  const res = await fetch(withBasePath(url));
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Failed to fetch person detail (${res.status})`);
  }
  return data;
};

export function usePersonDetail(slug: string | null) {
  const { data, error, isLoading, mutate } = useSWR<PersonDetail>(
    slug ? `/api/bridge/people/${slug}` : null,
    fetcher,
    {
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );

  return {
    data,
    isLoading,
    isError: error,
    mutate,
  };
}
