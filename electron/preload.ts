import { contextBridge, ipcRenderer } from "electron";

// Plan event types
interface PlanEvent {
  event: "created" | "updated";
  slug: string;
  path: string;
  content: string;
}

// Navigate event from main process (file-watcher path, bypasses renderer WS)
interface NavigateEvent {
  view: string;
  path: string;
}

// Startup activity types
interface StartupActivityEvent {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
  error?: string;
}

// App server mode types (dev = hot reload, prod = production build)
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

// Expose the API to the renderer
contextBridge.exposeInMainWorld("electronAPI", {
  // Flag to detect Electron environment
  isElectron: true,

  // Native folder picker dialog
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder") as Promise<{ path?: string; cancelled?: boolean }>,

  // Plan file events
  onPlanCreated: (callback: (event: PlanEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: PlanEvent) => callback(data);
    ipcRenderer.on("plan:created", handler);

    return () => {
      ipcRenderer.removeListener("plan:created", handler);
    };
  },

  onPlanUpdated: (callback: (event: PlanEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: PlanEvent) => callback(data);
    ipcRenderer.on("plan:updated", handler);

    return () => {
      ipcRenderer.removeListener("plan:updated", handler);
    };
  },

  // Startup activity events (for loading screen)
  onStartupActivity: (callback: (event: StartupActivityEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: StartupActivityEvent) => callback(data);
    ipcRenderer.on("startup:activity", handler);

    return () => {
      ipcRenderer.removeListener("startup:activity", handler);
    };
  },

  // Window focus (for CLI navigation)
  focusWindow: () => ipcRenderer.send("window:focus"),

  // Navigate event from main process (file-watcher path)
  onNavigate: (callback: (event: NavigateEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: NavigateEvent) => callback(data);
    ipcRenderer.on("navigate:goto", handler);
    return () => {
      ipcRenderer.removeListener("navigate:goto", handler);
    };
  },

  // Server mode (dev/prod) — read state, hot-swap, and follow transitions
  appMode: {
    get: () => ipcRenderer.invoke("app-mode:get") as Promise<AppModeState>,
    switch: (mode: "dev" | "prod") => ipcRenderer.invoke("app-mode:switch", mode) as Promise<AppModeSwitchResult>,
    onStatus: (callback: (status: AppModeStatus) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: AppModeStatus) => callback(data);
      ipcRenderer.on("app-mode:status", handler);
      return () => {
        ipcRenderer.removeListener("app-mode:status", handler);
      };
    },
  },
});

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI;

const electronAPI = {
  isElectron: true as const,
  selectFolder: () => Promise.resolve({} as { path?: string; cancelled?: boolean }),
  onPlanCreated: (_callback: (event: PlanEvent) => void) => () => {},
  onPlanUpdated: (_callback: (event: PlanEvent) => void) => () => {},
  onStartupActivity: (_callback: (event: StartupActivityEvent) => void) => () => {},
  focusWindow: () => {},
  onNavigate: (_callback: (event: NavigateEvent) => void) => () => {},
  appMode: {
    get: () => Promise.resolve({} as AppModeState),
    switch: (_mode: "dev" | "prod") => Promise.resolve({} as AppModeSwitchResult),
    onStatus: (_callback: (status: AppModeStatus) => void) => () => {},
  },
};
