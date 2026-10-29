import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels, type MateApi } from "../shared/api";

const api: MateApi = {
  overview: () => ipcRenderer.invoke(IpcChannels.overview),
  saveDuty: (draft) => ipcRenderer.invoke(IpcChannels.saveDuty, draft),
  deleteDuty: (id) => ipcRenderer.invoke(IpcChannels.deleteDuty, id),
  runNow: (id) => ipcRenderer.invoke(IpcChannels.runNow, id),
  setInbox: (ids, status) => ipcRenderer.invoke(IpcChannels.setInbox, ids, status),
  saveConfig: (patch) => ipcRenderer.invoke(IpcChannels.saveConfig, patch),
  pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory),
  restartRunner: () => ipcRenderer.invoke(IpcChannels.restartRunner),
  revealHome: () => ipcRenderer.invoke(IpcChannels.revealHome),
  readSession: (runId) => ipcRenderer.invoke(IpcChannels.readSession, runId),
  applyChange: (itemId) => ipcRenderer.invoke(IpcChannels.applyChange, itemId),
  discardChange: (itemId) => ipcRenderer.invoke(IpcChannels.discardChange, itemId),
  getAutostart: () => ipcRenderer.invoke(IpcChannels.getAutostart),
  setAutostart: (enabled) => ipcRenderer.invoke(IpcChannels.setAutostart, enabled),
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IpcChannels.changed, handler);
    return () => ipcRenderer.removeListener(IpcChannels.changed, handler);
  },
};

contextBridge.exposeInMainWorld("mate", api);
