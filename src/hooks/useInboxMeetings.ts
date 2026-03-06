"use client";

import useSWR from "swr";
import type { InboxDetail } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useInboxMeetings(enabled: boolean) {
  const { data, error, isLoading, mutate } = useSWR<InboxDetail>(
    enabled ? "/api/bridge/people/inbox" : null,
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
