"use client";

/**
 * useObjectCard (v3 unit B5) — SWR over GET /api/objects/resolve for the ObjectPill popover.
 *
 * Lazy by contract: the key is null until `enabled` (the popover OPEN), so rendering a page
 * full of pills costs ZERO network. Once opened, SWR dedupes/caches per kind+id across every
 * pill instance; `keepPreviousData` keeps the card painted through revalidations.
 */
import useSWR, { mutate } from "swr";
import type { ObjectRef, ResolvedObject } from "@/lib/objects/types";
import { withBasePath } from "@/lib/base-path";

/** Cache key for a ref's resolve fetch — shared by the hook and the imperative tap path. */
export function objectResolveKey(refr: ObjectRef): string {
  return `/api/objects/resolve?kind=${encodeURIComponent(refr.kind)}&id=${encodeURIComponent(refr.id)}`;
}

async function fetchResolvedObject(url: string): Promise<ResolvedObject> {
  const res = await fetch(withBasePath(url));
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = `${detail}: ${body.error}`;
    } catch {
      // Keep the HTTP status when the response cannot be parsed.
    }
    throw new Error(detail);
  }
  return res.json();
}

export function useObjectCard(refr: ObjectRef, enabled: boolean) {
  const { data, error, isLoading } = useSWR<ResolvedObject>(
    enabled ? objectResolveKey(refr) : null,
    fetchResolvedObject,
    { keepPreviousData: true, revalidateOnFocus: false }
  );

  return {
    resolved: data ?? null,
    error: (error as Error | undefined) ?? null,
    isLoading,
  };
}

/**
 * Imperative resolve for the coarse-pointer tap path (fetch on tap, then navigate).
 * Seeds the same SWR cache so a follow-up popover open is instant.
 */
export async function resolveObject(refr: ObjectRef): Promise<ResolvedObject> {
  const key = objectResolveKey(refr);
  const data = await fetchResolvedObject(key);
  await mutate(key, data, { revalidate: false });
  return data;
}
