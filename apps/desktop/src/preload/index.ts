import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannels, type PiDesktopApi } from "../shared/api";

/** main이 보내는 (hostId, payload) 알림을 구독하고, 해제 함수를 돌려준다. */
function subscribe<T>(channel: string, listener: (hostId: string, payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, hostId: string, payload: T) => listener(hostId, payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: PiDesktopApi = {
  listHosts: () => ipcRenderer.invoke(IpcChannels.listHosts),
  connectHost: (hostId) => ipcRenderer.invoke(IpcChannels.connectHost, hostId),
  locatePi: (hostId) => ipcRenderer.invoke(IpcChannels.locatePi, hostId),
  listSessions: (hostId) => ipcRenderer.invoke(IpcChannels.listSessions, hostId),
  listHistory: (hostId, cwd) => ipcRenderer.invoke(IpcChannels.listHistory, hostId, cwd),
  inspectStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.inspectStored, hostId, path),
  readStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.readStored, hostId, path),
  watchStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.watchStored, hostId, path),
  unwatchStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.unwatchStored, hostId, path),
  openSession: (hostId, request) => ipcRenderer.invoke(IpcChannels.openSession, hostId, request),
  attachSession: (hostId, sessionId, lastSeq) =>
    ipcRenderer.invoke(IpcChannels.attachSession, hostId, sessionId, lastSeq),
  closeSession: (hostId, sessionId) => ipcRenderer.invoke(IpcChannels.closeSession, hostId, sessionId),
  clearExternalWrite: (hostId, sessionId) => ipcRenderer.invoke(IpcChannels.clearExternalWrite, hostId, sessionId),
  sendCommand: (hostId, sessionId, command) =>
    ipcRenderer.invoke(IpcChannels.sendCommand, hostId, sessionId, command),
  sendRecord: (hostId, sessionId, record) => ipcRenderer.invoke(IpcChannels.sendRecord, hostId, sessionId, record),
  pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory),
  revealFile: (hostId, cwd, path) => ipcRenderer.invoke(IpcChannels.revealFile, hostId, cwd, path),
  piStatus: (hostId) => ipcRenderer.invoke(IpcChannels.piStatus, hostId),
  piLatest: (hostId, force) => ipcRenderer.invoke(IpcChannels.piLatest, hostId, force === true),
  searchFiles: (hostId, cwd, query) => ipcRenderer.invoke(IpcChannels.searchFiles, hostId, cwd, query),
  onConnection: (listener) => subscribe(IpcChannels.connectionChanged, listener),
  onSessionEvent: (listener) => subscribe(IpcChannels.sessionEvent, listener),
  onSessionExit: (listener) => subscribe(IpcChannels.sessionExit, listener),
  onUiResolved: (listener) => subscribe(IpcChannels.uiResolved, listener),
  onStoredChanged: (listener) => subscribe(IpcChannels.storedChanged, listener),
  onExternalWrite: (listener) => subscribe(IpcChannels.externalWrite, listener),
};

contextBridge.exposeInMainWorld("piDesktop", api);
