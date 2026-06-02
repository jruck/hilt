import type { CalendarEvent } from "./types";

type CalendarVisibilityEvent = Pick<CalendarEvent, "sourceId" | "title">;

export function isVisibleCalendarForegroundEvent(event: CalendarVisibilityEvent): boolean {
  const title = event.title.trim();
  const lowerTitle = title.toLowerCase();

  if (title === "!" || title === "-") return false;
  if (lowerTitle.startsWith("canceled: ") || lowerTitle.startsWith("canceled - ")) return false;
  if (event.sourceId === "evercommerce" && isEverCommerceWaltBlock(title)) return false;

  return true;
}

function isEverCommerceWaltBlock(title: string): boolean {
  return title === "👦🏼 Walt" || title.startsWith("👦🏼 Walt (");
}
