"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import {
  SECONDARY_CHROME_BODY_GUTTER_CLASS,
  SecondarySegmentedButton,
  SecondarySegmentedControl,
  SecondaryToolbar,
} from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  TELEMETRY_RANGES,
  usePerformanceLatest,
  usePerformanceSeries,
  type MachineMeta,
  type TelemetryRange,
  type TelemetrySample,
} from "@/hooks/usePerformance";
import { PerfChart, COLOR, closetColor, machineComputeF } from "./PerfChart";

const RANGE_LABEL: Record<TelemetryRange, string> = { "6h": "6h", "24h": "24h", "7d": "7d", all: "All" };
const STALE_SECONDS = 600; // > 2 sample intervals (5 min) = stale

interface StripItem {
  id: string;
  label: string;
  fixedColor: string | null; // null => dynamic (closet zone fade)
  value: (s: TelemetrySample) => number | null;
}

// Number only — the unit is a separate muted span so value+unit don't read as one
// token (e.g. "86" "°F" rather than "86°F").
function fmtVal(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toFixed(0);
}

export function PerformanceView({ modeSwitcher }: { modeSwitcher?: ReactNode }) {
  const [range, setRange] = useState<TelemetryRange>("24h");
  const [muted, setMuted] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<TelemetrySample | null>(null);

  const series = usePerformanceSeries(range);
  const latest = usePerformanceLatest();

  const rows = series.data?.rows ?? [];
  const machines: MachineMeta[] = series.data?.machines ?? latest.data?.machines ?? [];
  const latestSample = latest.data?.sample ?? null;
  const ageSeconds = latest.data?.ageSeconds ?? null;
  const display = hovered ?? latestSample;
  const stale = ageSeconds != null && ageSeconds > STALE_SECONDS;

  // Ambient (left axis) + one chip item per machine (right axis). Ids match the
  // chart's series ids so the strip toggles the matching line.
  const stripItems = useMemo<StripItem[]>(() => {
    const items: StripItem[] = [
      { id: "closet", label: "Closet", fixedColor: null, value: (s) => s.closet_temp_f },
      { id: "outdoor", label: "Outdoor", fixedColor: COLOR.outdoor, value: (s) => s.outdoor_temp_f },
    ];
    for (const m of machines) {
      items.push({ id: `compute:${m.id}`, label: m.label, fixedColor: m.color, value: (s) => machineComputeF(s, m.id) });
    }
    return items;
  }, [machines]);

  const toggleMuted = useCallback((id: string) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    void series.mutate();
    void latest.mutate();
  }, [series, latest]);

  const hoverLabel = useMemo(() => {
    if (!hovered) return null;
    return new Date(hovered.ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }, [hovered]);

  const toolbar = (
    <SecondaryToolbar
      left={modeSwitcher}
      right={
        <div className="flex items-center gap-2">
          <SecondarySegmentedControl>
            {TELEMETRY_RANGES.map((r) => (
              <SecondarySegmentedButton key={r} active={range === r} onClick={() => setRange(r)} collapseLabel={false}>
                {RANGE_LABEL[r]}
              </SecondarySegmentedButton>
            ))}
          </SecondarySegmentedControl>
          <span className={`shrink-0 text-xs ${stale ? "text-red-500" : "text-[var(--text-tertiary)]"}`}>
            {ageSeconds == null ? "—" : stale ? `stale ${Math.round(ageSeconds / 60)}m` : `updated ${Math.max(0, Math.round(ageSeconds / 60))}m ago`}
          </span>
          <button
            type="button"
            onClick={refresh}
            title="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw className={`h-4 w-4 ${series.isValidating ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    />
  );

  if (series.isLoading && rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <LoadingState label="Loading performance telemetry" />
      </div>
    );
  }

  if (series.error && rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-center text-sm text-red-500">
            Performance telemetry unavailable. On the collector machine the metrics daemon writes locally; on a viewer it reads
            from the aggregator over the tailnet — check that the collector is running and reachable.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div className={`flex min-h-0 flex-1 flex-col ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
        {/* Stat strip: legend + visibility toggle + hover readout (retargets to the hovered sample).
            Each item toggles its line (dimmed when muted); closet's swatch tracks its live zone color. */}
        <div className="flex flex-col gap-1 border-b border-[var(--border-default)] px-4 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
          <span className="shrink-0 text-xs font-medium text-[var(--text-tertiary)] sm:mr-1 sm:w-28">{hoverLabel ?? "Now"}</span>
          {/* Mobile: tidy 2-col grid of aligned chips. Desktop: `contents` collapses
              this wrapper so the chips rejoin the single inline flex-wrap row. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:contents">
            {stripItems.map((item) => {
              const v = display ? item.value(display) : null;
              const numStr = fmtVal(v);
              const mutedItem = muted.has(item.id);
              const swatch = item.fixedColor ?? closetColor(v);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleMuted(item.id)}
                  className={`flex cursor-pointer items-center gap-1.5 text-xs ${mutedItem ? "opacity-40" : ""}`}
                  title={mutedItem ? `Show ${item.label}` : `Hide ${item.label}`}
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: swatch }} />
                  <span className="min-w-[3.5rem] text-[var(--text-tertiary)] sm:min-w-0">{item.label}</span>
                  <span className="font-mono text-[var(--text-primary)]">{numStr}</span>
                  {numStr !== "—" ? <span className="ml-0.5 text-[var(--text-tertiary)]">°F</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* hilt-mobile-fixed-clearance reserves the floating bottom-nav height on mobile
            so the SVG (x-axis labels included) shrinks to sit above it, not under it. */}
        <div className="hilt-mobile-fixed-clearance min-h-0 flex-1 px-4 pb-3 pt-3">
          <PerfChart rows={rows} machines={machines} muted={muted} onHover={setHovered} />
        </div>
      </div>
    </div>
  );
}
