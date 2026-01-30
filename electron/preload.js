"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Store cleanup functions for each listener
const cleanupFunctions = new Map();
// Expose the API to the renderer
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    // Flag to detect Electron environment
    isElectron: true,
    pty: {
        // Spawn a new terminal
        spawn: async (options) => {
            return electron_1.ipcRenderer.invoke("pty:spawn", options);
        },
        // Write data to terminal
        write: async (options) => {
            return electron_1.ipcRenderer.invoke("pty:write", options);
        },
        // Resize terminal
        resize: async (options) => {
            return electron_1.ipcRenderer.invoke("pty:resize", options);
        },
        // Kill terminal
        kill: async (options) => {
            return electron_1.ipcRenderer.invoke("pty:kill", options);
        },
        // Event listeners with cleanup
        onData: (callback) => {
            const handler = (_, data) => callback(data);
            electron_1.ipcRenderer.on("pty:data", handler);
            // Return cleanup function
            return () => {
                electron_1.ipcRenderer.removeListener("pty:data", handler);
            };
        },
        onExit: (callback) => {
            const handler = (_, data) => callback(data);
            electron_1.ipcRenderer.on("pty:exit", handler);
            return () => {
                electron_1.ipcRenderer.removeListener("pty:exit", handler);
            };
        },
        onTitle: (callback) => {
            const handler = (_, data) => callback(data);
            electron_1.ipcRenderer.on("pty:title", handler);
            return () => {
                electron_1.ipcRenderer.removeListener("pty:title", handler);
            };
        },
        onContext: (callback) => {
            const handler = (_, data) => callback(data);
            electron_1.ipcRenderer.on("pty:context", handler);
            return () => {
                electron_1.ipcRenderer.removeListener("pty:context", handler);
            };
        },
        onPlan: (callback) => {
            const handler = (_, data) => callback(data);
            electron_1.ipcRenderer.on("pty:plan", handler);
            return () => {
                electron_1.ipcRenderer.removeListener("pty:plan", handler);
            };
        },
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
    pty: {
        spawn: async (_options) => ({ success: true, terminalId: _options.terminalId }),
        write: async (_options) => ({ success: true }),
        resize: async (_options) => ({ success: true }),
        kill: async (_options) => ({ success: true }),
        onData: (_callback) => () => { },
        onExit: (_callback) => () => { },
        onTitle: (_callback) => () => { },
        onContext: (_callback) => () => { },
        onPlan: (_callback) => () => { },
    },
    onStartupActivity: (_callback) => () => { },
};
