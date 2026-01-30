'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, Theme } from '@/hooks/useTheme';
import { useState, useRef, useEffect } from 'react';

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        title={`Theme: ${theme}`}
      >
        <CurrentIcon className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-full mb-1 z-50 min-w-[120px]
                        bg-[var(--bg-elevated)] border border-[var(--border-default)]
                        rounded-lg shadow-lg overflow-hidden">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.value;
            return (
              <button
                key={option.value}
                onClick={() => {
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
