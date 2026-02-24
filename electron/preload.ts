import { contextBridge, ipcRenderer } from 'electron';

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('api', {
    saveChatSession: (sessionData: any) => ipcRenderer.invoke('save-chat-session', sessionData),
    loadAllChatSessions: () => ipcRenderer.invoke('load-all-chat-sessions'),
    loadChatSession: (id: string) => ipcRenderer.invoke('load-chat-session', id),
    deleteChatSession: (id: string) => ipcRenderer.invoke('delete-chat-session', id),
});
