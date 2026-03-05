import { contextBridge, ipcRenderer } from "electron";

// Plan event types
interface PlanEvent {
  event: "created" | "updated";
  slug: string;
  path: string;
  content: string;
}

// Startup activity types
interface StartupActivityEvent {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
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
};
