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
  pickFiles: () => ipcRenderer.invoke(IpcChannels.pickFiles),
  listKeys: () => ipcRenderer.invoke(IpcChannels.listKeys),
  setKey: (name, value) => ipcRenderer.invoke(IpcChannels.setKey, name, value),
  removeKey: (name) => ipcRenderer.invoke(IpcChannels.removeKey, name),
  listTasks: () => ipcRenderer.invoke(IpcChannels.listTasks),
  listSchedules: () => ipcRenderer.invoke(IpcChannels.listSchedules),
  setScheduleEnabled: (id, enabled) => ipcRenderer.invoke(IpcChannels.setScheduleEnabled, id, enabled),
  removeSchedule: (id) => ipcRenderer.invoke(IpcChannels.removeSchedule, id),
  piSetup: () => ipcRenderer.invoke(IpcChannels.piSetup),
  openPiDesktop: () => ipcRenderer.invoke(IpcChannels.openPiDesktop),
  installPiDesktop: () => ipcRenderer.invoke(IpcChannels.installPiDesktop),
  listSessions: () => ipcRenderer.invoke(IpcChannels.listSessions),
  closeSession: (sessionId) => ipcRenderer.invoke(IpcChannels.closeSession, sessionId),
  listMemories: () => ipcRenderer.invoke(IpcChannels.listMemories),
  addMemory: (kind, text) => ipcRenderer.invoke(IpcChannels.addMemory, kind, text),
  forgetMemory: (id) => ipcRenderer.invoke(IpcChannels.forgetMemory, id),
  listRules: () => ipcRenderer.invoke(IpcChannels.listRules),
  removeRule: (rule) => ipcRenderer.invoke(IpcChannels.removeRule, rule),
  listAudit: () => ipcRenderer.invoke(IpcChannels.listAudit),
  openSession: (cwd) => ipcRenderer.invoke(IpcChannels.openSession, cwd),
  attachSession: (sessionId, lastSeq) => ipcRenderer.invoke(IpcChannels.attachSession, sessionId, lastSeq),
  sendCommand: (sessionId, command) => ipcRenderer.invoke(IpcChannels.sendCommand, sessionId, command),
  sendRecord: (sessionId, record) => ipcRenderer.invoke(IpcChannels.sendRecord, sessionId, record),
  onConnection: (listener) => subscribe(IpcChannels.connectionChanged, listener),
  onSessionEvent: (listener) => subscribe(IpcChannels.sessionEvent, listener),
  onSessionExit: (listener) => subscribe(IpcChannels.sessionExit, listener),
  onUiResolved: (listener) => subscribe(IpcChannels.uiResolved, listener),
  onTasksChanged: (listener) => subscribe(IpcChannels.tasksChanged, () => listener()),
  onInstallProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, received: number, total: number) => listener(received, total);
    ipcRenderer.on(IpcChannels.installProgress, handler);
    return () => ipcRenderer.removeListener(IpcChannels.installProgress, handler);
  },
};

contextBridge.exposeInMainWorld("piAgent", api);
