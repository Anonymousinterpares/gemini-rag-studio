import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("api", {
  saveChatSession: (sessionData) => ipcRenderer.invoke("save-chat-session", sessionData),
  loadAllChatSessions: () => ipcRenderer.invoke("load-all-chat-sessions"),
  loadChatSession: (id) => ipcRenderer.invoke("load-chat-session", id),
  deleteChatSession: (id) => ipcRenderer.invoke("delete-chat-session", id)
});
