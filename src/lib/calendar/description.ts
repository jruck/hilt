import { htmlToText } from "./links";

export interface CalendarDescriptionDisplay {
  full: string | null;
  hidden: string | null;
  visible: string | null;
}

export function prepareCalendarDescription(description: string | null | undefined): CalendarDescriptionDisplay {
  const full = normalizeDescriptionForDisplay(description);
  if (!full) return { full: null, hidden: null, visible: null };

  const lines = full.split("\n");
  const cruftStart = findGeneratedDetailsStart(lines);
  if (cruftStart === null) return { full, hidden: null, visible: full };

  const visible = trimDescriptionLines(lines.slice(0, cruftStart));
  const hidden = trimDescriptionLines(lines.slice(cruftStart));
  return {
    full,
    hidden: hidden || full,
    visible,
  };
}

export function normalizeDescriptionForDisplay(description: string | null | undefined): string | null {
  if (!description) return null;
  const text = looksLikeHtml(description) ? htmlToText(description) : description;
  const normalized = text
    ?.replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized || null;
}

function findGeneratedDetailsStart(lines: string[]): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isProviderDetailsStarter(line)) return index;
    if (isSeparatorLine(line)) {
      const next = nextContentLine(lines, index + 1);
      if (next && isProviderDetailsStarter(next)) return index;
    }
  }
  return null;
}

function trimDescriptionLines(lines: string[]): string | null {
  let start = 0;
  let end = lines.length;
  while (start < end && isDiscardableEdgeLine(lines[start])) start += 1;
  while (end > start && isDiscardableEdgeLine(lines[end - 1])) end -= 1;
  const text = lines.slice(start, end).join("\n").trim();
  return text || null;
}

function nextContentLine(lines: string[], start: number): string | null {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line) return line;
  }
  return null;
}

function looksLikeHtml(value: string): boolean {
  return /<(?:a|br|div|html|li|ol|p|span|table|td|tr|ul)\b|<\/(?:a|div|li|ol|p|span|table|td|tr|ul)>|&(?:amp|gt|lt|nbsp|quot|#39);/i.test(value);
}

function isDiscardableEdgeLine(line: string): boolean {
  return !line.trim() || isSeparatorLine(line);
}

function isSeparatorLine(line: string): boolean {
  return /^[-_=*\s]{6,}$/.test(line.trim());
}

function isProviderDetailsStarter(line: string): boolean {
  const text = line.trim().replace(/\s+/g, " ");
  if (!text) return false;
  return [
    /^Microsoft Teams(?: meeting| Need help|\b)/i,
    /^Join the meeting now\b/i,
    /^Join on your computer\b/i,
    /^Click here to join the meeting\b/i,
    /^Download Teams\b/i,
    /^For organizers: Meeting options\b/i,
    /^Need help\?/i,
    /^Learn More\b/i,
    /^System reference\b/i,
    /\bis inviting you to a scheduled Zoom meeting\.?$/i,
    /^Join Zoom Meeting\b/i,
    /^Zoom Meeting\b/i,
    /^One tap mobile\b/i,
    /^Join by SIP\b/i,
    /^Join instructions\b/i,
    /^Google Meet joining info\b/i,
    /^Join with Google Meet\b/i,
    /^Video call link:/i,
    /^Or dial:/i,
    /^PIN:/i,
    /^More phone numbers:/i,
    /^Meeting ID:/i,
    /^Passcode:/i,
  ].some((pattern) => pattern.test(text));
}
