'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, Theme } from '@/hooks/useTheme';
import { useHaptics } from '@/hooks/useHaptics';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const haptics = useHaptics();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Determine dropdown alignment based on available space
  const openDropdown = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 120;
      setMenuPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
        top: rect.bottom + 4,
      });
    }
    setIsOpen(true);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
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
        onClick={() => {
          if (isOpen) {
            haptics.rigid();
            setIsOpen(false);
          } else {
            haptics.light();
            openDropdown();
          }
        }}
        className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        title={`Theme: ${theme}`}
      >
        <CurrentIcon className="w-4 h-4" />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] min-w-[120px]
                        bg-[var(--bg-elevated)] border border-[var(--border-default)]
                        rounded-lg shadow-lg overflow-hidden"
          style={{ left: menuPosition.left, top: menuPosition.top }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
