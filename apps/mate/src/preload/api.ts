import type { IpcRenderer } from "electron";
import { IpcChannels, type MateApi } from "../shared/api";

/**
 * Mate 화면이 쓰는 window.mate (설계 DESIGN-ONE-APP.md §5).
 * 단독 Mate 앱의 preload와, Pi Desktop의 Mate 작업 공간(프레임) preload가 같은 API를 만든다.
 */
export function createMateApi(ipcRenderer: IpcRenderer): MateApi {
  const api: MateApi = {
    overview: () => ipcRenderer.invoke(IpcChannels.overview),
    saveDuty: (draft) => ipcRenderer.invoke(IpcChannels.saveDuty, draft),
    deleteDuty: (id) => ipcRenderer.invoke(IpcChannels.deleteDuty, id),
    deleteRun: (id) => ipcRenderer.invoke(IpcChannels.deleteRun, id),
    clearChat: () => ipcRenderer.invoke(IpcChannels.clearChat),
    restoreTrash: (id) => ipcRenderer.invoke(IpcChannels.restoreTrash, id),
    emptyTrash: (ids) => ipcRenderer.invoke(IpcChannels.emptyTrash, ids),
    applyInstall: (itemId) => ipcRenderer.invoke(IpcChannels.applyInstall, itemId),
    describeInstall: (itemId) => ipcRenderer.invoke(IpcChannels.describeInstall, itemId),
    skillsList: () => ipcRenderer.invoke(IpcChannels.skillsList),
    listHosts: () => ipcRenderer.invoke(IpcChannels.listHosts),
    currentHost: () => ipcRenderer.invoke(IpcChannels.currentHost),
    setHost: (hostId, stopPrevious) => ipcRenderer.invoke(IpcChannels.setHost, hostId, stopPrevious),
    openSshHosts: () => ipcRenderer.invoke(IpcChannels.openSshHosts),
    listDir: (path) => ipcRenderer.invoke(IpcChannels.listDir, path),
    makeDir: (parent, name) => ipcRenderer.invoke(IpcChannels.makeDir, parent, name),
    skillSave: (previous, input) => ipcRenderer.invoke(IpcChannels.skillSave, previous, input),
    skillDelete: (name) => ipcRenderer.invoke(IpcChannels.skillDelete, name),
    skillOpenFolder: () => ipcRenderer.invoke(IpcChannels.skillOpenFolder),
    listMcp: () => ipcRenderer.invoke(IpcChannels.listMcp),
    tunablesList: () => ipcRenderer.invoke(IpcChannels.tunablesList),
    tunableSet: (id, value) => ipcRenderer.invoke(IpcChannels.tunableSet, id, value),
    appTunablesList: () => ipcRenderer.invoke(IpcChannels.appTunablesList),
    appTunableSet: (id, value) => ipcRenderer.invoke(IpcChannels.appTunableSet, id, value),
    usageSummary: (range: string) => ipcRenderer.invoke(IpcChannels.usageSummary, range),
    addMcpPreset: (id, key) => ipcRenderer.invoke(IpcChannels.addMcpPreset, id, key),
    setMcpEnabled: (name, enabled) => ipcRenderer.invoke(IpcChannels.setMcpEnabled, name, enabled),
    removeMcp: (name) => ipcRenderer.invoke(IpcChannels.removeMcp, name),
    mcpReadText: () => ipcRenderer.invoke(IpcChannels.mcpReadText),
    mcpWriteText: (text: string) => ipcRenderer.invoke(IpcChannels.mcpWriteText, text),
    checkMcp: () => ipcRenderer.invoke(IpcChannels.checkMcp),
    packagesList: () => ipcRenderer.invoke(IpcChannels.packagesList),
    packageInstall: (source) => ipcRenderer.invoke(IpcChannels.packageInstall, source),
    packageRemove: (source) => ipcRenderer.invoke(IpcChannels.packageRemove, source),
    importList: () => ipcRenderer.invoke(IpcChannels.importList),
    importSkill: (from, name) => ipcRenderer.invoke(IpcChannels.importSkill, from, name),
    runNow: (id) => ipcRenderer.invoke(IpcChannels.runNow, id),
    setInbox: (ids, status) => ipcRenderer.invoke(IpcChannels.setInbox, ids, status),
    saveConfig: (patch) => ipcRenderer.invoke(IpcChannels.saveConfig, patch),
    pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory),
    restartRunner: () => ipcRenderer.invoke(IpcChannels.restartRunner),
    revealHome: () => ipcRenderer.invoke(IpcChannels.revealHome),
    readSession: (runId) => ipcRenderer.invoke(IpcChannels.readSession, runId),
    applyChange: (itemId) => ipcRenderer.invoke(IpcChannels.applyChange, itemId),
    delegate: (itemId) => ipcRenderer.invoke(IpcChannels.delegate, itemId),
    discardChange: (itemId) => ipcRenderer.invoke(IpcChannels.discardChange, itemId),
    getAutostart: () => ipcRenderer.invoke(IpcChannels.getAutostart),
    setAutostart: (enabled) => ipcRenderer.invoke(IpcChannels.setAutostart, enabled),
    piReadiness: (refresh) => ipcRenderer.invoke(IpcChannels.piReadiness, refresh === true),
    openPiManager: () => ipcRenderer.invoke(IpcChannels.openPiManager),
    telegramView: () => ipcRenderer.invoke(IpcChannels.telegramView),
    telegramSetToken: (token) => ipcRenderer.invoke(IpcChannels.telegramSetToken, token),
    telegramRemove: () => ipcRenderer.invoke(IpcChannels.telegramRemove),
    telegramPair: () => ipcRenderer.invoke(IpcChannels.telegramPair),
    telegramUnpair: () => ipcRenderer.invoke(IpcChannels.telegramUnpair),
    telegramTest: () => ipcRenderer.invoke(IpcChannels.telegramTest),
    chatSend: (text, answerTo, images) => ipcRenderer.invoke(IpcChannels.chatSend, text, answerTo, images),
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IpcChannels.changed, handler);
      return () => ipcRenderer.removeListener(IpcChannels.changed, handler);
    },
    onOpenTab: (listener) => {
      const handler = (_e: unknown, tab: string) => listener(String(tab));
      ipcRenderer.on(IpcChannels.openTab, handler);
      return () => ipcRenderer.removeListener(IpcChannels.openTab, handler);
    },
  };
  return api;
}
