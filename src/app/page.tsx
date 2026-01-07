"use client";

import { Board } from "@/components/Board";
import { ScopeProvider } from "@/contexts/ScopeContext";

export default function Home() {
  // For Tauri, scope is managed entirely client-side
  // The initial scope will be loaded from localStorage or empty
  return (
    <ScopeProvider initialScope="">
      <Board />
    </ScopeProvider>
  );
}
