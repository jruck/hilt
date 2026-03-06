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
    <div className="space-y-3">
      {turns.map((turn, i) => {
        const prevTurn = i > 0 ? turns[i - 1] : null;
        const sameSpeaker = prevTurn?.speaker === turn.speaker;
        const isYou = turn.speaker === "you";

        return (
          <div
            key={i}
            className={`flex flex-col ${isYou ? "items-end" : "items-start"}`}
          >
            <div className="text-[0.65rem] text-[var(--text-tertiary)] mb-0.5">
              {formatTime(turn.timestamp)}
            </div>
            {!sameSpeaker && (
              <div className="text-[11px] font-medium text-[var(--text-tertiary)] mb-1">
                {isYou ? "You" : "Them"}
              </div>
            )}
            <div
              className={`max-w-[80%] ${
                isYou
                  ? "bg-[var(--bg-tertiary)] rounded-lg px-3 py-2"
                  : ""
              }`}
            >
              <p className="text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                {turn.text}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
