"use client";

import { ReactNode } from "react";
import { Calendar, AlertTriangle, Info, CheckCircle2, ArrowRight, Compass } from "lucide-react";

/**
 * Starter component library for daily briefings.
 * These are available in MDX files without explicit imports.
 * Email-safe: rendered as simple divs/tables, no complex CSS.
 */

// --- BriefingHeader ---
interface BriefingHeaderProps {
  date: string;
  title?: string;
  subtitle?: string;
}
export function BriefingHeader({ date, title, subtitle }: BriefingHeaderProps) {
  const formatted = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="mb-6 pb-4 border-b border-[var(--border-default)]">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] mb-1">
        <Calendar className="w-3.5 h-3.5" />
        <span>{formatted}</span>
      </div>
      {title && <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">{title}</h1>}
      {subtitle && <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>}
    </div>
  );
}

// --- ProjectCard ---
interface ProjectCardProps {
  name: string;
  status?: string;
  area?: string;
  icon?: string;
  description?: string;
}
export function ProjectCard({ name, status, area, icon, description }: ProjectCardProps) {
  const statusColors: Record<string, string> = {
    doing: "bg-blue-500/20 text-blue-400",
    done: "bg-emerald-500/20 text-emerald-400",
    considering: "bg-amber-500/20 text-amber-400",
    refining: "bg-purple-500/20 text-purple-400",
    blocked: "bg-red-500/20 text-red-400",
  };
  const statusClass = statusColors[status ?? ""] ?? "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] mb-2">
      <span className="text-lg flex-shrink-0">{icon ?? "📁"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[var(--text-primary)] truncate">{name}</span>
          {status && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusClass}`}>
              {status}
            </span>
          )}
        </div>
        {area && <span className="text-xs text-[var(--text-tertiary)]">{area}</span>}
        {description && <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">{description}</p>}
      </div>
    </div>
  );
}

// --- MetricRow ---
interface MetricItem {
  label: string;
  value: string | number;
  change?: string;
}
interface MetricRowProps {
  items: MetricItem[];
}
export function MetricRow({ items }: MetricRowProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)` }}>
      {items.map((item, i) => (
        <div key={i} className="p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{item.value}</div>
          <div className="text-xs text-[var(--text-tertiary)] mt-0.5">{item.label}</div>
          {item.change && (
            <div className={`text-xs mt-1 ${item.change.startsWith("+") || item.change.startsWith("↑") ? "text-emerald-400" : "text-red-400"}`}>
              {item.change}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- StatCard ---
interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  change?: string;
}
export function StatCard({ label, value, icon, change }: StatCardProps) {
  return (
    <div className="inline-flex items-center gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] mb-2 mr-2">
      {icon && <span className="text-lg">{icon}</span>}
      <div>
        <div className="text-lg font-bold text-[var(--text-primary)]">{value}</div>
        <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
        {change && <div className="text-xs text-emerald-400">{change}</div>}
      </div>
    </div>
  );
}

// --- CalloutBox ---
interface CalloutBoxProps {
  type?: "info" | "warning" | "success" | "action";
  title?: string;
  children: ReactNode;
}
export function CalloutBox({ type = "info", title, children }: CalloutBoxProps) {
  const styles = {
    info: { border: "border-blue-500/30", bg: "bg-blue-500/10", icon: <Info className="w-4 h-4 text-blue-400" /> },
    warning: { border: "border-amber-500/30", bg: "bg-amber-500/10", icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
    success: { border: "border-emerald-500/30", bg: "bg-emerald-500/10", icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
    action: { border: "border-purple-500/30", bg: "bg-purple-500/10", icon: <ArrowRight className="w-4 h-4 text-purple-400" /> },
  };
  const s = styles[type];
  return (
    <div className={`p-4 rounded-lg border ${s.border} ${s.bg} mb-4`}>
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">{s.icon}</div>
        <div className="flex-1 min-w-0">
          {title && <div className="font-medium text-sm text-[var(--text-primary)] mb-1">{title}</div>}
          <div className="text-sm text-[var(--text-secondary)] [&>p]:mb-2 [&>p:last-child]:mb-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

// --- Timeline ---
interface TimelineEvent {
  time?: string;
  title: string;
  description?: string;
  icon?: string;
}
interface TimelineProps {
  events: TimelineEvent[];
}
export function Timeline({ events }: TimelineProps) {
  if (!events || events.length === 0) return null;
  return (
    <div className="mb-4 space-y-0">
      {events.map((event, i) => (
        <div key={i} className="flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center text-xs">
              {event.icon ?? "•"}
            </div>
            {i < events.length - 1 && <div className="w-px flex-1 bg-[var(--border-default)] mt-1" />}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">{event.title}</span>
              {event.time && <span className="text-xs text-[var(--text-tertiary)]">{event.time}</span>}
            </div>
            {event.description && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{event.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- TaskSummary ---
interface TaskSummaryProps {
  done: number;
  inProgress: number;
  todo: number;
  label?: string;
}
export function TaskSummary({ done, inProgress, todo, label }: TaskSummaryProps) {
  const total = done + inProgress + todo;
  const pctDone = total > 0 ? (done / total) * 100 : 0;
  const pctProgress = total > 0 ? (inProgress / total) * 100 : 0;
  return (
    <div className="p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] mb-4">
      {label && <div className="text-xs text-[var(--text-tertiary)] mb-2">{label}</div>}
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-[var(--text-primary)]">{done} done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-sm text-[var(--text-primary)]">{inProgress} in progress</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
          <span className="text-sm text-[var(--text-primary)]">{todo} todo</span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden flex">
        <div className="bg-emerald-400 rounded-l-full" style={{ width: `${pctDone}%` }} />
        <div className="bg-blue-400" style={{ width: `${pctProgress}%` }} />
      </div>
    </div>
  );
}

// --- Section divider ---
interface SectionProps {
  title: string;
  children: ReactNode;
}
export function Section({ title, children }: SectionProps) {
  return (
    <div className="mb-6">
      <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
        <Compass className="w-4 h-4 text-[var(--text-tertiary)]" />
        {title}
      </h2>
      {children}
    </div>
  );
}

/**
 * All components available in briefing MDX without imports.
 */
export const briefingComponents = {
  BriefingHeader,
  ProjectCard,
  MetricRow,
  StatCard,
  CalloutBox,
  Timeline,
  TaskSummary,
  Section,
};
