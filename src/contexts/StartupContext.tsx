"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
} from "react";

// Types
export type StartupPhase = "server" | "bootstrap" | "data" | "complete";

export type ActivityStatus = "pending" | "active" | "complete" | "error";

export interface StartupActivity {
  id: string;
  label: string;
  phase: StartupPhase;
  status: ActivityStatus;
  progress?: number; // 0-100 for activities with known progress
  detail?: string; // e.g., "port 3000" or "1,234 sessions"
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface StartupState {
  phase: StartupPhase;
  activities: StartupActivity[];
  overallProgress: number; // 0-100
  isComplete: boolean;
  hasError: boolean;
  errorMessage?: string;
  startTime: number;
}

// Phase weights for progress calculation
const PHASE_WEIGHTS: Record<StartupPhase, number> = {
  server: 20, // Electron only - will be skipped in web
  bootstrap: 10,
  data: 70,
  complete: 0,
};

// Activity weights within data phase
const DATA_ACTIVITY_WEIGHTS: Record<string, number> = {
  "event-socket": 5,
  sessions: 35,
  inbox: 10,
  "inbox-counts": 5,
  tree: 35,
  preferences: 5,
  folders: 5,
};

// Actions
type StartupAction =
  | { type: "REGISTER_ACTIVITY"; activity: Omit<StartupActivity, "status"> & { status?: ActivityStatus } }
  | { type: "START_ACTIVITY"; id: string }
  | { type: "UPDATE_ACTIVITY"; id: string; detail?: string; progress?: number }
  | { type: "COMPLETE_ACTIVITY"; id: string; detail?: string }
  | { type: "ERROR_ACTIVITY"; id: string; error: string }
  | { type: "SET_PHASE"; phase: StartupPhase }
  | { type: "COMPLETE_STARTUP" }
  | { type: "FATAL_ERROR"; message: string };

// Calculate overall progress based on activities
function calculateProgress(activities: StartupActivity[], isElectron: boolean): number {
  if (activities.length === 0) return 0;

  let totalWeight = 0;
  let completedWeight = 0;

  for (const activity of activities) {
    // Skip server phase activities in web
    if (!isElectron && activity.phase === "server") continue;

    const phaseWeight = PHASE_WEIGHTS[activity.phase];
    const activityWeight = DATA_ACTIVITY_WEIGHTS[activity.id] || 10;
    const weight = activity.phase === "data" ? activityWeight : phaseWeight / 3; // Assume ~3 activities per phase

    totalWeight += weight;

    if (activity.status === "complete") {
      completedWeight += weight;
    } else if (activity.status === "active" && activity.progress !== undefined) {
      completedWeight += weight * (activity.progress / 100);
    }
  }

  return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
}

// Reducer
function startupReducer(state: StartupState, action: StartupAction): StartupState {
  switch (action.type) {
    case "REGISTER_ACTIVITY": {
      // Don't register if already exists
      if (state.activities.find((a) => a.id === action.activity.id)) {
        return state;
      }
      const newActivity: StartupActivity = {
        ...action.activity,
        status: action.activity.status || "pending",
      };
      const activities = [...state.activities, newActivity];
      return {
        ...state,
        activities,
        overallProgress: calculateProgress(activities, state.phase === "server" || state.activities.some(a => a.phase === "server")),
      };
    }

    case "START_ACTIVITY": {
      const activities = state.activities.map((a) =>
        a.id === action.id ? { ...a, status: "active" as const, startTime: Date.now() } : a
      );
      return {
        ...state,
        activities,
        overallProgress: calculateProgress(activities, state.activities.some(a => a.phase === "server")),
      };
    }

    case "UPDATE_ACTIVITY": {
      const activities = state.activities.map((a) =>
        a.id === action.id
          ? {
              ...a,
              detail: action.detail ?? a.detail,
              progress: action.progress ?? a.progress,
            }
          : a
      );
      return {
        ...state,
        activities,
        overallProgress: calculateProgress(activities, state.activities.some(a => a.phase === "server")),
      };
    }

    case "COMPLETE_ACTIVITY": {
      const activities = state.activities.map((a) =>
        a.id === action.id
          ? {
              ...a,
              status: "complete" as const,
              detail: action.detail ?? a.detail,
              endTime: Date.now(),
              progress: 100,
            }
          : a
      );
      return {
        ...state,
        activities,
        overallProgress: calculateProgress(activities, state.activities.some(a => a.phase === "server")),
      };
    }

    case "ERROR_ACTIVITY": {
      const activities = state.activities.map((a) =>
        a.id === action.id
          ? { ...a, status: "error" as const, error: action.error, endTime: Date.now() }
          : a
      );
      return {
        ...state,
        activities,
        hasError: true,
        overallProgress: calculateProgress(activities, state.activities.some(a => a.phase === "server")),
      };
    }

    case "SET_PHASE": {
      return { ...state, phase: action.phase };
    }

    case "COMPLETE_STARTUP": {
      return {
        ...state,
        phase: "complete",
        isComplete: true,
        overallProgress: 100,
      };
    }

    case "FATAL_ERROR": {
      return {
        ...state,
        hasError: true,
        errorMessage: action.message,
      };
    }

    default:
      return state;
  }
}

// Initial state
const initialState: StartupState = {
  phase: "bootstrap",
  activities: [],
  overallProgress: 0,
  isComplete: false,
  hasError: false,
  startTime: Date.now(),
};

// Context
interface StartupContextValue {
  state: StartupState;
  registerActivity: (activity: Omit<StartupActivity, "status"> & { status?: ActivityStatus }) => void;
  startActivity: (id: string) => void;
  updateActivity: (id: string, detail?: string, progress?: number) => void;
  completeActivity: (id: string, detail?: string) => void;
  errorActivity: (id: string, error: string) => void;
  setPhase: (phase: StartupPhase) => void;
  completeStartup: () => void;
  fatalError: (message: string) => void;
  isElectron: boolean;
}

const StartupContext = createContext<StartupContextValue | null>(null);

// Provider
export function StartupProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(startupReducer, initialState);
  const isElectron = typeof window !== "undefined" && !!(window as { electronAPI?: unknown }).electronAPI;
  const completionCheckRef = useRef<NodeJS.Timeout | null>(null);

