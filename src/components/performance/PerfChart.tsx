"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MachineMeta, TelemetrySample } from "@/lib/system/telemetry/types";

// Hand-rolled SVG time-series — the "Closet Climate Strip".
// TWO independent °F axes, each auto-fit to its own data so both stretch to fill the
// height: LEFT (ambient) carries closet + outdoor — human-range temps, where the
// 85/90 bands live; RIGHT (chip) carries one compute (die-temp) line per machine,
// which runs ~40°F hotter and would otherwise crush the ambient variation on one
// shared scale. Closet is the hero — thick and smoothly color-faded by temperature
// (green ≤85 → amber → red ≥90 ceiling). Outdoor is a faint backdrop wash (sparse
// data, filled across gaps). Compute lines are generated per machine from the series
// catalog, each its own color. Hilt ships no chart library by design; chrome uses
// theme CSS vars. Null samples break lines (no interpolation).

export const cToF = (c: number) => (c * 9) / 5 + 32;
const maxOrNull = (a: number | null, b: number | null) =>
  a == null && b == null ? null : Math.max(a ?? -Infinity, b ?? -Infinity);

export const CLOSET_WARN = 85; // °F — below = green
export const CLOSET_CEILING = 90; // °F — at/above = redline
export const ZONE = { green: "#22c55e", yellow: "#eab308", red: "#ef4444" } as const;
// Ambient swatches; closet's swatch is dynamic (its live fade color). Per-machine
// compute colors come from the series catalog (MachineMeta.color), not here.
export const COLOR = { closet: ZONE.red, outdoor: "#60a5fa" } as const;

