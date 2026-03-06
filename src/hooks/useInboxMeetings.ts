"use client";

import useSWR from "swr";
import type { InboxDetail } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useInboxMeetings(enabled: boolean, filterName?: string) {
  const url = filterName
    ? `/api/bridge/people/inbox?name=${encodeURIComponent(filterName)}`
    : "/api/bridge/people/inbox";

  const { data, error, isLoading, mutate } = useSWR<InboxDetail>(
    enabled ? url : null,
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
