import type { CalendarEvent } from "./types";

const MINUTE_MS = 60_000;

export type HudAgendaItem =
  | { kind: "event"; event: CalendarEvent }
  | { kind: "free"; id: string; start: Date; end: Date; minutes: number };
export type HudAgendaConflictPosition = "single" | "start" | "middle" | "end";

export function selectHudNextEventGroup(
  events: CalendarEvent[],
  currentEvent: CalendarEvent | null,
  now: Date,
): CalendarEvent[] {
  const nowTime = now.getTime();
  const orderedEvents = sortHudEvents(events);
  const firstNextEvent = orderedEvents.find((event) => (
    (!currentEvent || event.id !== currentEvent.id)
    && new Date(event.end).getTime() > nowTime
    && new Date(event.start).getTime() >= nowTime
  ));
  if (!firstNextEvent) return [];

  const firstStartMinute = eventStartMinute(firstNextEvent);
  return orderedEvents.filter((event) => (
    (!currentEvent || event.id !== currentEvent.id)
    && new Date(event.end).getTime() > nowTime
    && new Date(event.start).getTime() >= nowTime
    && eventStartMinute(event) === firstStartMinute
  ));
}

export function buildHudAgendaItems(
  events: CalendarEvent[],
  now: Date,
  currentEvent: CalendarEvent | null,
  options: { freeBlockMinutes: number; maxItems: number },
): HudAgendaItem[] {
  const items: HudAgendaItem[] = [];
  const currentEnd = currentEvent ? new Date(currentEvent.end) : null;
  const agendaFloor = currentEnd ?? now;
  let cursor = agendaFloor;

  for (const event of sortHudEvents(events)) {
    if (currentEvent && event.id === currentEvent.id) continue;

    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    if (eventEnd <= now) continue;

    if (eventStart < cursor) {
      items.push({ kind: "event", event });
      if (eventEnd > cursor) cursor = eventEnd;
      if (items.length >= options.maxItems) break;
      continue;
    }

    const freeMinutes = Math.floor((eventStart.getTime() - cursor.getTime()) / MINUTE_MS);
    if (freeMinutes >= options.freeBlockMinutes) {
      items.push({
        kind: "free",
        id: `free-${cursor.toISOString()}-${event.start}`,
        start: cursor,
        end: eventStart,
        minutes: freeMinutes,
      });
    }

    items.push({ kind: "event", event });
    if (eventEnd > cursor) cursor = eventEnd;
    if (items.length >= options.maxItems) break;
  }

  return items.slice(0, options.maxItems);
}

export function hudAgendaConflictPositions(items: HudAgendaItem[]): Map<string, HudAgendaConflictPosition> {
  const positions = new Map<string, HudAgendaConflictPosition>();
  const events = items
    .map((item, index) => item.kind === "event" ? {
      end: new Date(item.event.end).getTime(),
      event: item.event,
      index,
      start: new Date(item.event.start).getTime(),
    } : null)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  let cluster: typeof events = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flushCluster = () => {
    if (cluster.length < 2) {
      cluster = [];
      return;
    }
    cluster.forEach((entry, index) => {
      const position = cluster.length === 1
        ? "single"
        : index === 0
          ? "start"
          : index === cluster.length - 1
            ? "end"
            : "middle";
      positions.set(entry.event.id, position);
    });
    cluster = [];
  };

  for (const entry of events) {
    if (!cluster.length) {
      cluster = [entry];
      clusterEnd = entry.end;
      continue;
    }

    if (entry.start < clusterEnd) {
      cluster.push(entry);
      clusterEnd = Math.max(clusterEnd, entry.end);
      continue;
    }

    flushCluster();
    cluster = [entry];
    clusterEnd = entry.end;
  }
  flushCluster();

  return positions;
}

function sortHudEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => (
    a.sortStart - b.sortStart
    || a.sortEnd - b.sortEnd
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id)
  ));
}

function eventStartMinute(event: CalendarEvent): number {
  return Math.floor(new Date(event.start).getTime() / MINUTE_MS);
}
