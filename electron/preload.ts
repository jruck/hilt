import { contextBridge, ipcRenderer } from "electron";

// Types for the PTY API
interface PtySpawnOptions {
  terminalId: string;
  sessionId: string;
  projectPath?: string;
  isNew?: boolean;
  initialPrompt?: string;
}

interface PtyWriteOptions {
  terminalId: string;
  data: string;
}

interface PtyResizeOptions {
  terminalId: string;
  cols: number;
  rows: number;
}

interface PtyKillOptions {
  terminalId: string;
}

// Event types
interface PtyDataEvent {
  terminalId: string;
  data: string;
}

interface PtyExitEvent {
  terminalId: string;
  exitCode: number;
}

interface PtyTitleEvent {
  terminalId: string;
  title: string;
}

interface PtyContextEvent {
  terminalId: string;
  progress: number;
}

interface PtyPlanEvent {
  event: "created" | "updated";
  slug: string;
  path: string;
  content: string;
}

// Store cleanup functions for each listener
const cleanupFunctions = new Map<string, () => void>();

// Expose the API to the renderer
contextBridge.exposeInMainWorld("electronAPI", {
  // Flag to detect Electron environment
  isElectron: true,

  pty: {
    // Spawn a new terminal
    spawn: async (options: PtySpawnOptions) => {
      return ipcRenderer.invoke("pty:spawn", options);
    },

    // Write data to terminal
    write: async (options: PtyWriteOptions) => {
      return ipcRenderer.invoke("pty:write", options);
    },

    // Resize terminal
    resize: async (options: PtyResizeOptions) => {
      return ipcRenderer.invoke("pty:resize", options);
    },

    // Kill terminal
    kill: async (options: PtyKillOptions) => {
      return ipcRenderer.invoke("pty:kill", options);
    },

    // Event listeners with cleanup
    onData: (callback: (event: PtyDataEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: PtyDataEvent) => callback(data);
      ipcRenderer.on("pty:data", handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener("pty:data", handler);
      };
    },

    onExit: (callback: (event: PtyExitEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: PtyExitEvent) => callback(data);
      ipcRenderer.on("pty:exit", handler);

      return () => {
        ipcRenderer.removeListener("pty:exit", handler);
      };
    },

    onTitle: (callback: (event: PtyTitleEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: PtyTitleEvent) => callback(data);
      ipcRenderer.on("pty:title", handler);

      return () => {
        ipcRenderer.removeListener("pty:title", handler);
      };
    },

    onContext: (callback: (event: PtyContextEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: PtyContextEvent) => callback(data);
      ipcRenderer.on("pty:context", handler);

      return () => {
        ipcRenderer.removeListener("pty:context", handler);
      };
    },

    onPlan: (callback: (event: PtyPlanEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: PtyPlanEvent) => callback(data);
      ipcRenderer.on("pty:plan", handler);

      return () => {
        ipcRenderer.removeListener("pty:plan", handler);
      };
    },
  },
});

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI;

const electronAPI = {
  isElectron: true as const,
  pty: {
    spawn: async (options: PtySpawnOptions) => ({ success: true, terminalId: options.terminalId }),
    write: async (options: PtyWriteOptions) => ({ success: true }),
    resize: async (options: PtyResizeOptions) => ({ success: true }),
    kill: async (options: PtyKillOptions) => ({ success: true }),
    onData: (callback: (event: PtyDataEvent) => void) => () => {},
    onExit: (callback: (event: PtyExitEvent) => void) => () => {},
    onTitle: (callback: (event: PtyTitleEvent) => void) => () => {},
    onContext: (callback: (event: PtyContextEvent) => void) => () => {},
    onPlan: (callback: (event: PtyPlanEvent) => void) => () => {},
  },
};
