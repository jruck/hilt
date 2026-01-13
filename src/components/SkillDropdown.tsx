"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Sparkles, Check, Loader2 } from "lucide-react";
import { useSkills } from "@/hooks/useSkills";
import { matchSkillToPrompt, getMatchReason } from "@/lib/skill-matcher";
import type { SkillInfo } from "@/lib/types";

interface SkillDropdownProps {
  scope: string | undefined;
  prompt?: string; // For auto-selection
  selectedSkill: SkillInfo | null;
  onSelect: (skill: SkillInfo | null) => void;
  disabled?: boolean;
  className?: string;
}

export function SkillDropdown({
  scope,
  prompt,
  selectedSkill,
  onSelect,
  disabled = false,
  className = "",
}: SkillDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { skills, isLoading } = useSkills(scope);

  // Auto-select skill based on prompt content
  useEffect(() => {
    if (prompt && skills.length > 0 && !selectedSkill) {
      const matched = matchSkillToPrompt(prompt, skills);
      if (matched) {
        onSelect(matched);
      }
    }
  }, [prompt, skills, selectedSkill, onSelect]);

  // Close dropdown on outside click
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

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleSelect = (skill: SkillInfo | null) => {
    onSelect(skill);
    setIsOpen(false);
  };

  // Get match reason for selected skill
  const matchReason =
    selectedSkill && prompt
      ? getMatchReason(prompt, selectedSkill)
      : null;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || isLoading}
        className={`flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-md transition-colors
          ${
            selectedSkill
              ? "bg-[var(--interactive-default)]/10 text-[var(--interactive-default)] border border-[var(--interactive-default)]/30"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border border-transparent"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
        title={selectedSkill ? selectedSkill.description : "Run with skill"}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        <span className="max-w-[100px] truncate">
          {selectedSkill ? selectedSkill.name : "Skill"}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && !isLoading && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[240px] max-w-[320px]
                      bg-[var(--bg-elevated)] border border-[var(--border-default)]
                      rounded-lg shadow-lg overflow-hidden"
        >
          {/* No skill option */}
          <button
            onClick={() => handleSelect(null)}
            className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left
                       hover:bg-[var(--bg-tertiary)] transition-colors
                       ${!selectedSkill ? "bg-[var(--bg-tertiary)]" : ""}`}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              {!selectedSkill && <Check className="w-3.5 h-3.5 text-[var(--interactive-default)]" />}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[var(--text-primary)]">No skill</span>
              <p className="text-xs text-[var(--text-tertiary)] truncate">
                Plain run without skill instructions
              </p>
            </div>
          </button>

          {skills.length > 0 && (
            <div className="border-t border-[var(--border-default)]" />
          )}

          {/* Skill options */}
          {skills.map((skill) => {
            const isSelected = selectedSkill?.name === skill.name;
            const reason = prompt ? getMatchReason(prompt, skill) : null;

            return (
              <button
                key={skill.name}
                onClick={() => handleSelect(skill)}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left
                           hover:bg-[var(--bg-tertiary)] transition-colors
                           ${isSelected ? "bg-[var(--bg-tertiary)]" : ""}`}
              >
                <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-[var(--interactive-default)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-primary)]">{skill.name}</span>
                    {skill.source === "project" && (
                      <span className="px-1 py-0.5 text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] rounded">
                        project
                      </span>
                    )}
                    {reason && (
                      <span className="px-1 py-0.5 text-[10px] bg-[var(--interactive-default)]/10 text-[var(--interactive-default)] rounded">
                        {reason}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] truncate">
                    {skill.description}
                  </p>
                </div>
              </button>
            );
          })}

          {skills.length === 0 && (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-[var(--text-tertiary)]">
                No skills found
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Add skills to ~/.claude/skills/
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact version of skill dropdown for inline use (e.g., in card toolbars)
 */
export function SkillDropdownCompact({
  scope,
  prompt,
  onSelect,
  disabled = false,
}: {
  scope: string | undefined;
  prompt?: string;
  onSelect: (skill: SkillInfo | null) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { skills, isLoading } = useSkills(scope);

  // Close dropdown on outside click
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

  const handleSelect = (skill: SkillInfo | null) => {
    setSelectedSkill(skill);
    onSelect(skill);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || isLoading}
        className={`p-1.5 rounded transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]
        `}
        title="Run with skill"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
      </button>

      {isOpen && !isLoading && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[200px] max-w-[280px]
                      bg-[var(--bg-elevated)] border border-[var(--border-default)]
                      rounded-lg shadow-lg overflow-hidden"
        >
          {skills.map((skill) => {
            const isSelected = selectedSkill?.name === skill.name;
            const reason = prompt ? getMatchReason(prompt, skill) : null;

            return (
              <button
                key={skill.name}
                onClick={() => handleSelect(skill)}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left
                           hover:bg-[var(--bg-tertiary)] transition-colors
                           ${isSelected ? "bg-[var(--bg-tertiary)]" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-primary)]">{skill.name}</span>
                    {reason && (
                      <span className="px-1 py-0.5 text-[10px] bg-[var(--interactive-default)]/10 text-[var(--interactive-default)] rounded">
                        auto
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] truncate">
                    {skill.description}
                  </p>
                </div>
              </button>
            );
          })}

          {skills.length === 0 && (
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-[var(--text-tertiary)]">
                No skills found
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
