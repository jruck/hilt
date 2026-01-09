"use client";

import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, AlertTriangle, Copy, Check, ChevronRight, Play, Settings } from "lucide-react";
import { RalphConfig, RALPH_DEFAULTS, generateRalphCommand } from "@/lib/ralph";

type SetupStep = "check" | "config" | "ready";

interface RalphPluginStatus {
  installed: boolean;
  pluginPath?: string;
  version?: string;
  installCommand: string;
}

interface RalphSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  seedPrompt: string;
  onStartLoop: (config: RalphConfig) => void;
  onStartPrdRefinement: (prompt: string) => void;
}

export function RalphSetupModal({
  isOpen,
  onClose,
  seedPrompt,
  onStartLoop,
  onStartPrdRefinement,
}: RalphSetupModalProps) {
  const [step, setStep] = useState<SetupStep>("check");
  const [pluginStatus, setPluginStatus] = useState<RalphPluginStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Config state
  const [prompt, setPrompt] = useState(seedPrompt);
  const [maxIterations, setMaxIterations] = useState(RALPH_DEFAULTS.maxIterations);
  const [completionPromise, setCompletionPromise] = useState(RALPH_DEFAULTS.completionPromise);

  // Check plugin status on mount
  useEffect(() => {
    if (isOpen) {
      checkPlugin();
    }
  }, [isOpen]);

  // Reset state when modal opens with new prompt
  useEffect(() => {
    if (isOpen) {
      setPrompt(seedPrompt);
      setStep("check");
    }
  }, [isOpen, seedPrompt]);

  const checkPlugin = async () => {
    setIsChecking(true);
    try {
      const res = await fetch("/api/ralph");
      const status = await res.json();
      setPluginStatus(status);
      if (status.installed) {
        setStep("config");
      }
    } catch (error) {
      console.error("Failed to check Ralph plugin:", error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopyCommand = useCallback(() => {
    if (pluginStatus?.installCommand) {
      navigator.clipboard.writeText(pluginStatus.installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [pluginStatus]);

  const handleStartPrd = () => {
    // Start a refinement session to create the PRD
    onStartPrdRefinement(seedPrompt);
    onClose();
  };

  const handleStartLoop = () => {
    const config: RalphConfig = {
      prompt,
      maxIterations,
      completionPromise,
    };
    onStartLoop(config);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-medium text-[var(--text-primary)]">
                Ralph Wiggum Loop
              </h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Iterative AI development
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
          {/* Step: Plugin Check */}
          {step === "check" && (
            <div className="space-y-4">
              {isChecking ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-[var(--text-tertiary)] animate-spin" />
                  <span className="ml-2 text-[var(--text-secondary)]">
                    Checking for Ralph Wiggum plugin...
                  </span>
                </div>
              ) : pluginStatus && !pluginStatus.installed ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-200">
                        Ralph Wiggum plugin not installed
                      </p>
                      <p className="text-xs text-amber-200/70 mt-1">
                        Install the plugin to use iterative loops
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm text-[var(--text-secondary)]">
                      Run this command in your terminal:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded-lg font-mono text-[var(--text-primary)]">
                        {pluginStatus.installCommand}
                      </code>
                      <button
                        onClick={handleCopyCommand}
                        className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                        title="Copy command"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={checkPlugin}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] text-[var(--text-primary)] rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Check Again
                  </button>
                </div>
              ) : pluginStatus?.installed ? (
                <div className="flex items-center justify-center py-4">
                  <Check className="w-5 h-5 text-green-400 mr-2" />
                  <span className="text-[var(--text-secondary)]">
                    Plugin installed
                    {pluginStatus.version && ` (v${pluginStatus.version})`}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Step: Configuration */}
          {step === "config" && (
            <div className="space-y-5">
              {/* Seed idea preview */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  Your idea
                </label>
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-sm text-[var(--text-primary)] line-clamp-3">
                    {seedPrompt}
                  </p>
                </div>
              </div>

              {/* Two paths */}
              <div className="grid grid-cols-2 gap-3">
                {/* Path 1: Refine into PRD */}
                <button
                  onClick={handleStartPrd}
                  className="flex flex-col items-start gap-2 p-4 bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] border border-[var(--border-default)] hover:border-[var(--border-hover)] rounded-lg transition-colors text-left group"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--interactive-default)]" />
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      Refine into PRD
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Work with Claude to create a detailed PRD with clear success criteria
                  </p>
                </button>

                {/* Path 2: Configure directly */}
                <button
                  onClick={() => setStep("ready")}
                  className="flex flex-col items-start gap-2 p-4 bg-[var(--bg-tertiary)] hover:bg-[var(--surface-card-hover)] border border-[var(--border-default)] hover:border-[var(--border-hover)] rounded-lg transition-colors text-left group"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--interactive-default)]" />
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      Configure directly
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Skip refinement and configure loop parameters now
                  </p>
                </button>
              </div>

              <p className="text-xs text-[var(--text-tertiary)] text-center">
                Tip: PRD refinement helps define clear success criteria for better results
              </p>
            </div>
          )}

          {/* Step: Ready to run */}
          {step === "ready" && (
            <div className="space-y-4">
              {/* Prompt */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  Loop Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-default)] resize-none"
                  placeholder="Enter the task prompt..."
                />
              </div>

              {/* Max Iterations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">
                    Max Iterations
                  </label>
                  <span className="text-sm text-[var(--text-tertiary)]">
                    {maxIterations}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-[var(--interactive-default)]"
                />
                <p className="text-xs text-[var(--text-tertiary)]">
                  Safety limit to prevent infinite loops
                </p>
              </div>

              {/* Completion Promise */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  Completion Promise
                </label>
                <input
                  type="text"
                  value={completionPromise}
                  onChange={(e) => setCompletionPromise(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-default)]"
                  placeholder="RALPH_COMPLETE: All tests passing"
                />
                <p className="text-xs text-[var(--text-tertiary)]">
                  Exact text Claude must output to signal completion
                </p>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/80">
                  Ralph loops can run for extended periods. Ensure your success criteria are testable and specific.
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setStep("config")}
                  className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleStartLoop}
                  disabled={!prompt.trim() || !completionPromise.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--interactive-default)] hover:bg-[var(--interactive-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Start Loop
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer with command preview */}
        {step === "ready" && (
          <div className="px-5 py-3 bg-[var(--bg-tertiary)] border-t border-[var(--border-default)]">
            <p className="text-xs text-[var(--text-tertiary)] mb-1">Command preview:</p>
            <code className="text-xs text-[var(--text-secondary)] font-mono break-all line-clamp-2">
              {generateRalphCommand({ prompt, maxIterations, completionPromise })}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
