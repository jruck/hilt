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
import { useMercuryLatest, useMercurySeries, type MercurySample } from "@/hooks/useMercury";
import type { MercuryRange } from "@/lib/system/mercury";
import { PerfChart, cToF, COLOR, type LayerState } from "./PerfChart";

const RANGES: MercuryRange[] = ["6h", "24h", "7d", "all"];
const RANGE_LABEL: Record<MercuryRange, string> = { "6h": "6h", "24h": "24h", "7d": "7d", all: "All" };
const STALE_SECONDS = 600; // > 2 sample intervals (5 min) = stale

const maxOrNull = (a: number | null, b: number | null) =>
  a == null && b == null ? null : Math.max(a ?? -Infinity, b ?? -Infinity);

interface StripItem {
  id: string;
  label: string;
  color?: string; // present => clickable swatch that toggles the matching line
  toggle?: "channel" | "draw";
  channelId?: string;
  unit: string;
  digits?: number;
  value: (s: MercurySample) => number | null;
}

const STRIP: StripItem[] = [
  { id: "closet", label: "Closet", color: COLOR.closet, toggle: "channel", channelId: "closet", unit: "°F", value: (s) => s.closet_temp_f },
  { id: "room", label: "Ambient", color: COLOR.room, toggle: "channel", channelId: "room", unit: "°F", value: (s) => s.room_temp_f },
  { id: "outdoor", label: "Outdoor", color: COLOR.outdoor, toggle: "channel", channelId: "outdoor", unit: "°F", value: (s) => s.outdoor_temp_f },
  { id: "compute", label: "Compute", color: COLOR.compute, toggle: "channel", channelId: "compute", unit: "°F", value: (s) => maxOrNull(s.cpu_temp_c == null ? null : cToF(s.cpu_temp_c), s.gpu_temp_c == null ? null : cToF(s.gpu_temp_c)) },
  { id: "draw", label: "Draw", color: "#10b981", toggle: "draw", unit: "W", digits: 1, value: (s) => (s.cpu_power_w == null && s.gpu_power_w == null ? null : (s.cpu_power_w ?? 0) + (s.gpu_power_w ?? 0)) },
  { id: "gpu_pct", label: "GPU", color: COLOR.gpu_pct, toggle: "channel", channelId: "gpu_pct", unit: "%", value: (s) => s.gpu_pct },
  { id: "mem", label: "Mem", color: COLOR.mem, toggle: "channel", channelId: "mem", unit: "%", value: (s) => s.mem_used_pct },
  { id: "load", label: "Load", unit: "", digits: 2, value: (s) => s.load_1m },
  { id: "humidity", label: "Humidity", unit: "%", value: (s) => s.closet_humidity },
];

// Number only — the unit is rendered as a separate muted span so value+unit don't
// read as one token (e.g. "14.9" "W" rather than "14.9W").
function fmtVal(v: number | null, digits = 0): string {
  if (v == null || !isFinite(v)) return "—";
  return (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits);
}

export function PerformanceView({ modeSwitcher }: { modeSwitcher?: ReactNode }) {
  const [range, setRange] = useState<MercuryRange>("24h");
  const [layers, setLayers] = useState<LayerState>({ detail: false, util: false });
  const [muted, setMuted] = useState<Set<string>>(() => new Set());
  const [drawMuted, setDrawMuted] = useState(false);
  const [hovered, setHovered] = useState<MercurySample | null>(null);

  const series = useMercurySeries(range);
  const latest = useMercuryLatest();

  const rows = series.data?.rows ?? [];
  const latestSample = latest.data?.sample ?? null;
  const ageSeconds = latest.data?.ageSeconds ?? null;
  const display = hovered ?? latestSample;
  const stale = ageSeconds != null && ageSeconds > STALE_SECONDS;

  const toggleMuted = useCallback((channelId: string) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId); else next.add(channelId);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    void series.mutate();
    void latest.mutate();
  }, [series, latest]);

  const isItemMuted = (item: StripItem) =>
    item.toggle === "draw" ? drawMuted : item.channelId ? muted.has(item.channelId) : false;

  const onItemClick = (item: StripItem) => {
    if (item.toggle === "draw") setDrawMuted((v) => !v);
    else if (item.channelId) toggleMuted(item.channelId);
  };

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
            {RANGES.map((r) => (
              <SecondarySegmentedButton key={r} active={range === r} onClick={() => setRange(r)} collapseLabel={false}>
                {RANGE_LABEL[r]}
              </SecondarySegmentedButton>
            ))}
          </SecondarySegmentedControl>
          <LayerToggle label="Detail" active={layers.detail} onClick={() => setLayers((l) => ({ ...l, detail: !l.detail }))} />
          <LayerToggle label="Util" active={layers.util} onClick={() => setLayers((l) => ({ ...l, util: !l.util }))} />
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
        <LoadingState label="Loading Mercury telemetry" />
      </div>
    );
  }

  if (series.error && rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-center text-sm text-red-500">
            Mercury dashboard unreachable. The collector + server run on Mercury (port 8787); check that it’s on and on the tailnet.
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
            Colored items toggle their line (dimmed when muted); plain items are readout-only stats. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border-default)] px-4 py-2">
          <span className="mr-1 w-28 shrink-0 text-xs font-medium text-[var(--text-tertiary)]">
            {hoverLabel ?? "Now"}
          </span>
          {STRIP.map((item) => {
            const v = display ? item.value(display) : null;
            const numStr = fmtVal(v, item.digits ?? 0);
            const valueEl = (
              <>
                <span className="font-mono text-[var(--text-primary)]">{numStr}</span>
                {numStr !== "—" && item.unit ? <span className="ml-0.5 text-[var(--text-tertiary)]">{item.unit}</span> : null}
              </>
            );
            if (!item.color) {
              // readout-only stat (Load, Humidity) — not a toggle, so don't render as disabled
              return (
                <span key={item.id} className="flex items-center gap-1.5 text-xs" title={item.label}>
                  <span className="text-[var(--text-tertiary)]">{item.label}</span>
                  {valueEl}
                </span>
              );
            }
            const mutedItem = isItemMuted(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemClick(item)}
                className={`flex cursor-pointer items-center gap-1.5 text-xs ${mutedItem ? "opacity-40" : ""}`}
                title={mutedItem ? `Show ${item.label}` : `Hide ${item.label}`}
              >
                <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} />
                <span className="text-[var(--text-tertiary)]">{item.label}</span>
                {valueEl}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 px-4 pb-3 pt-3">
          <PerfChart rows={rows} layers={layers} muted={muted} drawMuted={drawMuted} onHover={setHovered} />
        </div>
      </div>
    </div>
  );
}

function LayerToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors ${
        active ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}
