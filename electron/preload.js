"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose the API to the renderer
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    // Flag to detect Electron environment
    isElectron: true,
    // Plan file events
    onPlanCreated: (callback) => {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on("plan:created", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("plan:created", handler);
        };
    },
    onPlanUpdated: (callback) => {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on("plan:updated", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("plan:updated", handler);
        };
    },
    // Startup activity events (for loading screen)
    onStartupActivity: (callback) => {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on("startup:activity", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("startup:activity", handler);
        };
    },
});
const electronAPI = {
    isElectron: true,
    onPlanCreated: (_callback) => () => { },
    onPlanUpdated: (_callback) => () => { },
    onStartupActivity: (_callback) => () => { },
};
