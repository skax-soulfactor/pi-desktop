import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannels, type AgentApi } from "../shared/api";

/** main이 보내는 알림을 구독하고, 해제 함수를 돌려준다. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: AgentApi = {
  connectionState: () => ipcRenderer.invoke(IpcChannels.connectionState),
  defaultCwd: () => ipcRenderer.invoke(IpcChannels.defaultCwd),
  pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory),
  openSession: (cwd) => ipcRenderer.invoke(IpcChannels.openSession, cwd),
  attachSession: (sessionId, lastSeq) => ipcRenderer.invoke(IpcChannels.attachSession, sessionId, lastSeq),
  sendCommand: (sessionId, command) => ipcRenderer.invoke(IpcChannels.sendCommand, sessionId, command),
  sendRecord: (sessionId, record) => ipcRenderer.invoke(IpcChannels.sendRecord, sessionId, record),
  onConnection: (listener) => subscribe(IpcChannels.connectionChanged, listener),
  onSessionEvent: (listener) => subscribe(IpcChannels.sessionEvent, listener),
  onSessionExit: (listener) => subscribe(IpcChannels.sessionExit, listener),
  onUiResolved: (listener) => subscribe(IpcChannels.uiResolved, listener),
};

contextBridge.exposeInMainWorld("piAgent", api);
