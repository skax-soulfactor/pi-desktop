import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadRemoteState, mateHome, matePaths, saveConfig, type ConfigPatch, type InboxStatus } from "@pi-desktop/mate-runner";
import { IpcChannels, type DutyDraft, type McpCheckResult, type Overview, type PiReadiness, type PiSetupView, type RunnerView, type SkillInput } from "../shared/api";
import { RunnerConnection, type RunnerConnectionState } from "./runner-connection";

import { getAutostart, isRunnerOnlyLaunch, RUNNER_ONLY_ARG, setAutostart } from "./autostart";
import { installPiDesktop, openPiDesktop, piDesktopInfo } from "./pi-setup";
import { resolveNodeRuntime, runnerCommand } from "./runner-process";
import type { TelegramStore } from "./telegram-setup";
import {
  createPairingCode,
  removeTelegram,
  saveTelegramToken,
  sendTelegramTest,
  telegramEnv,
  telegramView,
  unpairTelegram,
} from "./telegram-setup";
import { Updater } from "./updater";

const here = fileURLToPath(new URL(".", import.meta.url));
const paths = matePaths(mateHome());

/** 번들된 실행기. 설치본은 앱 리소스(M3), 개발 중에는 워크스페이스의 빌드 결과 */
function runnerScript(): string {
  if (process.env.PI_DESKTOP_MATE_RUNNER) return process.env.PI_DESKTOP_MATE_RUNNER;
  if (app.isPackaged) return join(process.resourcesPath, "mate-runner", "mate-runner.mjs");
  return resolve(app.getAppPath(), "../../packages/mate-runner/dist/mate-runner.mjs");
}

/** mate-kit 폴더. 실행기가 띄우는 Pi가 이 경로의 확장을 -e로 불러온다 */
function kitDir(): string {
  if (process.env.PI_DESKTOP_MATE_KIT) return process.env.PI_DESKTOP_MATE_KIT;
  if (app.isPackaged) return join(process.resourcesPath, "mate-kit");
  return resolve(app.getAppPath(), "../../packages/mate-kit");
}

function runnerEnv(): Record<string, string> {
  return { MATE_HOME: paths.home, PI_DESKTOP_MATE_KIT: kitDir() };
}

// 개발 실행은 설치본과 userData(창 상태·단일 인스턴스 잠금)를 나눈다.
// 같으면 설치본이 켜져 있을 때 개발 실행이 잠금에 걸려 바로 끝나고, 설치본 창을 앞으로 불러낸다.
if (!app.isPackaged) app.setPath("userData", join(app.getPath("appData"), "Pi Desktop Mate (dev)"));

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;
let runnerError: string | undefined;

/**
 * 실행기 연결 (설계 DESIGN-MATE-REMOTE.md §2). 화면이 쓰는 데이터는 모두 실행기의 mate.call로 오간다.
 * 연결은 `mate-runner connect`가 실행기를 띄우고(없으면) 소켓에 이어 준다.
 */
let connection: RunnerConnection | undefined;
const call = <T = unknown>(name: string, ...args: unknown[]): Promise<T> => {
  if (!connection) return Promise.reject(new Error("실행기에 아직 연결하지 않았습니다"));
  return connection.call<T>(name, ...args);
};

/** 실행기에 붙기 전에도 쓰는 로컬 저장소 (연결 명령에 넘길 휴대폰 토큰을 읽는다) */
const localStore: TelegramStore = {
  config: () => loadConfig(paths),
  saveConfig: (patch: ConfigPatch) => saveConfig(paths, patch),
  remoteState: () => loadRemoteState(paths),
};

/** 실행기 RPC로 설정과 휴대폰 연결 상태를 읽고 쓰는 저장소 */
const runnerStore: TelegramStore = {
  config: () => call("config"),
  saveConfig: (patch: ConfigPatch) => call("saveConfig", patch),
  remoteState: () => call("remoteState"),
};

function startConnection(): void {
  connection = new RunnerConnection({
    launch: async () => {
      const runtime = await resolveNodeRuntime();
      // 휴대폰 연결 토큰은 실행기를 띄울 때만 풀어서 넘긴다 (connect가 실행기를 띄우는 경우)
      return {
        command: runtime.command,
        args: [runnerScript(), "connect"],
        env: { ...process.env, ...runtime.env, ...runnerEnv(), ...(await telegramEnv(localStore)) },
      };
    },
    onChanged: () => mainWindow?.webContents.send(IpcChannels.changed),
    onState: (state: RunnerConnectionState) => {
      runnerError = state.status === "disconnected" ? `실행기에 연결하지 못했습니다: ${state.reason}` : undefined;
      mainWindow?.webContents.send(IpcChannels.changed);
    },
  });
  connection.start();
}

