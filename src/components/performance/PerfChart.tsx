"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MercurySample } from "@/hooks/useMercury";

// Hand-rolled SVG time-series ("Closet Climate Strip", per the design panel).
// Ambient temps (closet/room/outdoor) and hot die temps (cpu/gpu) live in very
// different °F regimes, so a single shared axis flattens the closet band. We use
// TWO °F axes: left auto-fits ambient (closet variation stays legible — the whole
// point for airflow tuning), right carries the hot die temps. Both are time-aligned
// so correlation reads across. Compute power draw is a soft filled wash behind the
// lines; a hidden 0–100 scale carries utilization lines under the Util layer.
// Hilt ships no chart library by design; chrome uses theme CSS vars, series an
// explicit palette. Null samples break the line (no interpolation).

export const cToF = (c: number) => c * 9 / 5 + 32;
const maxOrNull = (a: number | null, b: number | null) =>
  a == null && b == null ? null : Math.max(a ?? -Infinity, b ?? -Infinity);

export type LayerState = { detail: boolean; util: boolean };
type Axis = "cool" | "hot" | "pct";

// Palette — closet is the red hero; compute/cpu/gpu are a violet "chip" family
// (distinct from closet red so the two hero lines never read as one); ambient
// closet/room/outdoor are cool blues (light enough for the dark canvas);
// utilization is cyan/teal. Closet color also lives in PerformanceView's strip.
export const COLOR = {
  closet: "#ef4444",
  room: "#60a5fa",
  outdoor: "#93c5fd",
  compute: "#a855f7",
  cpu_temp: "#c084fc",
  gpu_temp: "#f472b6",
  mem: "#818cf8",
  cpu_pct: "#22d3ee",
  gpu_pct: "#2dd4bf",
} as const;

export interface Channel {
  id: string;
  label: string;
  color: string;
  unit: string;
  axis: Axis;
  layer: "base" | "detail" | "util";
  dashed?: boolean;
  hero?: boolean;
  value: (s: MercurySample) => number | null;
}

export const CHANNELS: Channel[] = [
  { id: "closet", label: "Closet", color: COLOR.closet, unit: "°F", axis: "cool", layer: "base", hero: true, value: (s) => s.closet_temp_f },
  // Outdoor (NWS) is the ambient reference; Dreo room temp was dropped (unreliable cloud).
  { id: "outdoor", label: "Outdoor", color: COLOR.outdoor, unit: "°F", axis: "cool", layer: "base", dashed: true, value: (s) => s.outdoor_temp_f },
  { id: "compute", label: "Compute", color: COLOR.compute, unit: "°F", axis: "hot", layer: "base", value: (s) => maxOrNull(s.cpu_temp_c == null ? null : cToF(s.cpu_temp_c), s.gpu_temp_c == null ? null : cToF(s.gpu_temp_c)) },
  { id: "cpu_temp", label: "CPU °F", color: COLOR.cpu_temp, unit: "°F", axis: "hot", layer: "detail", value: (s) => (s.cpu_temp_c == null ? null : cToF(s.cpu_temp_c)) },
  { id: "gpu_temp", label: "GPU °F", color: COLOR.gpu_temp, unit: "°F", axis: "hot", layer: "detail", value: (s) => (s.gpu_temp_c == null ? null : cToF(s.gpu_temp_c)) },
  { id: "mem", label: "Mem %", color: COLOR.mem, unit: "%", axis: "pct", layer: "util", dashed: true, value: (s) => s.mem_used_pct },
  { id: "cpu_pct", label: "CPU %", color: COLOR.cpu_pct, unit: "%", axis: "pct", layer: "util", dashed: true, value: (s) => s.cpu_pct },
  { id: "gpu_pct", label: "GPU %", color: COLOR.gpu_pct, unit: "%", axis: "pct", layer: "util", dashed: true, value: (s) => s.gpu_pct },
];

const M = { top: 24, right: 46, bottom: 24, left: 42 };
const MIN_H = 280;

function activeChannels(layers: LayerState, muted: Set<string>): Channel[] {
  return CHANNELS.filter((c) => {
    if (muted.has(c.id)) return false;
    if (c.id === "compute" && layers.detail) return false; // replaced by per-chip lines
    if (c.layer === "base") return true;
    if (c.layer === "detail") return layers.detail;
    return layers.util;
  });
}

