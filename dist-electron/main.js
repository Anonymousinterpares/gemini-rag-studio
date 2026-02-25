import { ipcMain as c, app as a, BrowserWindow as w } from "electron";
import o from "path";
import { fileURLToPath as m } from "url";
import i from "fs/promises";
const u = o.dirname(m(import.meta.url));
process.env.APP_ROOT = o.join(u, "..");
const h = process.env.VITE_DEV_SERVER_URL, D = o.join(process.env.APP_ROOT, "dist-electron"), f = o.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = h ? o.join(process.env.APP_ROOT, "public") : f;
let r;
function j() {
  r = new w({
    icon: o.join(process.env.VITE_PUBLIC, "favicon.ico"),
    width: 1400,
    height: 900,
    webPreferences: {
      preload: o.join(u, "preload.mjs"),
      // Security: Disable nodeIntegration, enable contextIsolation
      nodeIntegration: !1,
      contextIsolation: !0,
      sandbox: !1
    }
  }), r.webContents.on("did-finish-load", () => {
    r == null || r.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), h ? r.loadURL(h) : r.loadFile(o.join(f, "index.html"));
}
const l = async () => {
  const n = a.getPath("userData"), s = o.join(n, "sessions");
  try {
    await i.mkdir(s, { recursive: !0 });
  } catch {
  }
  return s;
};
c.handle("save-chat-session", async (n, s) => {
  try {
    const e = await l(), t = o.join(e, `${s.id}.json`);
    return await i.writeFile(t, JSON.stringify(s, null, 2), "utf-8"), { success: !0 };
  } catch (e) {
    return console.error("Failed to save session:", e), { error: e.message };
  }
});
c.handle("load-all-chat-sessions", async () => {
  try {
    const n = await l(), s = await i.readdir(n), e = [];
    for (const t of s)
      if (t.endsWith(".json")) {
        const d = o.join(n, t), p = await i.readFile(d, "utf-8");
        try {
          e.push(JSON.parse(p));
        } catch {
          console.error(`Invalid session file: ${t}`);
        }
      }
    return e;
  } catch (n) {
    return console.error("Failed to load all sessions:", n), [];
  }
});
c.handle("load-chat-session", async (n, s) => {
  try {
    const e = await l(), t = o.join(e, `${s}.json`), d = await i.readFile(t, "utf-8");
    return JSON.parse(d);
  } catch (e) {
    return console.error(`Failed to load session ${s}:`, e), null;
  }
});
c.handle("delete-chat-session", async (n, s) => {
  try {
    const e = await l(), t = o.join(e, `${s}.json`);
    return await i.unlink(t), { success: !0 };
  } catch (e) {
    return console.error(`Failed to delete session ${s}:`, e), { error: e.message };
  }
});
a.on("window-all-closed", () => {
  process.platform !== "darwin" && (a.quit(), r = null);
});
a.whenReady().then(j);
export {
  D as MAIN_DIST,
  f as RENDERER_DIST,
  h as VITE_DEV_SERVER_URL
};
