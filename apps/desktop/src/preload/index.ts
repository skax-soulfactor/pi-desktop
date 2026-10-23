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
  listSshHosts: () => ipcRenderer.invoke(IpcChannels.listSshHosts),
  saveSshHost: (host, previousName) => ipcRenderer.invoke(IpcChannels.saveSshHost, host, previousName),
  removeSshHost: (name) => ipcRenderer.invoke(IpcChannels.removeSshHost, name),
  replaceAgent: (hostId) => ipcRenderer.invoke(IpcChannels.replaceAgent, hostId),
  locatePi: (hostId) => ipcRenderer.invoke(IpcChannels.locatePi, hostId),
  listSessions: (hostId) => ipcRenderer.invoke(IpcChannels.listSessions, hostId),
  listHistory: (hostId, cwd) => ipcRenderer.invoke(IpcChannels.listHistory, hostId, cwd),
  inspectStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.inspectStored, hostId, path),
  readStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.readStored, hostId, path),
  watchStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.watchStored, hostId, path),
  unwatchStored: (hostId, path) => ipcRenderer.invoke(IpcChannels.unwatchStored, hostId, path),
  watchTree: (hostId, watchId, roots) => ipcRenderer.invoke(IpcChannels.watchTree, hostId, watchId, roots),
  playgroundRun: (hostId, params) => ipcRenderer.invoke(IpcChannels.playgroundRun, hostId, params),
  playgroundStop: (hostId, runId) => ipcRenderer.invoke(IpcChannels.playgroundStop, hostId, runId),
  unwatchTree: (hostId, watchId) => ipcRenderer.invoke(IpcChannels.unwatchTree, hostId, watchId),
  openSession: (hostId, request) => ipcRenderer.invoke(IpcChannels.openSession, hostId, request),
  attachSession: (hostId, sessionId, lastSeq) =>
    ipcRenderer.invoke(IpcChannels.attachSession, hostId, sessionId, lastSeq),
  closeSession: (hostId, sessionId) => ipcRenderer.invoke(IpcChannels.closeSession, hostId, sessionId),
  clearExternalWrite: (hostId, sessionId) => ipcRenderer.invoke(IpcChannels.clearExternalWrite, hostId, sessionId),
  claimWriter: (hostId, sessionId) => ipcRenderer.invoke(IpcChannels.claimWriter, hostId, sessionId),
  sendCommand: (hostId, sessionId, command) =>
    ipcRenderer.invoke(IpcChannels.sendCommand, hostId, sessionId, command),
  sendRecord: (hostId, sessionId, record) => ipcRenderer.invoke(IpcChannels.sendRecord, hostId, sessionId, record),
  pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory),
  revealFile: (hostId, cwd, path) => ipcRenderer.invoke(IpcChannels.revealFile, hostId, cwd, path),
  piStatus: (hostId) => ipcRenderer.invoke(IpcChannels.piStatus, hostId),
  piUpdate: (hostId, target, taskId, force) =>
    ipcRenderer.invoke(IpcChannels.piUpdate, hostId, target, taskId, force === true),
  authProviders: (hostId) => ipcRenderer.invoke(IpcChannels.authProviders, hostId),
  authCheck: (hostId, provider) => ipcRenderer.invoke(IpcChannels.authCheck, hostId, provider),
  authSetApiKey: (hostId, provider, key) => ipcRenderer.invoke(IpcChannels.authSetApiKey, hostId, provider, key),
  authRemove: (hostId, provider) => ipcRenderer.invoke(IpcChannels.authRemove, hostId, provider),
  modelsRead: (hostId) => ipcRenderer.invoke(IpcChannels.modelsRead, hostId),
  modelsSaveProvider: (hostId, provider, previousId) =>
    ipcRenderer.invoke(IpcChannels.modelsSaveProvider, hostId, provider, previousId),
  modelsRemoveProvider: (hostId, id) => ipcRenderer.invoke(IpcChannels.modelsRemoveProvider, hostId, id),
  modelsProbe: (hostId, baseUrl, apiKey, providerId) =>
    ipcRenderer.invoke(IpcChannels.modelsProbe, hostId, baseUrl, apiKey, providerId),
  terminalOpen: (request) => ipcRenderer.invoke(IpcChannels.terminalOpen, request),
  terminalWrite: (id, data) => ipcRenderer.send(IpcChannels.terminalWrite, id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.send(IpcChannels.terminalResize, id, cols, rows),
  terminalClose: (id) => ipcRenderer.send(IpcChannels.terminalClose, id),
  onTerminalData: (listener) => subscribe(IpcChannels.terminalData, listener),
  onTerminalExit: (listener) => subscribe(IpcChannels.terminalExit, listener),
  dataBackup: (hostId) => ipcRenderer.invoke(IpcChannels.dataBackup, hostId),
  dataDelete: (hostId, confirm) => ipcRenderer.invoke(IpcChannels.dataDelete, hostId, confirm),
  piVersions: (hostId) => ipcRenderer.invoke(IpcChannels.piVersions, hostId),
  piLatest: (hostId, force) => ipcRenderer.invoke(IpcChannels.piLatest, hostId, force === true),
  piModels: (hostId) => ipcRenderer.invoke(IpcChannels.piModels, hostId),
  searchFiles: (hostId, cwd, query) => ipcRenderer.invoke(IpcChannels.searchFiles, hostId, cwd, query),
  listDir: (hostId, path) => ipcRenderer.invoke(IpcChannels.listDir, hostId, path),
  makeDir: (hostId, parent, name) => ipcRenderer.invoke(IpcChannels.makeDir, hostId, parent, name),
  listResources: (hostId, cwd) => ipcRenderer.invoke(IpcChannels.listResources, hostId, cwd),
  marketSearch: (query, from) => ipcRenderer.invoke(IpcChannels.marketSearch, query, from),
  marketDetail: (name) => ipcRenderer.invoke(IpcChannels.marketDetail, name),
  githubBrowse: (spec) => ipcRenderer.invoke(IpcChannels.githubBrowse, spec),
  githubText: (repo, path) => ipcRenderer.invoke(IpcChannels.githubText, repo, path),
  githubImport: (request) => ipcRenderer.invoke(IpcChannels.githubImport, request),
  listImports: (hostId) => ipcRenderer.invoke(IpcChannels.listImports, hostId),
  exportResource: (hostId, kind, path) => ipcRenderer.invoke(IpcChannels.exportResource, hostId, kind, path),
  modelsExport: (hostId, id) => ipcRenderer.invoke(IpcChannels.modelsExport, hostId, id),
  modelsImport: (hostId, id, provider, replace) => ipcRenderer.invoke(IpcChannels.modelsImport, hostId, id, provider, replace),
  modelsExportModel: (hostId, providerId, modelId) => ipcRenderer.invoke(IpcChannels.modelsExportModel, hostId, providerId, modelId),
  modelsImportModel: (hostId, providerId, model, replace) =>
    ipcRenderer.invoke(IpcChannels.modelsImportModel, hostId, providerId, model, replace),
  settingsRead: (hostId, target) => ipcRenderer.invoke(IpcChannels.settingsRead, hostId, target),
  settingsWrite: (hostId, content, baseMtime, target) => ipcRenderer.invoke(IpcChannels.settingsWrite, hostId, content, baseMtime, target),
  packageResources: (hostId, cwd, source, scope, overlay) => ipcRenderer.invoke(IpcChannels.packageResources, hostId, cwd, source, scope, overlay),
  setPackageFilter: (hostId, cwd, source, scope, changes, reset, set, overlay) =>
    ipcRenderer.invoke(IpcChannels.setPackageFilter, hostId, cwd, source, scope, changes, reset, set, overlay),
  settingsMerge: (hostId, values, remove, target) => ipcRenderer.invoke(IpcChannels.settingsMerge, hostId, values, remove, target),
  settingsSchema: (hostId) => ipcRenderer.invoke(IpcChannels.settingsSchema, hostId),
  importResourceFiles: (hostId, params) => ipcRenderer.invoke(IpcChannels.importResourceFiles, hostId, params),
  importStatus: (hostId) => ipcRenderer.invoke(IpcChannels.importStatus, hostId),
  recordCopy: (input) => ipcRenderer.invoke(IpcChannels.recordCopy, input),
  copyStatus: (hostId) => ipcRenderer.invoke(IpcChannels.copyStatus, hostId),
  hostInventory: (hostId) => ipcRenderer.invoke(IpcChannels.hostInventory, hostId),
  listActionLog: (limit) => ipcRenderer.invoke(IpcChannels.listActionLog, limit),
  updateState: () => ipcRenderer.invoke(IpcChannels.updateState),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannels.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.installUpdate),
  openRelease: () => ipcRenderer.invoke(IpcChannels.openRelease),
  onMenuCommand: (listener) => {
    const handler = (_event: unknown, id: string) => listener(id);
    ipcRenderer.on(IpcChannels.menuCommand, handler);
    return () => ipcRenderer.removeListener(IpcChannels.menuCommand, handler);
  },
  onUpdateState: (listener) => {
    const handler = (_event: unknown, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on(IpcChannels.updateStateChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannels.updateStateChanged, handler);
  },
  logAction: (entry) => ipcRenderer.invoke(IpcChannels.logAction, entry),
  importUpdate: (hostId, target) => ipcRenderer.invoke(IpcChannels.importUpdate, hostId, target),
  importRemove: (hostId, target) => ipcRenderer.invoke(IpcChannels.importRemove, hostId, target),
  importDiff: (hostId, target, path, upstreamSha) => ipcRenderer.invoke(IpcChannels.importDiff, hostId, target, path, upstreamSha),
  getTrust: (hostId, cwd) => ipcRenderer.invoke(IpcChannels.getTrust, hostId, cwd),
  setTrust: (hostId, cwd, decision) => ipcRenderer.invoke(IpcChannels.setTrust, hostId, cwd, decision),
  readResource: (hostId, cwd, path) => ipcRenderer.invoke(IpcChannels.readResource, hostId, cwd, path),
  writeResource: (hostId, cwd, path, content, baseMtime) =>
    ipcRenderer.invoke(IpcChannels.writeResource, hostId, cwd, path, content, baseMtime),
  createResource: (hostId, cwd, kind, scope, name) => ipcRenderer.invoke(IpcChannels.createResource, hostId, cwd, kind, scope, name),
  onConnection: (listener) => subscribe(IpcChannels.connectionChanged, listener),
  onSessionEvent: (listener) => subscribe(IpcChannels.sessionEvent, listener),
  onSessionExit: (listener) => subscribe(IpcChannels.sessionExit, listener),
  onUiResolved: (listener) => subscribe(IpcChannels.uiResolved, listener),
  onStoredChanged: (listener) => subscribe(IpcChannels.storedChanged, listener),
  onExternalWrite: (listener) => subscribe(IpcChannels.externalWrite, listener),
  onWriterChanged: (listener) => subscribe(IpcChannels.writerChanged, listener),
  onFilesChanged: (listener) => subscribe(IpcChannels.filesChanged, listener),
  onPlaygroundOutput: (listener) => subscribe(IpcChannels.playgroundOutput, listener),
  onPiUpdateOutput: (listener) => subscribe(IpcChannels.piUpdateOutput, listener),
};

contextBridge.exposeInMainWorld("piDesktop", api);
