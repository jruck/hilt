"use client";

import { House, SatelliteDish } from "lucide-react";
import { useSource, Source } from "@/hooks/useSource";
import { useState, useRef, useEffect, useCallback } from "react";

const sourceOptions: {
  value: Source;
  label: string;
  icon: typeof House;
}[] = [
  { value: "local", label: "Local", icon: House },
  { value: "remote", label: "Remote", icon: SatelliteDish },
];

export function SourceToggle() {
  const { source, switchSource } = useSource();
  const [isOpen, setIsOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const openDropdown = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      setAlignRight(spaceRight < 160);
    }
    setIsOpen(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const CurrentIcon = source === "remote" ? SatelliteDish : House;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        title={`Source: ${source}`}
      >
        <CurrentIcon className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          className={`absolute top-full mt-1 z-50 min-w-[120px]
                        bg-[var(--bg-elevated)] border border-[var(--border-default)]
                        rounded-lg shadow-lg overflow-hidden
                        ${alignRight ? "right-0" : "left-0"}`}
        >
          {sourceOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = source === option.value;
            return (
              <button
                key={option.value}
                onClick={() => {
                  setIsOpen(false);
                  if (!isSelected) switchSource();
                }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm
                           hover:bg-[var(--bg-tertiary)] transition-colors
                           ${
                             isSelected
                               ? "text-[var(--interactive-default)] bg-[var(--bg-tertiary)]"
                               : "text-[var(--text-primary)]"
                           }`}
              >
                <Icon className="w-4 h-4" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
