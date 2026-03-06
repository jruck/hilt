"use client";

import { House, Wifi, Plus, Settings, Check, FolderOpen } from "lucide-react";
import { useSources } from "@/hooks/useSource";
import { useHaptics } from "@/hooks/useHaptics";
import { useState, useRef, useEffect, useCallback } from "react";
import { SourceManageModal } from "./SourceManageModal";

export function SourceToggle() {
  const {
    sources,
    activeSource,
    loaded,
    isUnconfigured,
    portMismatch,
    switchError,
    switchTo,
    addSource,
    updateSource,
    removeSource,
    reorderSources,
  } = useSources();

  const haptics = useHaptics();
  const [connected, setConnected] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Health check
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

  const openDropdown = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      setAlignRight(spaceRight < 200);
    }
    setIsOpen(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleQuickAdd() {
    const origin = window.location.origin;
    const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
    await addSource(
      isLocal ? "Local" : new URL(origin).hostname,
      origin,
      isLocal ? "local" : "remote"
    );
  }

  async function handlePickFolderAndAdd() {
    let folder: string | null = null;

    // Electron native dialog
    if (typeof window !== "undefined" && window.electronAPI?.selectFolder) {
      const result = await window.electronAPI.selectFolder();
      if (!result.cancelled && result.path) folder = result.path;
    } else {
      // Fallback: osascript-based picker via API
      try {
        const res = await fetch("/api/folders", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          if (!data.cancelled && data.path) folder = data.path;
        }
      } catch { /* ignore */ }
    }

    if (folder) {
      const basename = folder.split("/").pop() || "Local";
      const name = basename.charAt(0).toUpperCase() + basename.slice(1);
      await addSource(name, "", "local", folder);
    }
  }

  if (!loaded) return null;

  const CurrentIcon = activeSource?.type === "remote" ? Wifi : House;

  // Unconfigured state: plus button with onboarding
  if (isUnconfigured) {
    return (
      <div ref={containerRef} className="relative">
        <button
          ref={buttonRef}
          onClick={() => { isOpen ? haptics.rigid() : haptics.light(); isOpen ? setIsOpen(false) : openDropdown(); }}
          className="relative p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          title="Add your first source"
        >
          <Plus className="w-4 h-4" />
        </button>

        {isOpen && (
          <div
            className={`absolute top-full mt-1 z-50 min-w-[240px]
                        bg-[var(--bg-elevated)] border border-[var(--border-default)]
                        rounded-lg shadow-lg overflow-hidden
                        ${alignRight ? "right-0" : "left-0"}`}
          >
            <div className="px-3 py-2">
              <p className="text-xs text-[var(--text-tertiary)] mb-2">
                Choose a folder to get started, or add a remote source.
              </p>
              <button
                onClick={() => { handlePickFolderAndAdd(); setIsOpen(false); }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-sm font-medium rounded-md bg-[var(--interactive-default)] text-white hover:bg-[var(--interactive-hover)] transition-colors mb-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Choose folder...
              </button>
              <button
                onClick={() => { handleQuickAdd(); setIsOpen(false); }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add {window.location.origin.replace(/^https?:\/\//, "")} as source
              </button>
            </div>
            <div className="border-t border-[var(--border-default)]">
              <button
                onClick={() => { setIsOpen(false); setShowModal(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                Manage Sources...
              </button>
            </div>
          </div>
        )}

        {showModal && (
          <SourceManageModal
            sources={sources}
            onClose={() => setShowModal(false)}
            onAdd={addSource}
            onUpdate={updateSource}
            onDelete={removeSource}
            onReorder={reorderSources}
          />
        )}
      </div>
    );
  }

  // Configured state: icon button with dropdown
  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => { isOpen ? haptics.rigid() : haptics.light(); isOpen ? setIsOpen(false) : openDropdown(); }}
        className="relative p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        title={`Source: ${activeSource?.name ?? "Unknown"} (${connected ? "connected" : "disconnected"})`}
      >
        <CurrentIcon className="w-4 h-4" />
        <span
          className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute top-full mt-1 z-50 min-w-[200px]
                      bg-[var(--bg-elevated)] border border-[var(--border-default)]
                      rounded-lg shadow-lg overflow-hidden
                      ${alignRight ? "right-0" : "left-0"}`}
        >
          {/* Port mismatch hint */}
          {portMismatch && (
            <div className="px-3 py-2 border-b border-[var(--border-default)] bg-yellow-500/5">
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mb-1.5">
                Running at {window.location.origin.replace(/^https?:\/\//, "")} — not a configured source.
              </p>
              <button
                onClick={() => { handleQuickAdd(); setIsOpen(false); }}
                className="text-xs font-medium text-[var(--interactive-default)] hover:underline"
              >
                Add as source
              </button>
            </div>
          )}

          {/* Source list */}
          {sources.map(source => {
            const Icon = source.type === "remote" ? Wifi : House;
            return (
              <button
                key={source.id}
                onClick={() => {
                  if (!source.isActive) haptics.medium();
                  setIsOpen(false);
                  if (!source.isActive) switchTo(source.id);
                }}
                disabled={!source.isActive && source.available === false}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors
                  ${!source.isActive && source.available === false
                    ? "text-[var(--text-tertiary)] cursor-not-allowed opacity-50"
                    : source.isActive
                      ? "text-[var(--interactive-default)] bg-[var(--bg-tertiary)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  }`}
                title={!source.isActive && source.available === false ? "Not responding" : undefined}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="flex-1 text-left truncate">{source.name}</span>
                {source.isActive && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                {!source.isActive && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      source.available === null
                        ? "bg-yellow-500"
                        : source.available
                          ? "bg-emerald-500"
                          : "bg-red-500"
                    }`}
                  />
                )}
              </button>
            );
          })}

          {/* Manage link */}
          <div className="border-t border-[var(--border-default)]">
            <button
              onClick={() => { setIsOpen(false); setShowModal(true); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Manage Sources...
            </button>
          </div>
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

      {showModal && (
        <SourceManageModal
          sources={sources}
          onClose={() => setShowModal(false)}
          onAdd={addSource}
          onUpdate={updateSource}
          onDelete={removeSource}
          onReorder={reorderSources}
        />
      )}
    </div>
  );
}
