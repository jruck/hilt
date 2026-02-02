"use client";

import { Square } from "lucide-react";

interface VoiceIndicatorProps {
  userSpeaking: boolean;
  agentSpeaking: boolean;
  currentTranscript: string | null;
  onInterrupt: () => void;
}

const BAR_COUNT = 4;
const BAR_DELAYS = ["0s", "0.15s", "0.3s", "0.45s"];

export function VoiceIndicator({
  userSpeaking,
  agentSpeaking,
  currentTranscript,
  onInterrupt,
}: VoiceIndicatorProps) {
  const isActive = userSpeaking || agentSpeaking || !!currentTranscript;

  return (
    <div
      className={`
        flex items-center gap-3 px-4 bg-[var(--bg-secondary)]
        border-t border-[var(--border-subtle)]
        transition-all duration-200 ease-in-out overflow-hidden
        ${isActive ? "h-8 opacity-100" : "h-0 opacity-0 border-t-0"}
      `}
      role="status"
      aria-label="Voice activity indicator"
    >
      {/* Audio waveform bars */}
      <div className="flex items-center gap-[3px] h-4">
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            className="w-0.5 rounded-full bg-[var(--interactive-default)]"
            style={{
              height: userSpeaking || agentSpeaking ? undefined : "4px",
              animation:
                userSpeaking || agentSpeaking
                  ? `voice-bar 0.6s ease-in-out ${BAR_DELAYS[i]} infinite`
                  : "none",
              transition: "height 0.2s ease",
            }}
          />
        ))}
      </div>

      {/* Interim transcript */}
      <span className="text-xs italic text-[var(--text-secondary)] truncate flex-1 min-w-0">
        {currentTranscript || (agentSpeaking ? "Agent speaking\u2026" : userSpeaking ? "Listening\u2026" : "")}
      </span>

      {/* Interrupt/stop button */}
      {agentSpeaking && (
        <button
          onClick={onInterrupt}
          className="
            flex items-center gap-1 text-xs px-2 py-0.5 rounded
            text-[var(--text-secondary)] hover:text-[var(--text-primary)]
            transition-colors shrink-0
          "
          aria-label="Stop agent speech"
        >
          <Square className="w-3 h-3" />
          <span>Stop</span>
        </button>
      )}
    </div>
  );
}
