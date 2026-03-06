'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, Theme } from '@/hooks/useTheme';
import { useHaptics } from '@/hooks/useHaptics';
import { useState, useRef, useEffect, useCallback } from 'react';

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const haptics = useHaptics();
  const [isOpen, setIsOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Determine dropdown alignment based on available space
  const openDropdown = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      setAlignRight(spaceRight < 160);
    }
    setIsOpen(true);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get icon for current theme
  const CurrentIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => { isOpen ? haptics.rigid() : haptics.light(); isOpen ? setIsOpen(false) : openDropdown(); }}
        className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        title={`Theme: ${theme}`}
      >
        <CurrentIcon className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className={`absolute top-full mt-1 z-50 min-w-[120px]
                        bg-[var(--bg-elevated)] border border-[var(--border-default)]
                        rounded-lg shadow-lg overflow-hidden
                        ${alignRight ? 'right-0' : 'left-0'}`}>
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.value;
            return (
              <button
                key={option.value}
                onClick={() => {
                  haptics.medium();
                  setTheme(option.value);
                  setIsOpen(false);
                }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm
                           hover:bg-[var(--bg-tertiary)] transition-colors
                           ${isSelected
                             ? 'text-[var(--interactive-default)] bg-[var(--bg-tertiary)]'
                             : 'text-[var(--text-primary)]'}`}
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
