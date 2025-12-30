import { app, BrowserWindow, shell, nativeImage } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as net from "net";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;
let wsServerProcess: ChildProcess | null = null;
let nextServerProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === "development";

// Set app name (shows in dock and menu bar)
app.name = "Claude Kanban";

// Ports for servers
let httpPort = 3000;
let wsPort = 3001;

// Get app data directory
function getAppDataPath(): string {
  const appDataPath = path.join(
    app.getPath("appData"),
    "Claude Kanban"
  );
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
  }
  return appDataPath;
}

// Find an available port
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

// Wait for a port to be available
async function waitForPort(port: number, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(port, "127.0.0.1");
        socket.on("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Timeout waiting for port ${port}`);
}

// Start the WebSocket server
function startWSServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const appPath = isDev
      ? path.join(__dirname, "..")
      : path.join(process.resourcesPath, "app");

    const env = {
      ...process.env,
      WS_PORT: wsPort.toString(),
      DATA_DIR: getAppDataPath(),
    };

    const tsxPath = isDev
      ? path.join(appPath, "node_modules", ".bin", "tsx")
      : path.join(appPath, "node_modules", ".bin", "tsx");

    wsServerProcess = spawn(tsxPath, ["server/ws-server.ts"], {
      cwd: appPath,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    wsServerProcess.stdout?.on("data", (data) => {
      console.log(`[WS Server] ${data.toString().trim()}`);
    });

    wsServerProcess.stderr?.on("data", (data) => {
      console.error(`[WS Server Error] ${data.toString().trim()}`);
    });

    wsServerProcess.on("error", (err) => {
      console.error("Failed to start WS server:", err);
      reject(err);
    });

    // Wait a bit then resolve
    setTimeout(() => resolve(wsServerProcess!), 500);
  });
}

// Start the Next.js server
function startNextServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const appPath = isDev
      ? path.join(__dirname, "..")
      : path.join(process.resourcesPath, "app");

    const env = {
      ...process.env,
      PORT: httpPort.toString(),
      DATA_DIR: getAppDataPath(),
    };

    const command = isDev ? "dev" : "start";
    const npmPath = process.platform === "win32" ? "npm.cmd" : "npm";

    nextServerProcess = spawn(npmPath, ["run", command], {
      cwd: appPath,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    nextServerProcess.stdout?.on("data", (data) => {
      console.log(`[Next.js] ${data.toString().trim()}`);
    });

    nextServerProcess.stderr?.on("data", (data) => {
      console.error(`[Next.js Error] ${data.toString().trim()}`);
    });

    nextServerProcess.on("error", (err) => {
      console.error("Failed to start Next.js server:", err);
      reject(err);
    });

    resolve(nextServerProcess);
  });
}

// Get icon path
function getIconPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "build", "icon.icns");
  }
  return path.join(process.resourcesPath, "icon.icns");
}

// Create the main window
function createWindow() {
  const iconPath = getIconPath();
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    icon: icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${httpPort}`);

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Graceful shutdown
async function shutdown() {
  // In dev mode, servers are managed externally (by concurrently)
  if (isDev) {
    console.log("Development mode - servers managed externally");
    return;
  }

  console.log("Shutting down servers...");

  if (wsServerProcess) {
    wsServerProcess.kill("SIGTERM");
    wsServerProcess = null;
  }

  if (nextServerProcess) {
    nextServerProcess.kill("SIGTERM");
    nextServerProcess = null;
  }

  // Wait a bit for graceful shutdown
  await new Promise((r) => setTimeout(r, 1000));
}

// App lifecycle
app.on("ready", async () => {
  try {
    if (isDev) {
      // In dev mode, servers are started by concurrently in package.json
      // Just wait for them to be ready and open the window
      console.log("Development mode - servers started externally");
      httpPort = 3000;
      wsPort = 3001;

      console.log("Waiting for Next.js to be ready...");
      await waitForPort(httpPort);
      console.log("Next.js is ready!");
    } else {
      // In production mode, start servers ourselves
      httpPort = await findAvailablePort(3000);
      wsPort = await findAvailablePort(3001);

      console.log(`Using ports: HTTP=${httpPort}, WS=${wsPort}`);

      // Start servers
      await startWSServer();
      console.log("WebSocket server starting...");

      await startNextServer();
      console.log("Next.js server starting...");

      // Wait for Next.js to be ready
      console.log("Waiting for Next.js to be ready...");
      await waitForPort(httpPort);
      console.log("Next.js is ready!");
    }

    // Set dock icon on macOS
    if (process.platform === "darwin" && app.dock) {
      try {
        const iconPath = getIconPath();
        if (fs.existsSync(iconPath)) {
          const icon = nativeImage.createFromPath(iconPath);
          if (!icon.isEmpty()) {
            app.dock.setIcon(icon);
          }
        }
      } catch (e) {
        console.log("Could not set dock icon:", e);
      }
    }

    // Create window
    createWindow();
  } catch (err) {
    console.error("Failed to start app:", err);
    app.quit();
  }
});

app.on("window-all-closed", async () => {
  await shutdown();
  app.quit();
});

app.on("before-quit", async () => {
  await shutdown();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
