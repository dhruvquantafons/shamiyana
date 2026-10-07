// The only bridge between the local pages in ui/ and the main process. The
// app itself (loaded from 127.0.0.1) gets this too, but it never calls it.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shamiyana", {
  onStatus: (cb) => ipcRenderer.on("status", (_e, message) => cb(message)),
  onFailed: (cb) => ipcRenderer.on("failed", (_e, info) => cb(info)),
  license: () => ipcRenderer.invoke("license:get"),
  activate: (key) => ipcRenderer.invoke("license:activate", key),
  createAdmin: (details) => ipcRenderer.invoke("setup:create-admin", details),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  retry: () => ipcRenderer.invoke("app:retry"),
});
