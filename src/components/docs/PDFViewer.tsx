"use client";

import { useState } from "react";
import * as path from "path";
import { LoadingState } from "@/components/ui/LoadingState";

interface PDFViewerProps {
  filePath: string;
  scopePath: string;
}

export function PDFViewer({ filePath, scopePath }: PDFViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = path.basename(filePath);
  const pdfUrl = `/api/docs/raw?path=${encodeURIComponent(filePath)}&scope=${encodeURIComponent(scopePath)}`;

  return (
    <div className="flex-1 relative p-12">
      {isLoading && (
        <LoadingState size="lg" className="absolute inset-0 bg-[var(--content-surface)]" />
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">
          {error}
        </div>
      )}

      <iframe
        src={pdfUrl}
        className="w-full h-full border-0"
        title={fileName}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setError("Failed to load PDF");
        }}
      />
    </div>
  );
}