/** 실행기를 멈췄다가 다시 띄운다 (토큰이 바뀌어 환경 변수를 다시 넘겨야 할 때). 연결은 끊긴 뒤 다시 붙으며 새로 띄운다 */
async function restartRunner(): Promise<void> {
  await runnerCommand(runnerScript(), "stop", runnerEnv()).catch(() => undefined);
}

/** 로그인할 때 실행: 창 없이 실행기만 확인한다 */
async function ensureRunner(): Promise<void> {
  try {
    const result = await runnerCommand(runnerScript(), "start", { ...runnerEnv(), ...(await telegramEnv(localStore)) });
    runnerError = result.status === "failed" ? "실행기를 띄우지 못했습니다. 로그를 확인하세요." : undefined;
  } catch (error) {
    runnerError = `실행기를 띄우지 못했습니다: ${(error as Error).message}`;
  }
}

/** Pi 준비 상태 (그 호스트의 Pi). pi --list-models가 몇 초 걸려 5분 동안 기억해 둔다 */
let readinessCache: Promise<PiSetupView> | undefined;
let readinessAt = 0;

function readiness(refresh = false): Promise<PiSetupView> {
  if (refresh || !readinessCache || Date.now() - readinessAt > 5 * 60_000) {
    readinessAt = Date.now();
    readinessCache = call<PiReadiness>("piReadiness").then(
      async (status) => ({ ...status, ...(await piDesktopInfoView()), checkedAt: Date.now() }),
      async (error: Error) => ({
        stage: "no-pi" as const,
        piError: `Pi 상태를 확인하지 못했습니다: ${error.message}`,
        node: { path: "", ok: false },
        authProviders: [],
        models: [],
        ...(await piDesktopInfoView()),
        checkedAt: Date.now(),
      }),
    );
  }
  return readinessCache;
}

async function piDesktopInfoView(): Promise<{ piDesktopPath?: string }> {
  const info = await piDesktopInfo();
  return info.installedPath ? { piDesktopPath: info.installedPath } : {};
}

/** 마지막으로 받은 overview. 실행기와 끊겼을 때 화면이 비지 않게 이것에 "꺼짐"을 붙여 보인다 */
let lastOverview: Overview | undefined;

async function overview(): Promise<Overview> {
  try {
    lastOverview = await call<Overview>("overview");
    return lastOverview;
  } catch (error) {
    if (!lastOverview) throw error;
    const runner: RunnerView = { ...lastOverview.runner, alive: false, error: runnerError ?? (error as Error).message };
    delete runner.pid;
    delete runner.current;
    return { ...lastOverview, runner };
  }
}

