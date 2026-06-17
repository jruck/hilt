export const HILT_DISPLAY_TIME_ZONE = "America/New_York";

type DateFormatOptions = {
  includeYear?: boolean;
  timeZone?: string;
};

type MonthDayParts = {
  day: string;
  month: string;
  year: string;
};

function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function monthDayParts(date: Date, timeZone: string): MonthDayParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(date);

  return {
    day: parts.find((part) => part.type === "day")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
    year: parts.find((part) => part.type === "year")?.value ?? "",
  };
}

export function formatHiltWeekdayDate(date: Date, options: DateFormatOptions = {}): string {
  const { includeYear = true, timeZone = HILT_DISPLAY_TIME_ZONE } = options;
  return formatDate(date, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

export function formatHiltMonthDay(date: Date, options: DateFormatOptions = {}): string {
  const { includeYear = false, timeZone = HILT_DISPLAY_TIME_ZONE } = options;
  return formatDate(date, {
    timeZone,
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

export function formatHiltMonthYear(date: Date, timeZone = HILT_DISPLAY_TIME_ZONE): string {
  return formatDate(date, {
    timeZone,
    month: "short",
    year: "numeric",
  });
}

export function formatHiltWeekRange(start: Date, end: Date, options: DateFormatOptions = {}): string {
  const { includeYear = true, timeZone = HILT_DISPLAY_TIME_ZONE } = options;
  const startParts = monthDayParts(start, timeZone);
  const endParts = monthDayParts(end, timeZone);

  if (startParts.year === endParts.year && startParts.month === endParts.month) {
    return `${startParts.month} ${startParts.day} – ${endParts.day}${includeYear ? `, ${endParts.year}` : ""}`;
  }

  if (startParts.year === endParts.year) {
    return `${startParts.month} ${startParts.day} – ${endParts.month} ${endParts.day}${includeYear ? `, ${endParts.year}` : ""}`;
  }

  return `${startParts.month} ${startParts.day}, ${startParts.year} – ${endParts.month} ${endParts.day}, ${endParts.year}`;
}
