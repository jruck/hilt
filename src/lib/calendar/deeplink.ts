export const CALENDAR_EVENT_OPEN_EVENT = "hilt:open-calendar-event";
export const PENDING_CALENDAR_EVENT_STORAGE_KEY = "hilt-pending-calendar-event";

export interface CalendarEventOpenDetail {
  id: string;
  date: string;
}