// Smooth temperature → color for the closet line: solid green at/below 85°F, a
// green→amber→red fade across the caution band, solid red at/above 90°F. RGB-lerped
// through a yellow midpoint so the band reads amber rather than a muddy blend.
const RGB = { green: [34, 197, 94], yellow: [234, 179, 8], red: [239, 68, 68] } as const;
const mix = (a: readonly number[], b: readonly number[], t: number) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const toHex = (c: number[]) =>
  `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
export function closetColor(f: number | null): string {
  if (f == null || f <= CLOSET_WARN) return toHex([...RGB.green]);
  if (f >= CLOSET_CEILING) return toHex([...RGB.red]);
  const mid = (CLOSET_WARN + CLOSET_CEILING) / 2; // 87.5°F — amber center of the band
  return f <= mid
    ? toHex(mix(RGB.green, RGB.yellow, (f - CLOSET_WARN) / (mid - CLOSET_WARN)))
    : toHex(mix(RGB.yellow, RGB.red, (f - mid) / (CLOSET_CEILING - mid)));
}

// Compute (chip) temp for a machine in a sample: hotter of its CPU/GPU die, °F.
export function machineComputeF(s: TelemetrySample, machineId: string): number | null {
  const c = s.machines[machineId];
  if (!c) return null;
  return maxOrNull(c.cpu_temp_c == null ? null : cToF(c.cpu_temp_c), c.gpu_temp_c == null ? null : cToF(c.gpu_temp_c));
}

const closetF = (s: TelemetrySample) => s.closet_temp_f;
const outdoorF = (s: TelemetrySample) => s.outdoor_temp_f;

const M = { top: 24, right: 44, bottom: 24, left: 42 };
const MIN_H = 280;

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
function niceDomain(vals: number[], targetTicks: number, fallback: [number, number]) {
  let lo = fallback[0];
  let hi = fallback[1];
  if (vals.length) {
    lo = Math.min(...vals);
    hi = Math.max(...vals);
  }
  if (hi - lo < 1) {
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo, targetTicks);
  let nlo = Math.floor(lo / step) * step;
  let nhi = Math.ceil(hi / step) * step;
  if (nhi - hi < step * 0.3) nhi += step;
  if (lo - nlo < step * 0.3) nlo -= step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: nlo, hi: nhi, step, ticks };
}

interface PerfChartProps {
  rows: TelemetrySample[];
  machines: MachineMeta[];
  muted: Set<string>;
  onHover: (sample: TelemetrySample | null) => void;
}

export function PerfChart({ rows, machines, muted, onHover }: PerfChartProps) {
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
  const show = (id: string) => !muted.has(id);

  // One right-axis (chip) series per machine, keyed "compute:<machineId>".
  const computeSeries = useMemo(
    () =>
      machines.map((m) => ({
        id: `compute:${m.id}`,
        machineId: m.id,
        color: m.color,
        label: m.label,
        value: (s: TelemetrySample) => machineComputeF(s, m.id),
      })),
    [machines],
  );

  const { xMin, xSpan, cool, hot, hasHot } = useMemo(() => {
    const xs = valid.map((r) => r.ts);
    const xMin = xs.length ? Math.min(...xs) : 0;
    const xMax = xs.length ? Math.max(...xs) : 1;
    const collect = (accessors: Array<(s: TelemetrySample) => number | null>) => {
      const vals: number[] = [];
      for (const get of accessors) {
        for (const r of valid) {
          const v = get(r);
          if (v != null && isFinite(v)) vals.push(v);
        }
      }
      return vals;
    };
    const coolVals = collect([
      ...(muted.has("closet") ? [] : [closetF]),
      ...(muted.has("outdoor") ? [] : [outdoorF]),
    ]);
    // Keep the closet thresholds in frame on the ambient axis whenever closet shows.
    if (!muted.has("closet")) coolVals.push(CLOSET_WARN, CLOSET_CEILING);
    const hotVals = collect(computeSeries.filter((c) => show(c.id)).map((c) => c.value));
    return {
      xMin,
      xSpan: Math.max(1, xMax - xMin),
      cool: niceDomain(coolVals, 4, [70, 92]),
      hot: niceDomain(hotVals, 4, [90, 150]),
      hasHot: hotVals.length > 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, muted, computeSeries]);

  const width = size.w;
  const chartH = Math.max(MIN_H, size.h || 360);
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = chartH - M.top - M.bottom;
  const floor = M.top + innerH;
  const xScale = (ts: number) => M.left + ((ts - xMin) / xSpan) * innerW;
  const mapYCool = (v: number) => M.top + (1 - (v - cool.lo) / (cool.hi - cool.lo || 1)) * innerH;
  const mapYHot = (v: number) => M.top + (1 - (v - hot.lo) / (hot.hi - hot.lo || 1)) * innerH;
  const clampY = (y: number) => Math.max(M.top, Math.min(floor, y));

  // Outdoor backdrop: continuous filled area (bridges gaps — sparse upstream data).
  const outdoorFill = useMemo(() => {
    if (muted.has("outdoor") || !valid.length) return null;
    const pts = valid
      .map((r) => ({ x: xScale(r.ts), v: r.outdoor_temp_f }))
      .filter((p): p is { x: number; v: number } => p.v != null && isFinite(p.v));
    if (pts.length < 2) return null;
    let d = `M${pts[0].x.toFixed(1)} ${mapYCool(pts[0].v).toFixed(1)} `;
    for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(1)} ${mapYCool(pts[i].v).toFixed(1)} `;
    d += `L${pts[pts.length - 1].x.toFixed(1)} ${floor.toFixed(1)} L${pts[0].x.toFixed(1)} ${floor.toFixed(1)} Z`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, muted, cool, innerH, xMin, xSpan, innerW]);

  // Closet hero: per-color runs so the line itself fades green→amber→red by temp,
  // quantized to 0.5°F (one <path> per run) with boundary points carried so they join.
  const closetSegs = useMemo(() => {
    if (muted.has("closet") || !valid.length) return [] as { d: string; color: string }[];
    const xS = (ts: number) => M.left + ((ts - xMin) / xSpan) * innerW;
    const yS = (v: number) => M.top + (1 - (v - cool.lo) / (cool.hi - cool.lo || 1)) * innerH;
    const colorOf = (f: number) => closetColor(Math.round(f * 2) / 2);
    const out: { d: string; color: string }[] = [];
    let pts: { x: number; y: number }[] = [];
    let color = "";
    const flush = () => {
      if (pts.length) out.push({ d: `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")}`, color });
      pts = [];
    };
    for (const r of valid) {
      const v = r.closet_temp_f;
      if (v == null || !isFinite(v)) {
        flush();
        continue;
      }
      const c = colorOf(v);
      const p = { x: xS(r.ts), y: yS(v) };
      if (!pts.length) {
        color = c;
        pts = [p];
      } else if (c === color) {
        pts.push(p);
      } else {
        pts.push(p);
        flush();
        color = c;
        pts = [p];
      }
    }
    flush();
    return out;
  }, [valid, muted, cool, innerH, xMin, xSpan, innerW]);

  const linePath = (value: (s: TelemetrySample) => number | null, mapYFn: (v: number) => number) => {
    let d = "";
    let pen = false;
    for (const r of valid) {
      const v = value(r);
      if (v != null && isFinite(v)) {
        d += `${pen ? "L" : "M"}${xScale(r.ts).toFixed(1)} ${mapYFn(v).toFixed(1)} `;
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
    const ts = xMin + ((((e.clientX - rect.left) / rect.width) * width - M.left) / innerW) * xSpan;
    let best = valid[0];
    let bestD = Infinity;
    for (const r of valid) {
      const d = Math.abs(r.ts - ts);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    setHoverTs(best.ts);
    onHover(best);
  }
  function onLeave() {
    setHoverTs(null);
    onHover(null);
  }

  if (!valid.length) {
    return (
      <div
        ref={wrapRef}
        className="flex h-full min-h-[280px] w-full items-center justify-center text-sm text-[var(--text-tertiary)]"
      >
        No samples in this range yet.
      </div>
    );
  }

  const showBands = show("closet");
  const yWarn = clampY(mapYCool(CLOSET_WARN)); // 85°F
  const yCeil = clampY(mapYCool(CLOSET_CEILING)); // 90°F

  const hoverDots = hoverRow
    ? [
        show("outdoor") ? { v: outdoorF(hoverRow), color: COLOR.outdoor, map: mapYCool } : null,
        ...computeSeries
          .filter((c) => show(c.id))
          .map((c) => ({ v: c.value(hoverRow), color: c.color, map: mapYHot })),
        show("closet") ? { v: closetF(hoverRow), color: closetColor(closetF(hoverRow)), map: mapYCool } : null,
      ]
    : [];

  return (
    <div ref={wrapRef} className="h-full min-h-[280px] w-full">
      <svg width={width} height={chartH} role="img" aria-label="Closet climate time series">
        {/* outdoor backdrop — kept faint so it stays behind the scenes */}
        {outdoorFill ? <path d={outdoorFill} fill={COLOR.outdoor} fillOpacity={0.08} stroke="none" /> : null}

        {/* left (ambient °F) gridlines + tick labels */}
        {cool.ticks.map((t) => {
          const y = mapYCool(t);
          if (y < M.top - 0.5 || y > floor + 0.5) return null;
          return (
            <g key={`g${t}`}>
              <line x1={M.left} y1={y} x2={width - M.right} y2={y} stroke="var(--border-default)" strokeOpacity={0.5} strokeWidth={1} />
              <text x={M.left - 5} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-tertiary)">
                {t}
              </text>
            </g>
          );
        })}
        <text x={M.left - 5} y={12} textAnchor="end" fontSize={9} fontWeight={600} fill="var(--text-tertiary)">
          °F
        </text>

        {/* right (chip °F) tick labels — own auto-fit axis, no gridlines to avoid clutter */}
        {hasHot ? (
          <g>
            {hot.ticks.map((t) => {
              const y = mapYHot(t);
              if (y < M.top - 0.5 || y > floor + 0.5) return null;
              return (
                <text key={`h${t}`} x={width - M.right + 5} y={y + 3} textAnchor="start" fontSize={10} fill="var(--text-tertiary)">
                  {t}
                </text>
              );
            })}
            <text x={width - M.right + 5} y={12} textAnchor="start" fontSize={9} fontWeight={600} fill="var(--text-tertiary)">
              chip °F
            </text>
          </g>
        ) : null}

        {/* threshold reference lines */}
        {showBands ? (
          <g>
            <line x1={M.left} y1={yWarn} x2={width - M.right} y2={yWarn} stroke={ZONE.yellow} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="4 4" />
            <line x1={M.left} y1={yCeil} x2={width - M.right} y2={yCeil} stroke={ZONE.red} strokeOpacity={0.8} strokeWidth={1} strokeDasharray="4 4" />
            <text x={width - M.right} y={yCeil - 4} textAnchor="end" fontSize={9} fontWeight={600} fill={ZONE.red} opacity={0.9}>
              90° ceiling
            </text>
          </g>
        ) : null}

        {/* x labels */}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={xScale(t)} y={chartH - 6} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">
            {fmtTime(t, xSpan)}
          </text>
        ))}

        {/* crosshair */}
        {hoverTs != null ? (
          <line x1={xScale(hoverTs)} y1={M.top} x2={xScale(hoverTs)} y2={floor} stroke="var(--text-tertiary)" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 3" />
        ) : null}

        {/* per-machine compute lines on the right (chip) axis — drawn under closet */}
        {computeSeries
          .filter((c) => show(c.id))
          .map((c) => (
            <path
              key={c.id}
              d={linePath(c.value, mapYHot)}
              fill="none"
              stroke={c.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          ))}

        {/* closet (hero) — smoothly color-faded by temperature, drawn as per-color runs */}
        {closetSegs.map((s, i) => (
          <path key={`cl${i}`} d={s.d} fill="none" stroke={s.color} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* hover dots — each on its own axis */}
        {hoverRow
          ? hoverDots.map((d, i) =>
              d && d.v != null && isFinite(d.v) ? (
                <circle key={i} cx={xScale(hoverRow.ts)} cy={d.map(d.v)} r={3} fill={d.color} />
              ) : null,
            )
          : null}

        <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={onLeave} />
      </svg>
    </div>
  );
}
