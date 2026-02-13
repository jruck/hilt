"use client";

import { House, Wifi } from "lucide-react";
import { useSource, Source } from "@/hooks/useSource";
import { useState, useRef, useEffect, useCallback } from "react";

const sourceOptions: {
  value: Source;
  label: string;
  icon: typeof House;
}[] = [
  { value: "local", label: "Local", icon: House },
  { value: "remote", label: "Remote", icon: Wifi },
];

export function SourceToggle() {
  const { source, switchSource, remoteAvailable, switchError } = useSource();
  const [connected, setConnected] = useState(true);
  const [switching, setSwitching] = useState(false);

  // Health check: ping the server periodically
  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const res = await fetch("/api/ws-port", { cache: "no-store" });
        if (mounted) setConnected(res.ok);
      } catch {
        if (mounted) setConnected(false);
      }
    }

    check();
    const interval = setInterval(check, 15000);

    function handleOnline() { check(); }
    function handleOffline() { if (mounted) setConnected(false); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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

  const CurrentIcon = source === "remote" ? Wifi : House;

  async function handleSwitch(targetSource: Source) {
    if (targetSource === source) {
      setIsOpen(false);
      return;
    }

    // Don't allow switching to remote if it's not available
    if (targetSource === "remote" && remoteAvailable === false) {
      return;
    }

    setIsOpen(false);
    setSwitching(true);
    await switchSource();
    // If we're still here, the switch failed (didn't redirect)
    setSwitching(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        className="relative p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        title={`Source: ${source} (${connected ? "connected" : "disconnected"})`}
      >
        <CurrentIcon className="w-4 h-4" />
        <span
          className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute top-full mt-1 z-50 min-w-[140px]
                        bg-[var(--bg-elevated)] border border-[var(--border-default)]
                        rounded-lg shadow-lg overflow-hidden
                        ${alignRight ? "right-0" : "left-0"}`}
        >
          {sourceOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = source === option.value;
            const isRemoteOption = option.value === "remote";
            const isDisabled = isRemoteOption && !isSelected && remoteAvailable === false;

            return (
              <button
                key={option.value}
                onClick={() => handleSwitch(option.value)}
                disabled={isDisabled || switching}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm
                           transition-colors
                           ${isDisabled
                             ? "text-[var(--text-tertiary)] cursor-not-allowed opacity-50"
                             : isSelected
                               ? "text-[var(--interactive-default)] bg-[var(--bg-tertiary)]"
                               : "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                           }`}
                title={isDisabled ? "Remote server not responding" : undefined}
              >
                <Icon className="w-4 h-4" />
                <span>{option.label}</span>
                {isRemoteOption && !isSelected && (
                  <span
                    className={`ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      remoteAvailable === null
                        ? "bg-yellow-500"
                        : remoteAvailable
                          ? "bg-emerald-500"
                          : "bg-red-500"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Switch error toast */}
      {switchError && (
        <div
          className="absolute top-full mt-1 right-0 z-50 px-3 py-2 rounded-lg text-xs font-medium
                     bg-red-500/10 text-red-500 border border-red-500/20 whitespace-nowrap"
        >
          {switchError}
        </div>
      )}
    </div>
  );
}
