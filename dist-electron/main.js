import { ipcMain, app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Security: Disable nodeIntegration, enable contextIsolation
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
const getSessionsDir = async () => {
  const userData = app.getPath("userData");
  const sessionsDir = path.join(userData, "sessions");
  try {
    await fs.mkdir(sessionsDir, { recursive: true });
  } catch (e) {
  }
  return sessionsDir;
};
ipcMain.handle("save-chat-session", async (event, sessionData) => {
  try {
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionData.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), "utf-8");
    return { success: true };
  } catch (e) {
    console.error("Failed to save session:", e);
    return { error: e.message };
  }
});
ipcMain.handle("load-all-chat-sessions", async () => {
  try {
    const sessionsDir = await getSessionsDir();
    const files = await fs.readdir(sessionsDir);
    const sessions = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(sessionsDir, file);
        const data = await fs.readFile(filePath, "utf-8");
        try {
          sessions.push(JSON.parse(data));
        } catch (e) {
          console.error(`Invalid session file: ${file}`);
        }
      }
    }
    return sessions;
  } catch (e) {
    console.error("Failed to load all sessions:", e);
    return [];
  }
});
ipcMain.handle("load-chat-session", async (event, id) => {
  try {
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${id}.json`);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error(`Failed to load session ${id}:`, e);
    return null;
  }
});
ipcMain.handle("delete-chat-session", async (event, id) => {
  try {
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${id}.json`);
    await fs.unlink(filePath);
    return { success: true };
  } catch (e) {
    console.error(`Failed to delete session ${id}:`, e);
    return { error: e.message };
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.whenReady().then(createWindow);
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
