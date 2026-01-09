"use client";

import useSWR from "swr";
import type { ClaudeStack, ConfigFileContent } from "@/lib/claude-config/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useClaudeStack(scopePath?: string) {
  const scopeParam = scopePath ? `?scope=${encodeURIComponent(scopePath)}` : "";

  const { data, error, isLoading, mutate } = useSWR<{ stack: ClaudeStack }>(
    scopePath ? `/api/claude-stack${scopeParam}` : null,
    fetcher,
    {
      refreshInterval: 10000, // Refresh every 10s
      revalidateOnFocus: true,
    }
  );

  return {
    stack: data?.stack ?? null,
    isLoading,
    isError: error,
    mutate,
  };
}

export function useConfigFile(filePath?: string, scopePath?: string) {
  const params = new URLSearchParams();
  if (filePath) params.set("path", filePath);
  if (scopePath) params.set("scope", scopePath);

  const { data, error, isLoading, mutate } = useSWR<{ file: ConfigFileContent }>(
    filePath ? `/api/claude-stack/file?${params}` : null,
    fetcher
  );

  const saveFile = async (content: string, createDirectories = false) => {
    if (!filePath) return { success: false, error: "No file path" };

    const response = await fetch("/api/claude-stack/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content, createDirectories }),
    });

    const result = await response.json();
    if (result.success) {
      mutate();
    }
    return result;
  };

  const deleteFile = async () => {
    if (!filePath) return { success: false, error: "No file path" };

    const response = await fetch(`/api/claude-stack/file?path=${encodeURIComponent(filePath)}`, {
      method: "DELETE",
    });

    return response.json();
  };

  return {
    file: data?.file ?? null,
    isLoading,
    isError: error,
    mutate,
    saveFile,
    deleteFile,
  };
}