  // Action creators
  const registerActivity = useCallback(
    (activity: Omit<StartupActivity, "status"> & { status?: ActivityStatus }) => {
      dispatch({ type: "REGISTER_ACTIVITY", activity });
    },
    []
  );

  const startActivity = useCallback((id: string) => {
    dispatch({ type: "START_ACTIVITY", id });
  }, []);

  const updateActivity = useCallback((id: string, detail?: string, progress?: number) => {
    dispatch({ type: "UPDATE_ACTIVITY", id, detail, progress });
  }, []);

  const completeActivity = useCallback((id: string, detail?: string) => {
    dispatch({ type: "COMPLETE_ACTIVITY", id, detail });
  }, []);

  const errorActivity = useCallback((id: string, error: string) => {
    dispatch({ type: "ERROR_ACTIVITY", id, error });
  }, []);

  const setPhase = useCallback((phase: StartupPhase) => {
    dispatch({ type: "SET_PHASE", phase });
  }, []);

  const completeStartup = useCallback(() => {
    dispatch({ type: "COMPLETE_STARTUP" });
  }, []);

  const fatalError = useCallback((message: string) => {
    dispatch({ type: "FATAL_ERROR", message });
  }, []);

  // Auto-complete startup when all critical activities are done
  useEffect(() => {
    if (state.isComplete || state.hasError) return;

    // Clear any existing check
    if (completionCheckRef.current) {
      clearTimeout(completionCheckRef.current);
    }

    // Check completion after a small delay to batch rapid updates
    completionCheckRef.current = setTimeout(() => {
      const criticalActivities = state.activities.filter(
        (a) => a.phase === "data" && ["sessions", "preferences"].includes(a.id)
      );

      // Need at least sessions to be loaded
      const sessionsActivity = state.activities.find((a) => a.id === "sessions");
      if (sessionsActivity?.status === "complete") {
        // All critical activities complete
        const allCriticalComplete = criticalActivities.every(
          (a) => a.status === "complete"
        );
        if (allCriticalComplete || criticalActivities.length === 0) {
          dispatch({ type: "COMPLETE_STARTUP" });
        }
      }
    }, 100);

    return () => {
      if (completionCheckRef.current) {
        clearTimeout(completionCheckRef.current);
      }
    };
  }, [state.activities, state.isComplete, state.hasError]);

  // Listen for Electron startup events
  useEffect(() => {
    if (!isElectron) return;

    interface ElectronStartupEvent {
      id: string;
      label: string;
      status: "pending" | "active" | "complete" | "error";
      detail?: string;
      error?: string;
    }

    const electronAPI = (window as { electronAPI?: { onStartupActivity?: (cb: (activity: ElectronStartupEvent) => void) => () => void } }).electronAPI;
    if (electronAPI?.onStartupActivity) {
      const cleanup = electronAPI.onStartupActivity((event: ElectronStartupEvent) => {
        // Always ensure activity is registered first (server phase for Electron events)
        registerActivity({ id: event.id, label: event.label, phase: "server", status: "pending" });

        if (event.status === "pending") {
          // Already registered above
        } else if (event.status === "active") {
          startActivity(event.id);
          if (event.detail) {
            updateActivity(event.id, event.detail);
          }
        } else if (event.status === "complete") {
          completeActivity(event.id, event.detail);
        } else if (event.status === "error") {
          errorActivity(event.id, event.error || "Unknown error");
        }
      });
      return cleanup;
    }
  }, [isElectron, registerActivity, startActivity, updateActivity, completeActivity, errorActivity]);

  return (
    <StartupContext.Provider
      value={{
        state,
        registerActivity,
        startActivity,
        updateActivity,
        completeActivity,
        errorActivity,
        setPhase,
        completeStartup,
        fatalError,
        isElectron,
      }}
    >
      {children}
    </StartupContext.Provider>
  );
}

// Hook
export function useStartup() {
  const context = useContext(StartupContext);
  if (!context) {
    throw new Error("useStartup must be used within a StartupProvider");
  }
  return context;
}

// Convenience hook for registering and tracking a single activity
export function useStartupActivity(
  id: string,
  label: string,
  phase: StartupPhase = "data"
) {
  const { registerActivity, startActivity, updateActivity, completeActivity, errorActivity } =
    useStartup();
  const registeredRef = useRef(false);

  // Register on mount
  useEffect(() => {
    if (!registeredRef.current) {
      registerActivity({ id, label, phase });
      registeredRef.current = true;
    }
  }, [id, label, phase, registerActivity]);

  return {
    start: () => startActivity(id),
    update: (detail?: string, progress?: number) => updateActivity(id, detail, progress),
    complete: (detail?: string) => completeActivity(id, detail),
    error: (err: string) => errorActivity(id, err),
  };
}
