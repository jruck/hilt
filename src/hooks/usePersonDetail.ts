"use client";

import useSWR from "swr";
import type { PersonDetail } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
