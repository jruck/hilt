import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<LoadingStateProps["size"]>, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-6 w-6",
};

export function LoadingState({ label, className = "", size = "md" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex h-full w-full flex-1 items-center justify-center gap-2 text-sm text-[var(--text-tertiary)] ${className}`}
    >
      <Loader2 className={`${SIZE_CLASS[size]} shrink-0 animate-spin`} aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}
