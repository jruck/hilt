export interface TimedTranscriptSegment {
  start_seconds: number;
  timestamp: string;
  text: string;
}

function parseTimestamp(value: string): number | null {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatTranscriptTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function cleanTranscriptText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[-–—:]\s*/, "")
    .trim();
}

export function parseTimedTranscript(content: string): TimedTranscriptSegment[] {
  const segments: TimedTranscriptSegment[] = [];
  let pendingTimestamp: { seconds: number; timestamp: string } | null = null;
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^WEBVTT\b/i.test(line) && !/^NOTE\b/i.test(line));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const rangeMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\s+-->\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)/);
    if (rangeMatch) {
      const seconds = parseTimestamp(rangeMatch[1].replace(/\.\d+$/, ""));
      const text = cleanTranscriptText(lines[index + 1] || "");
      if (seconds !== null && text && !/^\d+$/.test(text)) {
        segments.push({ start_seconds: seconds, timestamp: formatTranscriptTime(seconds), text });
        index += 1;
      }
      pendingTimestamp = null;
      continue;
    }

    const inlineMatch = line.match(/^(?:[-*]\s*)?(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)(?:\]|\))?(?:\s+|[ \t]*[-–—:][ \t]*)(.+)$/);
    if (inlineMatch) {
      const seconds = parseTimestamp(inlineMatch[1].replace(/\.\d+$/, ""));
      const text = cleanTranscriptText(inlineMatch[2]);
      if (seconds !== null && text) {
        segments.push({ start_seconds: seconds, timestamp: formatTranscriptTime(seconds), text });
      }
      pendingTimestamp = null;
      continue;
    }

    const timestampOnly = line.match(/^(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)(?:\]|\))?$/);
    if (timestampOnly) {
      const seconds = parseTimestamp(timestampOnly[1].replace(/\.\d+$/, ""));
      pendingTimestamp = seconds === null ? null : { seconds, timestamp: formatTranscriptTime(seconds) };
      continue;
    }

    if (pendingTimestamp) {
      const text = cleanTranscriptText(line);
      if (text) {
        segments.push({ start_seconds: pendingTimestamp.seconds, timestamp: pendingTimestamp.timestamp, text });
      }
      pendingTimestamp = null;
    }
  }

  return segments.filter((segment, index, all) => {
    const previous = all[index - 1];
    return !previous || previous.start_seconds !== segment.start_seconds || previous.text !== segment.text;
  });
}
