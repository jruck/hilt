interface TranscriptTurn {
  speaker: "you" | "guest";
  timestamp: string;
  text: string;
}

function parseTranscript(markdown: string): TranscriptTurn[] {
  const lines = markdown.split("\n");
  const turns: TranscriptTurn[] = [];
  let current: TranscriptTurn | null = null;
  const textLines: string[] = [];

  for (const line of lines) {
    // Skip H1 title
    if (line.startsWith("# ")) continue;

    // Match ### Speaker (timestamp)
    const match = line.match(
      /^###\s+(You|Guest)\s+\((\d{4}-\d{2}-\d{2}T[\d:.]+Z)\)\s*$/
    );
    if (match) {
      // Flush previous turn
      if (current) {
        current.text = textLines.join("\n").trim();
        if (current.text) turns.push(current);
        textLines.length = 0;
      }
      current = {
        speaker: match[1].toLowerCase() as "you" | "guest",
        timestamp: match[2],
        text: "",
      };
      continue;
    }

    if (current) {
      textLines.push(line);
    }
  }

  // Flush last turn
  if (current) {
    current.text = textLines.join("\n").trim();
    if (current.text) turns.push(current);
  }

  return turns;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface TranscriptViewProps {
  content: string;
}

export function TranscriptView({ content }: TranscriptViewProps) {
  const turns = parseTranscript(content);

  if (turns.length === 0) {
    return (
      <div className="text-xs text-[var(--text-tertiary)] py-2">
        Could not parse transcript
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {turns.map((turn, i) => {
        const prevTurn = i > 0 ? turns[i - 1] : null;
        const sameSpeaker = prevTurn?.speaker === turn.speaker;

        return (
          <div key={i}>
            <div className="text-[0.7rem] text-[var(--text-tertiary)] mb-0.5">
              {formatTime(turn.timestamp)}
            </div>
            {!sameSpeaker && (
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    turn.speaker === "guest"
                      ? "bg-[var(--text-tertiary)]"
                      : "border border-[var(--text-tertiary)]"
                  }`}
                />
                <span className="text-xs font-semibold text-[var(--text-tertiary)]">
                  {turn.speaker === "guest" ? "Guest" : "You"}
                </span>
              </div>
            )}
            <p className="text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
              {turn.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
