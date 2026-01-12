"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronRight, Folder, FolderOpen, Inbox, Sparkles, Check, Play, Loader2, AlertCircle } from "lucide-react";
import { PinnedFolder } from "@/lib/pinned-folders";
import { SkillDropdown } from "./SkillDropdown";
import type { SkillInfo } from "@/lib/types";

const DRAFT_STORAGE_KEY = "quick-add-draft";

type Step = "input" | "destination";

interface Suggestion {
  path: string;
  name: string;
  emoji?: string;
  confidence: number;
  reason: string;
}

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  inboxPath?: string;
  pinnedFolders: PinnedFolder[];
  onSetInboxPath: (path: string) => Promise<void>;
  onSave: (prompt: string, destinationPath: string) => Promise<void>;
  onSaveAndRun: (prompt: string, destinationPath: string) => void;
  onRunWithSkill: (prompt: string, destinationPath: string, skill: SkillInfo) => void;
}

export function QuickAddModal({
  isOpen,
  onClose,
  inboxPath,
  pinnedFolders,
  onSetInboxPath,
  onSave,
  onSaveAndRun,
  onRunWithSkill,
}: QuickAddModalProps) {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [settingInbox, setSettingInbox] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pinned items are already folders (come from folder picker), use directly
  // No filtering needed - the PinnedFolder type ensures these are directories
  const pinnedFoldersOnly = pinnedFolders;

  // Load draft from localStorage on mount
  useEffect(() => {
    if (isOpen) {
      const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (savedDraft) {
        setText(savedDraft);
      }
      setStep("input");
      setSelectedPath(null);
      setSelectedSkill(null);
      setSuggestions([]);
      setSettingInbox(false);
      setIsSaving(false);
      setError(null);
      setInboxError(null);
    }
  }, [isOpen]);

  // Save draft to localStorage as user types
  useEffect(() => {
    if (isOpen && text) {
      localStorage.setItem(DRAFT_STORAGE_KEY, text);
    }
  }, [isOpen, text]);

  // Focus textarea when modal opens or when returning to input step
  useEffect(() => {
    if (isOpen && step === "input" && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, step]);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = window.innerHeight * 0.4;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  // Fetch suggestions when moving to destination step
  const fetchSuggestions = useCallback(async () => {
    if (!text.trim() || pinnedFoldersOnly.length === 0) {
      setSuggestions([]);
      return;
    }

    setIsLoadingSuggestions(true);
    try {
      const res = await fetch(`/api/suggest-destination?text=${encodeURIComponent(text)}`);
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch {
      setSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [text, pinnedFoldersOnly.length]);

  const handleNext = () => {
    if (!text.trim()) return;
    setStep("destination");
    // Default to inbox if set
    if (inboxPath) {
      setSelectedPath(inboxPath);
    }
    fetchSuggestions();
  };

  const handleBack = () => {
    setStep("input");
  };

  const handleSelectPath = (path: string) => {
    setSelectedPath(path);
  };

  const handleBrowseFolder = async () => {
    setInboxError(null);
    try {
      const res = await fetch("/api/folders", { method: "POST" });
      const data = await res.json();
      if (!data.cancelled && data.path) {
        if (settingInbox) {
          // Validate that the selected path is a valid directory
          const validateRes = await fetch(`/api/folders?validate=${encodeURIComponent(data.path)}`);
          const validateData = await validateRes.json();
          if (!validateData.valid) {
            setInboxError("Selected path is not a valid folder");
            return;
          }
          await onSetInboxPath(data.path);
          setSettingInbox(false);
          setSelectedPath(data.path);
        } else {
          setSelectedPath(data.path);
        }
      }
    } catch (err) {
      console.error("Failed to open folder picker:", err);
      if (settingInbox) {
        setInboxError("Failed to set inbox folder");
      }
    }
  };

  const handleAction = async (action: "save" | "run" | "runWithSkill") => {
    if (!text.trim() || !selectedPath || isSaving) return;

    setError(null);
    setIsSaving(true);

    try {
      switch (action) {
        case "save":
          await onSave(text.trim(), selectedPath);
          break;
        case "run":
          onSaveAndRun(text.trim(), selectedPath);
          break;
        case "runWithSkill":
          if (selectedSkill) {
            onRunWithSkill(text.trim(), selectedPath, selectedSkill);
          }
          break;
      }
      // Clear draft on successful action
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      onClose();
    } catch (err) {
      console.error("Action failed:", err);
      setError(action === "save" ? "Failed to save. Please try again." : "Action failed. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (step === "input") {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Escape") {
        onClose();
      }
    } else if (step === "destination") {
      if (e.key === "Escape") {
        handleBack();
      } else if (e.key === "Enter" && selectedPath) {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          handleAction("run");
        } else {
          handleAction("save");
        }
      }
    }
  };

  const clearDraft = () => {
    setText("");
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  };

  if (!isOpen) return null;

  const getFolderDisplayName = (path: string) => {
    // Check if it's a pinned folder with an emoji
    const pinned = pinnedFolders.find(f => f.path === path);
    if (pinned) {
      return pinned.emoji ? `${pinned.emoji} ${pinned.name}` : pinned.name;
    }
    // Otherwise just use the last part of the path
    return path.split("/").filter(Boolean).pop() || path;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--interactive-default)]/20 flex items-center justify-center">
              <Inbox className="w-4 h-4 text-[var(--interactive-default)]" />
            </div>
            <div>
              <h2 className="text-base font-medium text-[var(--text-primary)]">
                Quick Add
              </h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                {step === "input" ? "Capture your idea" : "Choose destination"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {/* Step 1: Input */}
          {step === "input" && (
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    adjustTextareaHeight();
                  }}
                  placeholder="What's on your mind?"
                  className="w-full px-3 py-3 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-default)] resize-none leading-relaxed"
                  style={{ minHeight: "100px" }}
                />
                {text && (
                  <button
                    onClick={clearDraft}
                    className="absolute top-2 right-2 p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded"
                    title="Clear draft"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-tertiary)]">
                  Draft auto-saved
                </p>
                <button
                  onClick={handleNext}
                  disabled={!text.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--interactive-default)] hover:bg-[var(--interactive-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Destination */}
          {step === "destination" && (
            <div className="space-y-4">
              {/* Task preview */}
              <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                <p className="text-sm text-[var(--text-primary)] line-clamp-2">
                  {text}
                </p>
              </div>

              {/* Inbox section */}
              {!inboxPath && !settingInbox ? (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                    Inbox
                  </label>
                  <button
                    onClick={() => setSettingInbox(true)}
                    className="w-full flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] border border-dashed border-[var(--border-default)] rounded-lg transition-colors text-left"
                  >
                    <Inbox className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="text-sm text-[var(--text-secondary)]">
                      Set your inbox folder...
                    </span>
                  </button>
                </div>
              ) : settingInbox ? (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                    Set Inbox Folder
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBrowseFolder}
                      className="flex-1 flex items-center gap-3 p-3 bg-[var(--interactive-default)]/10 hover:bg-[var(--interactive-default)]/20 border border-[var(--interactive-default)]/30 rounded-lg transition-colors"
                    >
                      <FolderOpen className="w-4 h-4 text-[var(--interactive-default)]" />
                      <span className="text-sm text-[var(--text-primary)]">
                        Choose folder...
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setSettingInbox(false);
                        setInboxError(null);
                      }}
                      className="p-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {inboxError && (
                    <div className="flex items-center gap-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {inboxError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                    Inbox
                  </label>
                  <button
                    onClick={() => handleSelectPath(inboxPath!)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                      selectedPath === inboxPath
                        ? "bg-[var(--interactive-default)]/20 border border-[var(--interactive-default)]"
                        : "bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] border border-[var(--border-default)]"
                    }`}
                  >
                    <Inbox className={`w-4 h-4 ${selectedPath === inboxPath ? "text-[var(--interactive-default)]" : "text-[var(--text-tertiary)]"}`} />
                    <span className="text-sm text-[var(--text-primary)] flex-1 truncate">
                      {getFolderDisplayName(inboxPath!)}
                    </span>
                    {selectedPath === inboxPath && (
                      <Check className="w-4 h-4 text-[var(--interactive-default)]" />
                    )}
                  </button>
                </div>
              )}

              {/* Suggestions section */}
              {suggestions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                      Suggested
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.path}
                        onClick={() => handleSelectPath(suggestion.path)}
                        title={suggestion.reason}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                          selectedPath === suggestion.path
                            ? "bg-[var(--interactive-default)] text-white"
                            : "bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] text-[var(--text-primary)] border border-[var(--border-default)]"
                        }`}
                      >
                        {suggestion.emoji ? (
                          <span>{suggestion.emoji}</span>
                        ) : (
                          <Folder className="w-3.5 h-3.5" />
                        )}
                        <span>{suggestion.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isLoadingSuggestions && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                  <div className="w-3 h-3 border border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
                  Finding suggestions...
                </div>
              )}

              {/* Pinned folders section */}
              {pinnedFoldersOnly.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                    Pinned Folders
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {pinnedFoldersOnly.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => handleSelectPath(folder.path)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                          selectedPath === folder.path
                            ? "bg-[var(--interactive-default)] text-white"
                            : "bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] text-[var(--text-primary)] border border-[var(--border-default)]"
                        }`}
                      >
                        {folder.emoji ? (
                          <span>{folder.emoji}</span>
                        ) : (
                          <Folder className="w-3.5 h-3.5" />
                        )}
                        <span>{folder.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Browse folder */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                  Other
                </label>
                <button
                  onClick={handleBrowseFolder}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] border border-[var(--border-default)] rounded-full text-sm text-[var(--text-secondary)] transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Browse...</span>
                </button>
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border-default)]">
                <button
                  onClick={handleBack}
                  disabled={isSaving}
                  className="px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
                >
                  Back
                </button>

                <div className="flex items-center gap-1">
                  <SkillDropdown
                    scope={selectedPath || undefined}
                    prompt={text}
                    selectedSkill={selectedSkill}
                    onSelect={(skill) => {
                      setSelectedSkill(skill);
                      if (skill) {
                        handleAction("runWithSkill");
                      }
                    }}
                    disabled={!selectedPath || isSaving}
                  />
                  <button
                    onClick={() => handleAction("run")}
                    disabled={!selectedPath || isSaving}
                    className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50 rounded transition-colors"
                    title="Run (Cmd+Enter)"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleAction("save")}
                    disabled={!selectedPath || isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-[var(--interactive-default)] hover:bg-[var(--interactive-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
                    title="Save (Enter)"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
