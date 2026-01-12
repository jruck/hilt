"use client";

import { useStartup, StartupActivity } from "@/contexts/StartupContext";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

// Small circular progress ring for activity status
function ProgressRing({
  status,
  progress,
}: {
  status: StartupActivity["status"];
  progress?: number;
}) {
  const size = 16;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // For active state without explicit progress, animate indeterminate
  const isIndeterminate = status === "active" && progress === undefined;

  // Calculate stroke-dashoffset for determinate progress
  const offset =
    progress !== undefined
      ? circumference - (progress / 100) * circumference
      : circumference;

  if (status === "complete") {
    return (
      <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-emerald-500" strokeWidth={3} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center">
        <AlertCircle className="w-2.5 h-2.5 text-red-500" />
      </div>
    );
  }

  if (status === "pending") {
    return (
      <svg width={size} height={size} className="opacity-30">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-zinc-600"
        />
      </svg>
    );
  }

  // Active state - show spinning ring
  return (
    <svg
      width={size}
      height={size}
      className={isIndeterminate ? "animate-spin" : ""}
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-zinc-700"
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={isIndeterminate ? circumference * 0.75 : offset}
        className="text-blue-400 transition-all duration-300"
      />
    </svg>
  );
}

function ActivityRow({ activity }: { activity: StartupActivity }) {
  return (
    <div
      className={`flex items-center gap-2.5 font-mono text-xs transition-opacity duration-200 ${
        activity.status === "pending" ? "opacity-40" : "opacity-100"
      } ${activity.status === "error" ? "text-red-400" : ""}`}
    >
      <ProgressRing status={activity.status} progress={activity.progress} />
      <span className="flex-1">
        {activity.label}
        {activity.detail && (
          <span className="text-zinc-500 ml-1">({activity.detail})</span>
        )}
        {activity.error && (
          <span className="text-red-400 ml-1">— {activity.error}</span>
        )}
      </span>
    </div>
  );
}

export function StartupScreen() {
  const { state } = useStartup();
  const [isVisible, setIsVisible] = useState(true);
  const [shouldRender, setShouldRender] = useState(true);

  // Handle fade out when complete
  useEffect(() => {
    if (state.isComplete && !state.hasError) {
      // Start fade out
      setIsVisible(false);
      // Remove from DOM after transition
      const timeout = setTimeout(() => {
        setShouldRender(false);
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [state.isComplete, state.hasError]);

  // Don't render if startup is complete and we've faded out
  if (!shouldRender) {
    return null;
  }

  // Group activities by phase for display
  const serverActivities = state.activities.filter((a) => a.phase === "server");
  const bootstrapActivities = state.activities.filter((a) => a.phase === "bootstrap");
  const dataActivities = state.activities.filter((a) => a.phase === "data");

  // Only show if we have activities or an error
  const hasContent = state.activities.length > 0 || state.hasError;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)] transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex flex-col items-center gap-6 max-w-md w-full px-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-5xl" role="img" aria-label="Hilt">
            🗡️
          </span>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Hilt</h1>
        </div>

        {/* Progress bar */}
        {hasContent && (
          <div className="w-full">
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${state.overallProgress}%` }}
              />
            </div>
            <div className="flex justify-center mt-1.5 text-xs text-zinc-500 font-mono">
              <span>{state.overallProgress}%</span>
            </div>
          </div>
        )}

        {/* Activity list */}
        {hasContent && (
          <div className="w-full space-y-3">
            {/* Server activities (Electron only) */}
            {serverActivities.length > 0 && (
              <div className="space-y-2">
                {serverActivities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            )}

            {/* Bootstrap activities */}
            {bootstrapActivities.length > 0 && (
              <div className="space-y-2">
                {bootstrapActivities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            )}

            {/* Data activities */}
            {dataActivities.length > 0 && (
              <div className="space-y-2">
                {dataActivities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fatal error message */}
        {state.hasError && state.errorMessage && (
          <div className="w-full p-4 bg-red-950/50 border border-red-900 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-red-400">Startup Failed</h3>
                <p className="text-sm text-red-300/80 mt-1">{state.errorMessage}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-3 px-3 py-1.5 text-xs font-medium bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator when no activities yet */}
        {!hasContent && (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Initializing...</span>
          </div>
        )}
      </div>
    </div>
  );
}
