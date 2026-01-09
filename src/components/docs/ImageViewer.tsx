"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import * as path from "path";

interface ImageViewerProps {
  filePath: string;
  scopePath: string;
}

export function ImageViewer({ filePath, scopePath }: ImageViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = path.basename(filePath);
  const imageUrl = `/api/docs/raw?path=${encodeURIComponent(filePath)}&scope=${encodeURIComponent(scopePath)}`;

  return (
    <div className="flex-1 overflow-auto flex items-center justify-center p-12 bg-[var(--bg-secondary)]">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--text-tertiary)]" />
        </div>
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