function fmtTime(tsSec: number, spanSec: number): string {
  const d = new Date(tsSec * 1000);
  if (spanSec > 36 * 3600) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// "Nice" axis: snap the domain to a rounded step so tick labels are evenly spaced.
function niceStep(range: number, targetTicks: number): number {
  const raw = (range || 1) / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return step * pow;
}
function niceDomain(channels: Channel[], rows: MercurySample[], targetTicks: number, fallback: [number, number]): { lo: number; hi: number; step: number; ticks: number[] } {
  const vals: number[] = [];
  for (const c of channels) for (const r of rows) {
    const v = c.value(r);
    if (v != null && isFinite(v)) vals.push(v);
  }
  let lo = fallback[0]; let hi = fallback[1];
  if (vals.length) { lo = Math.min(...vals); hi = Math.max(...vals); }
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, targetTicks);
  let nlo = Math.floor(lo / step) * step;
  let nhi = Math.ceil(hi / step) * step;
  // Headroom so a series never rides the very top/bottom edge (avoids the line
  // colliding with the unit caption / x-axis and reading as a glitch).
  if (nhi - hi < step * 0.3) nhi += step;
  if (lo - nlo < step * 0.3) nlo -= step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: nlo, hi: nhi, step, ticks };
}

interface PerfChartProps {
  rows: MercurySample[];
  layers: LayerState;
  muted: Set<string>;
  drawMuted: boolean;
  onHover: (sample: MercurySample | null) => void;
}

