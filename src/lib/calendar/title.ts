const LEADING_MAIL_PREFIX_RE = /^(?:fw|fwd|re)\s*[:：]\s*/i;
const LEADING_EXTERNAL_PREFIX_RE = /^(?:ext|external)\s*[:：]\s*/i;
const LEADING_EXTERNAL_BRACKET_RE = /^\[(?:ext|external|external email|external sender|external message|outside|outside sender)\]\s*/i;

export function displayCalendarEventTitle(title: string): string {
  const original = title.trim();
  let display = original;

  for (let i = 0; i < 8; i += 1) {
    const before = display;
    display = display
      .replace(LEADING_MAIL_PREFIX_RE, "")
      .replace(LEADING_EXTERNAL_PREFIX_RE, "")
      .replace(LEADING_EXTERNAL_BRACKET_RE, "")
      .trimStart();
    if (display === before) break;
  }

  return display.trim() || original || title;
}
