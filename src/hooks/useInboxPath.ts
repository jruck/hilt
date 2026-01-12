"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR, { mutate } from "swr";

const CACHE_KEY = "/api/preferences?key=inboxPath";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

/**
 * Hook for managing the global inbox folder path
 * Used by QuickAdd to set default destination for captured tasks
 */
export function useInboxPath() {
  const { data, isLoading, error } = useSWR<{ value?: string }>(
    CACHE_KEY,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const [isHydrated, setIsHydrated] = useState(false);

  // Mark as hydrated once we have data
  useEffect(() => {
    if (!isLoading) {
      setIsHydrated(true);
    }
  }, [isLoading]);

  const inboxPath = data?.value;

  const setInboxPath = useCallback(async (path: string | null): Promise<void> => {
    // Optimistically update the cache
    mutate(
      CACHE_KEY,
      { value: path ?? undefined },
      false
    );

    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "inboxPath", value: path }),
    });

    // Revalidate
    mutate(CACHE_KEY);
  }, []);

  const refreshInboxPath = useCallback(() => {
    mutate(CACHE_KEY);
  }, []);

  return {
    inboxPath,
    setInboxPath,
    refreshInboxPath,
    isHydrated,
    isLoading,
    error,
  };
}