export function PerfChart({ rows, layers, muted, drawMuted, onHover }: PerfChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 360 });
  const [hoverTs, setHoverTs] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const valid = useMemo(() => rows.filter((r) => typeof r.ts === "number"), [rows]);
  const active = useMemo(() => activeChannels(layers, muted), [layers, muted]);

  const { xMin, xSpan, cool, hot, hasCool, hasHot, hasPct } = useMemo(() => {
    const xs = valid.map((r) => r.ts);
    const xMin = xs.length ? Math.min(...xs) : 0;
    const xMax = xs.length ? Math.max(...xs) : 1;
    const coolCh = active.filter((c) => c.axis === "cool");
    const hotCh = active.filter((c) => c.axis === "hot");
    const has = (cs: Channel[]) => cs.some((c) => valid.some((r) => { const v = c.value(r); return v != null && isFinite(v); }));
    return {
      xMin,
      xSpan: Math.max(1, xMax - xMin),
      cool: niceDomain(coolCh, valid, 4, [70, 90]),
      hot: niceDomain(hotCh, valid, 4, [90, 150]),
      hasCool: has(coolCh),
      hasHot: has(hotCh),
      hasPct: layers.util && has(active.filter((c) => c.axis === "pct")),
    };
  }, [valid, active, layers.util]);

  const width = size.w;
  const chartH = Math.max(MIN_H, size.h || 360);
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = chartH - M.top - M.bottom;
  const xScale = (ts: number) => M.left + ((ts - xMin) / xSpan) * innerW;
  const mapY = (lo: number, hi: number, v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * innerH;
  const yFor = (c: Channel, v: number) => (c.axis === "cool" ? mapY(cool.lo, cool.hi, v) : c.axis === "hot" ? mapY(hot.lo, hot.hi, v) : mapY(0, 100, v));

  const washPath = useMemo(() => {
    if (drawMuted || !valid.length) return null;
    const draws = valid.map((r) => (r.cpu_power_w == null && r.gpu_power_w == null ? null : (r.cpu_power_w ?? 0) + (r.gpu_power_w ?? 0)));
    const nums = draws.filter((v): v is number => v != null && isFinite(v));
    if (nums.length < 2) return null;
    const lo = Math.min(...nums); const hi = Math.max(...nums);
    const norm = (v: number) => (hi === lo ? 0.4 : (v - lo) / (hi - lo));
    const floor = M.top + innerH;
    let top = "";
    valid.forEach((r, i) => {
      const v = draws[i];
      const y = v == null ? floor : floor - norm(v) * innerH * 0.5;
      top += `${i === 0 ? "M" : "L"}${xScale(r.ts).toFixed(1)} ${y.toFixed(1)} `;
    });
    return `${top}L${xScale(valid[valid.length - 1].ts).toFixed(1)} ${floor} L${xScale(valid[0].ts).toFixed(1)} ${floor} Z`;
    // xScale is derived from xMin/xSpan/innerW, which are already deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, drawMuted, innerH, xMin, xSpan, innerW]);

  const linePath = (c: Channel) => {
    let d = ""; let pen = false;
    for (const r of valid) {
      const v = c.value(r);
      if (v != null && isFinite(v)) {
        d += `${pen ? "L" : "M"}${xScale(r.ts).toFixed(1)} ${yFor(c, v).toFixed(1)} `;
        pen = true;
      } else pen = false;
    }
    return d;
  };

  const xTickN = Math.max(2, Math.min(7, Math.floor(innerW / 110)));
  const xTicks = Array.from({ length: xTickN + 1 }, (_, i) => xMin + (xSpan * i) / xTickN);
  const hoverRow = hoverTs != null ? valid.find((r) => r.ts === hoverTs) : null;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    if (!valid.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ts = xMin + (((e.clientX - rect.left) / rect.width) * width - M.left) / innerW * xSpan;
    let best = valid[0]; let bestD = Infinity;
    for (const r of valid) { const d = Math.abs(r.ts - ts); if (d < bestD) { bestD = d; best = r; } }
    setHoverTs(best.ts); onHover(best);
  }
  function onLeave() { setHoverTs(null); onHover(null); }

  if (!valid.length) {
    return (
      <div ref={wrapRef} className="flex h-full min-h-[280px] w-full items-center justify-center text-sm text-[var(--text-tertiary)]">
        No samples in this range yet.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="h-full min-h-[280px] w-full">
      <svg width={width} height={chartH} role="img" aria-label="Mercury performance time series">
        {/* left (ambient °F) gridlines + tick labels; unit is a caption above, tinted to closet */}
        {hasCool ? cool.ticks.map((t) => {
          const y = mapY(cool.lo, cool.hi, t);
          return (
            <g key={`c${t}`}>
              <line x1={M.left} y1={y} x2={width - M.right} y2={y} stroke="var(--border-default)" strokeOpacity={0.6} strokeWidth={1} />
              <text x={M.left - 5} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-tertiary)">{t}</text>
            </g>
          );
        }) : null}
        {hasCool ? <text x={M.left - 5} y={12} textAnchor="end" fontSize={9} fontWeight={600} fill={COLOR.closet}>°F</text> : null}

        {/* right (hot die °F) tick labels; unit caption above, tinted to compute */}
        {hasHot ? hot.ticks.map((t) => (
          <text key={`h${t}`} x={width - M.right + 5} y={mapY(hot.lo, hot.hi, t) + 3} textAnchor="start" fontSize={10} fill="var(--text-tertiary)">{t}</text>
        )) : null}
        {hasHot ? <text x={width - M.right + 5} y={12} textAnchor="start" fontSize={9} fontWeight={600} fill={COLOR.compute}>chip °F</text> : null}

        {/* x labels */}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={xScale(t)} y={chartH - 6} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">{fmtTime(t, xSpan)}</text>
        ))}

        {/* power wash (cpu+gpu watts, normalized) + label so it reads as data, not decoration */}
        {washPath ? <path d={washPath} fill="var(--status-active)" fillOpacity={0.14} stroke="none" /> : null}
        {washPath ? <text x={M.left + 3} y={M.top + innerH - 4} textAnchor="start" fontSize={9} fill="var(--status-active)" opacity={0.85}>compute draw (W)</text> : null}

        {/* crosshair */}
        {hoverTs != null ? <line x1={xScale(hoverTs)} y1={M.top} x2={xScale(hoverTs)} y2={M.top + innerH} stroke="var(--text-tertiary)" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 3" /> : null}

        {/* series */}
        {active.map((c) => (
          <path key={c.id} d={linePath(c)} fill="none" stroke={c.color}
            strokeWidth={c.hero ? 2 : c.dashed ? 1.1 : 1.5}
            strokeDasharray={c.dashed ? "4 3" : undefined}
            strokeLinejoin="round" strokeLinecap="round" opacity={c.dashed ? 0.8 : 0.95} />
        ))}

        {/* hover dots */}
        {hoverRow ? active.map((c) => {
          const v = c.value(hoverRow);
          if (v == null || !isFinite(v)) return null;
          return <circle key={`d${c.id}`} cx={xScale(hoverRow.ts)} cy={yFor(c, v)} r={2.8} fill={c.color} />;
        }) : null}

        {hasPct ? <text x={width - M.right - 2} y={chartH - 6} textAnchor="end" fontSize={9} fill="var(--text-tertiary)" opacity={0.7}>util 0–100%</text> : null}

        <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={onLeave} />
      </svg>
    </div>
  );
}
