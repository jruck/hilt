"use client";

import { ListChecks, Newspaper } from "lucide-react";
import {
  SecondarySegmentedButton,
  SecondarySegmentedControl,
} from "@/components/layout/SecondaryToolbar";

export type BridgeMode = "briefing" | "priorities";

interface BridgeModeToggleProps {
  mode: BridgeMode;
  onModeChange: (mode: BridgeMode) => void;
}

const OPTIONS = [
  { id: "briefing" as const, label: "Briefing", icon: Newspaper },
  { id: "priorities" as const, label: "Priorities", icon: ListChecks },
];

export function BridgeModeToggle({ mode, onModeChange }: BridgeModeToggleProps) {
  return (
    <SecondarySegmentedControl>
      {OPTIONS.map((option) => (
        <SecondarySegmentedButton
          key={option.id}
          active={mode === option.id}
          onClick={() => onModeChange(option.id)}
          icon={<option.icon className="h-4 w-4" />}
          aria-pressed={mode === option.id}
          title={option.label}
        >
          {option.label}
        </SecondarySegmentedButton>
      ))}
    </SecondarySegmentedControl>
  );
}
