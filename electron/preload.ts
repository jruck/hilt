import { contextBridge, ipcRenderer } from "electron";

// Expose a minimal API to the renderer
// Currently, we don't need much IPC since the app communicates
// with servers via HTTP/WebSocket, but this is here for future use
contextBridge.exposeInMainWorld("electronAPI", {
  // Platform info
  platform: process.platform,

  // App version
  getVersion: () => ipcRenderer.invoke("get-version"),

  // Open external URL
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      platform: string;
      getVersion: () => Promise<string>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
