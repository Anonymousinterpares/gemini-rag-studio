var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
import { contextBridge, ipcRenderer } from "electron";
var require_preload = __commonJS({
  "preload.cjs"() {
    contextBridge.exposeInMainWorld("api", {
      saveChatSession: (sessionData) => ipcRenderer.invoke("save-chat-session", sessionData),
      loadAllChatSessions: () => ipcRenderer.invoke("load-all-chat-sessions"),
      loadChatSession: (id) => ipcRenderer.invoke("load-chat-session", id),
      deleteChatSession: (id) => ipcRenderer.invoke("delete-chat-session", id)
    });
  }
});
export default require_preload();