function registerIpc(): void {
  // 화면이 쓰는 데이터는 실행기의 app-api로 넘긴다 (DESIGN-MATE-REMOTE.md §2.2)
  const forward = (channel: string, name: string) => ipcMain.handle(channel, (_e, ...args: unknown[]) => call(name, ...args));
  ipcMain.handle(IpcChannels.overview, () => overview());
  ipcMain.handle(IpcChannels.saveDuty, (_e, draft: DutyDraft) => call("saveDuty", draft));
  forward(IpcChannels.deleteDuty, "deleteDuty");
  forward(IpcChannels.deleteRun, "deleteRun");
  forward(IpcChannels.clearChat, "clearChat");
  forward(IpcChannels.restoreTrash, "restoreTrash");
  forward(IpcChannels.emptyTrash, "emptyTrash");
  forward(IpcChannels.applyInstall, "applyInstall");
  forward(IpcChannels.describeInstall, "describeInstall");
  forward(IpcChannels.skillsList, "skillsList");
  ipcMain.handle(IpcChannels.skillSave, (_e, previous: string | undefined, input: SkillInput) => call("skillSave", previous, input));
  forward(IpcChannels.skillDelete, "skillDelete");
  ipcMain.handle(IpcChannels.skillOpenFolder, async () => {
    await mkdir(paths.skills, { recursive: true });
    const error = await shell.openPath(paths.skills);
    if (error) throw new Error(error);
  });
  forward(IpcChannels.listMcp, "mcpList");
  forward(IpcChannels.addMcpPreset, "mcpAddPreset");
  forward(IpcChannels.setMcpEnabled, "mcpSetEnabled");
  forward(IpcChannels.removeMcp, "mcpRemove");
  ipcMain.handle(IpcChannels.openMcpFile, async () => {
    const path = await call<string>("mcpEnsureFile");
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IpcChannels.checkMcp, () => call<McpCheckResult>("mcpCheck"));
  forward(IpcChannels.runNow, "runNow");
  ipcMain.handle(IpcChannels.setInbox, (_e, ids: string[], status: InboxStatus | undefined) => call("setInbox", ids, status));
  ipcMain.handle(IpcChannels.saveConfig, (_e, patch: ConfigPatch) => call("saveConfig", patch));
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] }) : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.restartRunner, async () => {
    await restartRunner();
    return (await overview()).runner;
  });
  ipcMain.handle(IpcChannels.revealHome, () => shell.openPath(paths.home));
  ipcMain.handle(IpcChannels.getAutostart, () => getAutostart());
  ipcMain.handle(IpcChannels.telegramView, () => telegramView(runnerStore));
  ipcMain.handle(IpcChannels.telegramSetToken, async (_e, token: string) => {
    await saveTelegramToken(runnerStore, String(token));
    await restartRunner();
    return telegramView(runnerStore);
  });
  ipcMain.handle(IpcChannels.telegramRemove, async () => {
    await removeTelegram(runnerStore);
    await restartRunner();
    return telegramView(runnerStore);
  });
  ipcMain.handle(IpcChannels.telegramPair, async () => {
    await createPairingCode(runnerStore);
    return telegramView(runnerStore);
  });
  ipcMain.handle(IpcChannels.telegramUnpair, async () => {
    await unpairTelegram(runnerStore);
    return telegramView(runnerStore);
  });
  ipcMain.handle(IpcChannels.telegramTest, () => sendTelegramTest(runnerStore));
  ipcMain.handle(IpcChannels.chatSend, (_e, text: string, answerTo?: string) => call("chatSend", String(text ?? ""), typeof answerTo === "string" ? answerTo : undefined));
  ipcMain.handle(IpcChannels.piReadiness, (_e, refresh: boolean) => readiness(refresh === true));
  ipcMain.handle(IpcChannels.installPiDesktop, () =>
    installPiDesktop(mainWindow, (received, total) => mainWindow?.webContents.send(IpcChannels.installProgress, received, total)),
  );
  ipcMain.handle(IpcChannels.openPiDesktop, () => openPiDesktop());
  ipcMain.handle(IpcChannels.setAutostart, (_e, enabled: boolean) => setAutostart(enabled === true));
  ipcMain.handle(IpcChannels.delegate, (_e, itemId: string) => call("delegate", String(itemId)));
  ipcMain.handle(IpcChannels.applyChange, (_e, itemId: string) => call("applyChange", String(itemId)));
  ipcMain.handle(IpcChannels.discardChange, (_e, itemId: string) => call("discardChange", String(itemId)));
  ipcMain.handle(IpcChannels.readSession, (_e, runId: string) => call("readSession", String(runId)));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: "Pi Desktop Mate",
    // Linux 설치본은 실행 파일에 아이콘이 없어 창에 직접 준다 (electron-builder.yml extraResources)
    ...(process.platform === "linux" && app.isPackaged ? { icon: join(process.resourcesPath, "icon.png") } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
    },
  });
  // 링크는 앱 안이 아니라 기본 브라우저로 연다
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // 개발 서버 주소는 설치본에서 쓰지 않는다 (Pi Desktop과 같은 이유)
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(here, "../renderer/index.html"));
}

if (isRunnerOnlyLaunch()) {
  // 로그인 때 띄운 실행: 창 없이 실행기만 확인하고 끝낸다 (실행기는 분리된 프로세스라 남는다)
  void app.whenReady().then(async () => {
    await ensureRunner();
    app.quit();
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes(RUNNER_ONLY_ARG)) return;
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    registerIpc();
    createWindow();
    // 창을 먼저 띄우고 실행기에 붙는다. 실행기는 앱을 닫아도 남는다 (연결기만 끝난다)
    startConnection();
    app.on("will-quit", () => connection?.dispose());
    // 자동 업데이트: 설치 직전에는 실행기를 멈춘다 (실행기가 Electron을 Node로 쓰는 경우 설치 파일을 잡고 있지 않게)
    const updater = new Updater(
      (state) => mainWindow?.webContents.send(IpcChannels.updateStateChanged, state),
      () => mainWindow,
      async () => {
        await runnerCommand(runnerScript(), "stop", runnerEnv());
      },
    );
    ipcMain.handle(IpcChannels.updateState, () => updater.current);
    ipcMain.handle(IpcChannels.checkForUpdates, (_e, interactive: boolean) => updater.check(interactive === true));
    ipcMain.handle(IpcChannels.confirmUpdate, () => updater.confirmUpdate());
    updater.start();
  });
  app.on("window-all-closed", () => app.quit());
}
