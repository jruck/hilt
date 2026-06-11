// Type declarations for the Electron API exposed via contextBridge

interface PlanEvent {
  event: "created" | "updated";
  slug: string;
  path: string;
  content: string;
}

interface StartupActivityEvent {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
  error?: string;
}

interface NavigateEvent {
  view: string;
  path: string;
}

interface AppModeStatus {
  state: "idle" | "rebuilding" | "switching" | "reverting";
  mode: "dev" | "prod";
  target?: "dev" | "prod";
  detail?: string;
}

interface AppModeState {
  mode: "dev" | "prod";
  supervised: boolean;
  prodBuildAvailable: boolean;
  status: AppModeStatus;
}

interface AppModeSwitchResult {
  ok: boolean;
  mode: "dev" | "prod";
  error?: string;
}

interface ElectronAPI {
  isElectron: true;
  selectFolder: () => Promise<{ path?: string; cancelled?: boolean }>;
  onPlanCreated: (callback: (event: PlanEvent) => void) => () => void;
  onPlanUpdated: (callback: (event: PlanEvent) => void) => () => void;
  onStartupActivity: (callback: (event: StartupActivityEvent) => void) => () => void;
  focusWindow: () => void;
  onNavigate: (callback: (event: NavigateEvent) => void) => () => void;
  appMode?: {
    get: () => Promise<AppModeState>;
    switch: (mode: "dev" | "prod") => Promise<AppModeSwitchResult>;
    onStatus: (callback: (status: AppModeStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
