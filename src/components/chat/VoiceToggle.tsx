"use client";

import { Mic, MicOff } from "lucide-react";
import { SidecarState } from "../../lib/chat-types";

interface VoiceToggleProps {
  voiceEnabled: boolean;
  onToggle: () => void;
  sidecarState: SidecarState;
  rtcState: string;
  isMuted: boolean;
  onMuteToggle: () => void;
}

type VisualState = "off" | "connecting" | "active" | "muted" | "error";

function deriveVisualState(
  voiceEnabled: boolean,
  sidecarState: SidecarState,
  rtcState: string,
  isMuted: boolean,
): VisualState {
  if (!voiceEnabled) return "off";
  if (sidecarState === "error" || rtcState === "failed") return "error";
  if (sidecarState === "starting" || rtcState === "connecting") return "connecting";
  if (isMuted) return "muted";
  if (sidecarState === "running" && rtcState === "connected") return "active";
  return "connecting";
}

const stateStyles: Record<VisualState, string> = {
  off: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
  connecting: "text-[var(--status-starred)] animate-pulse",
  active: "text-[var(--status-active)]",
  muted: "text-[var(--text-tertiary)]",
  error: "text-[var(--status-starred)]",
};

const stateTooltips: Record<VisualState, string> = {
  off: "Enable voice mode",
  connecting: "Connecting voice\u2026",
  active: "Voice active \u2014 click to disable",
  muted: "Muted \u2014 click to unmute",
  error: "Voice error \u2014 click to retry",
};

export function VoiceToggle({
  voiceEnabled,
  onToggle,
  sidecarState,
  rtcState,
  isMuted,
  onMuteToggle,
}: VoiceToggleProps) {
  const visualState = deriveVisualState(voiceEnabled, sidecarState, rtcState, isMuted);
  const Icon = visualState === "muted" ? MicOff : Mic;

  const handleClick = () => {
    if (visualState === "muted") {
      onMuteToggle();
    } else {
      onToggle();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`
        relative p-1.5 rounded transition-colors
        ${stateStyles[visualState]}
      `}
      title={stateTooltips[visualState]}
      aria-label={stateTooltips[visualState]}
    >
      <Icon className="w-4 h-4" />

      {/* Status dot indicator */}
      {visualState === "active" && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--status-active)]" />
      )}
      {visualState === "error" && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
      )}
    </button>
  );
}
