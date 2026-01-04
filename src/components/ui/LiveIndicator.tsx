"use client";

interface LiveIndicatorProps {
  className?: string;
  title?: string;
}

/**
 * Reusable green pulsing dot indicator for running sessions
 */
export function LiveIndicator({ className = "", title = "Running" }: LiveIndicatorProps) {
  return (
    <span className={`relative flex h-2 w-2 flex-shrink-0 ${className}`} title={title}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
    </span>
  );
}
