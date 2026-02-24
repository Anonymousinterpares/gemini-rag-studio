import { contextBridge as o, ipcRenderer as s } from "electron";
o.exposeInMainWorld("api", {
  saveChatSession: (e) => s.invoke("save-chat-session", e),
  loadAllChatSessions: () => s.invoke("load-all-chat-sessions"),
  loadChatSession: (e) => s.invoke("load-chat-session", e),
  deleteChatSession: (e) => s.invoke("delete-chat-session", e)
});
