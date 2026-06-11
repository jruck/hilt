"use client";

import { useState } from "react";
import * as path from "path";
import { LoadingState } from "@/components/ui/LoadingState";
import { withBasePath } from "@/lib/base-path";

interface ImageViewerProps {
  filePath: string;
  scopePath: string;
}

export function ImageViewer({ filePath, scopePath }: ImageViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = path.basename(filePath);
  const imageUrl = withBasePath(`/api/docs/raw?path=${encodeURIComponent(filePath)}&scope=${encodeURIComponent(scopePath)}`);

  return (
    <div data-mobile-scroll-chrome="bottom" className="hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-12 flex-1 overflow-auto flex items-center justify-center bg-[var(--content-surface)] px-12 pt-12 sm:pb-12">
      {isLoading && (
        <LoadingState size="lg" className="absolute inset-0" />
      )}

      {error && (
        <div className="text-red-500 text-sm">{error}</div>
      )}

      <img
        src={imageUrl}
        alt={fileName}
        className="max-w-full max-h-full object-contain"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setError("Failed to load image");
        }}
      />
    </div>
  );
}
