"use client";

import { use } from "react";
import { Board } from "@/components/Board";
import { ScopeProvider } from "@/contexts/ScopeContext";
import { parseViewUrl } from "@/lib/url-utils";
import { Agentation } from "agentation";

interface PageProps {
  params: Promise<{ path?: string[] }>;
}

export default function Home({ params }: PageProps) {
  const { path } = use(params);
  const { viewMode, scope } = parseViewUrl(path ?? []);

  return (
    <ScopeProvider initialScope={scope} initialViewMode={viewMode}>
      <Board />
      {process.env.NODE_ENV === "development" && <div id="agentation-wrapper"><Agentation /></div>}
    </ScopeProvider>
  );
}
