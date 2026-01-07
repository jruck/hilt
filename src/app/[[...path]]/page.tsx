"use client";

import { use } from "react";
import { Board } from "@/components/Board";
import { ScopeProvider } from "@/contexts/ScopeContext";

interface PageProps {
  params: Promise<{ path?: string[] }>;
}

export default function Home({ params }: PageProps) {
  const { path } = use(params);
  // Reconstruct the scope path from URL segments
  // e.g., ["Users", "jruck", "Work"] -> "/Users/jruck/Work"
  const scopePath = path ? `/${path.join("/")}` : "";

  return (
    <ScopeProvider initialScope={scopePath}>
      <Board />
    </ScopeProvider>
  );
}
