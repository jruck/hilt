import path from "path";

/**
 * Where a generated briefing is written. Ports the deterministic date/mode logic from the vault
 * gatherer (`bridge/meta/skills/briefing/scripts/gather.sh`) so the Hilt-native runner targets the
 * exact same files Hermes did. Daily → `briefings/<date>.md`; weekend → `briefings/weekend/<sat>.md`
 * anchored on the Saturday of the week (a Sunday run targets the SAME Saturday file).
 */
export type BriefingMode = "daily" | "weekend";

export interface BriefingTarget {
  mode: BriefingMode;
  /** The date the briefing is *for* (daily: that day; weekend: the Saturday anchor). */
  targetDate: string;
  /** Vault-relative path, e.g. "briefings/2026-06-26.md" or "briefings/weekend/2026-06-20.md". */
  relPath: string;
  /** Absolute path = join(vaultPath, relPath). */
  absPath: string;
  /** Weekend only: the Sat→Sun range for frontmatter. */
  dateRange?: { start: string; end: string };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Parse YYYY-MM-DD as a UTC calendar date (noon UTC avoids any tz/DST date-shift). */
function parseUtc(date: string): Date {
  if (!ISO.test(date)) throw new Error(`invalid date (want YYYY-MM-DD): ${date}`);
  return new Date(`${date}T12:00:00.000Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** The Saturday that anchors the weekend file for a given base date (JS getUTCDay: Sun=0..Sat=6). */
export function weekendSaturday(baseDate: string): string {
  const d = parseUtc(baseDate);
  const day = d.getUTCDay();
  if (day === 0) return fmt(addDays(d, -1)); // Sunday → previous Saturday
  if (day === 6) return fmt(d); // Saturday → itself
  return fmt(addDays(d, 6 - day)); // Mon–Fri → upcoming Saturday
}

export function resolveBriefingTarget(
  vaultPath: string,
  mode: BriefingMode,
  baseDate: string,
  outputOverride?: string | null,
): BriefingTarget {
  if (mode === "weekend") {
    const start = weekendSaturday(baseDate);
    const end = fmt(addDays(parseUtc(start), 1));
    const relPath = path.join("briefings", "weekend", `${start}.md`);
    return {
      mode,
      targetDate: start,
      relPath,
      absPath: outputOverride ? path.resolve(outputOverride) : path.join(vaultPath, relPath),
      dateRange: { start, end },
    };
  }
  if (!ISO.test(baseDate)) throw new Error(`invalid date (want YYYY-MM-DD): ${baseDate}`);
  const relPath = path.join("briefings", `${baseDate}.md`);
  return {
    mode,
    targetDate: baseDate,
    relPath,
    absPath: outputOverride ? path.resolve(outputOverride) : path.join(vaultPath, relPath),
  };
}
