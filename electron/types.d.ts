// Type declarations for the Electron API exposed via contextBridge

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

interface PtyResult {
  success?: boolean;
  error?: string;
  terminalId?: string;
}

interface ElectronAPI {
  isElectron: true;
  pty: {
    spawn: (options: PtySpawnOptions) => Promise<PtyResult>;
    write: (options: PtyWriteOptions) => Promise<PtyResult>;
    resize: (options: PtyResizeOptions) => Promise<PtyResult>;
    kill: (options: PtyKillOptions) => Promise<PtyResult>;
    onData: (callback: (event: PtyDataEvent) => void) => () => void;
    onExit: (callback: (event: PtyExitEvent) => void) => () => void;
    onTitle: (callback: (event: PtyTitleEvent) => void) => () => void;
    onContext: (callback: (event: PtyContextEvent) => void) => () => void;
    onPlan: (callback: (event: PtyPlanEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
