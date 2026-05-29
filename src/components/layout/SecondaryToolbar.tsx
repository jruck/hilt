"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export const SECONDARY_TOOLBAR_BODY_GUTTER_CLASS = "pt-[13px]";

export function SecondaryToolbar({
  left,
  right,
  children,
}: {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const content = children ?? (
    <>
      {left ? <div className="shrink-0">{left}</div> : null}
      {right ? <div className="ml-auto flex shrink-0 items-center gap-2 pr-1">{right}</div> : null}
    </>
  );

  return (
    <div data-secondary-toolbar className="h-11 shrink-0 overflow-hidden px-3 sm:px-5">
      <div className="scrollbar-none flex h-full w-full items-center overflow-x-auto">
        <div className="flex min-w-max flex-1 items-center gap-3">
          {content}
        </div>
      </div>
    </div>
  );
}

export function SecondarySegmentedControl({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex shrink-0 items-center gap-1 rounded-lg bg-[var(--bg-tertiary)] p-0.5 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function secondarySegmentedButtonClass(active: boolean): string {
  return `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3 ${
    active
      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
  }`;
}

export function SecondarySegmentedButton({
  active,
  icon,
  children,
  collapseLabel = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  icon?: ReactNode;
  collapseLabel?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${secondarySegmentedButtonClass(active)} ${className}`}
      {...props}
    >
      {icon}
      <span className={collapseLabel ? "hidden sm:inline" : undefined}>{children}</span>
    </button>
  );
}

export function SecondaryIconButton({
  active = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-blue-500 bg-blue-500/10 text-[var(--text-primary)]"
          : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
