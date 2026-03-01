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

interface ElectronAPI {
  isElectron: true;
  selectFolder: () => Promise<{ path?: string; cancelled?: boolean }>;
  onPlanCreated: (callback: (event: PlanEvent) => void) => () => void;
  onPlanUpdated: (callback: (event: PlanEvent) => void) => () => void;
  onStartupActivity: (callback: (event: StartupActivityEvent) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
