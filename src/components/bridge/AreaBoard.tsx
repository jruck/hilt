"use client";

import type { BridgeArea, BridgeAreaFocusSection } from "@/lib/types";
import { AreaCard } from "./AreaCard";

const GROUPS: Array<{ key: BridgeAreaFocusSection | "other"; label: string }> = [
  { key: "now", label: "Now" },
  { key: "ongoing", label: "Ongoing" },
  { key: "long-term", label: "Long-Term" },
  { key: "other", label: "Other" },
];

interface AreaBoardProps {
  areas: BridgeArea[];
  onAreaClick?: (area: BridgeArea) => void;
  className?: string;
}

function groupKey(area: BridgeArea): BridgeAreaFocusSection | "other" {
  return area.primaryFocus ?? "other";
}

export function AreaBoard({ areas, onAreaClick, className }: AreaBoardProps) {
  if (areas.length === 0) return null;

  return (
    <div className={`relative left-1/2 w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 ${className ?? ""}`}>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        Areas
      </h2>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[860px] grid-cols-4 gap-3">
          {GROUPS.map(({ key, label }) => {
            const groupAreas = areas.filter((area) => groupKey(area) === key);

            return (
              <section key={key} className="min-w-0">
                <div className="mb-2 flex h-7 items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-xs font-medium text-[var(--text-tertiary)]">
                  <span>{label}</span>
                  <span className="tabular-nums opacity-60">{groupAreas.length}</span>
                </div>
                <div className="space-y-2">
                  {groupAreas.length > 0 ? (
                    groupAreas.map((area) => (
                      <AreaCard
                        key={area.relativePath}
                        area={area}
                        onClick={onAreaClick}
                      />
                    ))
                  ) : (
                    <div className="flex min-h-[92px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-tertiary)]">
                      —
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
