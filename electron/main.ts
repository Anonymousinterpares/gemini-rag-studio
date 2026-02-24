import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - SystemJS module loader
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT as string, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT as string, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT as string, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC as string, 'favicon.ico'),
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            // Security: Disable nodeIntegration, enable contextIsolation
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString());
    });

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
    } else {
        // win.loadFile('dist/index.html')
        win.loadFile(path.join(RENDERER_DIST, 'index.html'));
    }
}

// Ensure app data directory exists
const getSessionsDir = async () => {
    const userData = app.getPath('userData');
    const sessionsDir = path.join(userData, 'sessions');
    try {
        await fs.mkdir(sessionsDir, { recursive: true });
    } catch (e) {
        // ignore
    }
    return sessionsDir;
};

// IPC Handlers for Chat History
ipcMain.handle('save-chat-session', async (event, sessionData) => {
    try {
        const sessionsDir = await getSessionsDir();
        const filePath = path.join(sessionsDir, `${sessionData.id}.json`);
        await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
        return { success: true };
    } catch (e: any) {
        console.error('Failed to save session:', e);
        return { error: e.message };
    }
});

ipcMain.handle('load-all-chat-sessions', async () => {
    try {
        const sessionsDir = await getSessionsDir();
        const files = await fs.readdir(sessionsDir);
        const sessions = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(sessionsDir, file);
                const data = await fs.readFile(filePath, 'utf-8');
                try {
                    sessions.push(JSON.parse(data));
                } catch (e) {
                    console.error(`Invalid session file: ${file}`);
                }
            }
        }

        // Sort logic happens frontend, but we can do it here too if needed
        return sessions;
    } catch (e: any) {
        console.error('Failed to load all sessions:', e);
        return [];
    }
});

ipcMain.handle('load-chat-session', async (event, id) => {
    try {
        const sessionsDir = await getSessionsDir();
        const filePath = path.join(sessionsDir, `${id}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (e: any) {
        console.error(`Failed to load session ${id}:`, e);
        return null;
    }
});

ipcMain.handle('delete-chat-session', async (event, id) => {
    try {
        const sessionsDir = await getSessionsDir();
        const filePath = path.join(sessionsDir, `${id}.json`);
        await fs.unlink(filePath);
        return { success: true };
    } catch (e: any) {
        console.error(`Failed to delete session ${id}:`, e);
        return { error: e.message };
    }
});

// Start the app
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
        win = null;
    }
});

app.whenReady().then(createWindow);
