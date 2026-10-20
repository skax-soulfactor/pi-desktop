import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannels, type PiDesktopApi } from "../shared/api";

/** main이 보내는 알림을 구독하고, 해제 함수를 돌려준다. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: PiDesktopApi = {
  getConnection: () => ipcRenderer.invoke(IpcChannels.getConnection),
  locatePi: () => ipcRenderer.invoke(IpcChannels.locatePi),
  listSessions: () => ipcRenderer.invoke(IpcChannels.listSessions),
  openSession: (request) => ipcRenderer.invoke(IpcChannels.openSession, request),
  attachSession: (sessionId, lastSeq) => ipcRenderer.invoke(IpcChannels.attachSession, sessionId, lastSeq),
  closeSession: (sessionId) => ipcRenderer.invoke(IpcChannels.closeSession, sessionId),
  sendCommand: (sessionId, command) => ipcRenderer.invoke(IpcChannels.sendCommand, sessionId, command),
  pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory),
  onConnection: (listener) => subscribe(IpcChannels.connectionChanged, listener),
  onSessionEvent: (listener) => subscribe(IpcChannels.sessionEvent, listener),
  onSessionExit: (listener) => subscribe(IpcChannels.sessionExit, listener),
};

contextBridge.exposeInMainWorld("piDesktop", api);
