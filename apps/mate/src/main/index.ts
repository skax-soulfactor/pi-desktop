import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInbox } from "@pi-desktop/mate-kit";
import {
  addRequest,
  deleteDuty,
  dutyIdFrom,
  getDuty,
  isAlive,
  isDutyId,
  listDuties,
  listRuns,
  loadConfig,
  loadInboxState,
  loadState,
  mateHome,
  matePaths,
  nextRunAt,
  pendingRequests,
  readPid,
  saveConfig,
  saveDuty,
  setInboxStatus,
  type InboxStatus,
  type MateConfig,
} from "@pi-desktop/mate-runner";
import { IpcChannels, type DutyDraft, type Overview, type RunnerView } from "../shared/api";
import { runnerCommand } from "./runner-process";

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

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;
let runnerError: string | undefined;

async function ensureRunner(): Promise<void> {
  try {
    const result = await runnerCommand(runnerScript(), "start", runnerEnv());
    runnerError = result.status === "failed" ? "실행기를 띄우지 못했습니다. 로그를 확인하세요." : undefined;
  } catch (error) {
    runnerError = `실행기를 띄우지 못했습니다: ${(error as Error).message}`;
  }
}

async function runnerView(): Promise<RunnerView> {
  const [pid, state] = await Promise.all([readPid(paths), loadState(paths)]);
  const alive = isAlive(pid);
  return {
    alive,
    ...(alive && pid ? { pid } : {}),
    ...(state.heartbeatAt ? { heartbeatAt: state.heartbeatAt } : {}),
    ...(alive && state.current ? { current: state.current } : {}),
    today: state.today,
    ...(runnerError && !alive ? { error: runnerError } : {}),
  };
}

async function overview(): Promise<Overview> {
  const [config, duties, state, requests, items, inboxState, runs, runner] = await Promise.all([
    loadConfig(paths),
    listDuties(paths),
    loadState(paths),
    pendingRequests(paths),
    readInbox(paths.inbox),
    loadInboxState(paths),
    listRuns(paths, 100),
    runnerView(),
  ]);
  const now = Date.now();
  const names = new Map(duties.map((d) => [d.id, d.name]));
  const queued = new Set(requests.map((r) => r.dutyId));
  return {
    home: paths.home,
    config,
    duties: duties.map((duty) => {
      const last = state.duties[duty.id];
      const next = nextRunAt(duty, last?.lastRunAt, now);
      return {
        ...duty,
        ...(last?.lastRunAt ? { lastRunAt: last.lastRunAt } : {}),
        ...(last?.lastStatus ? { lastStatus: last.lastStatus } : {}),
        ...(next !== undefined ? { nextRunAt: next } : {}),
        queued: queued.has(duty.id),
      };
    }),
    inbox: items
      .map((item) => ({ ...item, ...(inboxState[item.id] ? { status: inboxState[item.id]!.status } : {}), dutyName: names.get(item.dutyId) ?? item.dutyId }))
      .sort((a, b) => b.createdAt - a.createdAt),
    runs,
    runner,
  };
}

async function saveDraft(draft: DutyDraft) {
  const now = Date.now();
  if (draft.id) {
    const existing = await getDuty(paths, draft.id);
    if (!existing) throw new Error("임무를 찾지 못했습니다");
    return saveDuty(paths, { ...existing, ...draft, id: existing.id, createdAt: existing.createdAt, updatedAt: now });
  }
  const id = dutyIdFrom(draft.name, (await listDuties(paths)).map((d) => d.id));
  return saveDuty(paths, { ...draft, id, createdAt: now });
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.overview, () => overview());
  ipcMain.handle(IpcChannels.saveDuty, (_e, draft: DutyDraft) => saveDraft(draft));
  ipcMain.handle(IpcChannels.deleteDuty, (_e, id: string) => deleteDuty(paths, id));
  ipcMain.handle(IpcChannels.runNow, async (_e, id: string) => {
    if (!isDutyId(id)) throw new Error("잘못된 임무 id입니다");
    await addRequest(paths, id);
    // 실행기가 꺼져 있으면 다시 띄운다 (요청 파일은 실행기가 뜨면 처리)
    if (!isAlive(await readPid(paths))) await ensureRunner();
  });
  ipcMain.handle(IpcChannels.setInbox, async (_e, ids: string[], status: InboxStatus | undefined) => {
    await setInboxStatus(paths, ids.filter((id) => typeof id === "string"), status);
  });
  ipcMain.handle(IpcChannels.saveConfig, (_e, patch: Partial<MateConfig>) => saveConfig(paths, patch));
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.restartRunner, async () => {
    await runnerCommand(runnerScript(), "stop", runnerEnv()).catch(() => undefined);
    await ensureRunner();
    return runnerView();
  });
  ipcMain.handle(IpcChannels.revealHome, () => shell.openPath(paths.home));
}

/** Mate 홈의 파일이 바뀌면 화면에 알린다 (실행기·확장이 쓰는 파일 포함). 잦은 변경은 묶는다 */
function watchHome(): FSWatcher | undefined {
  let timer: NodeJS.Timeout | undefined;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannels.changed);
    }, 200);
  };
  try {
    return watch(paths.home, { recursive: true }, (_event, name) => {
      // Pi 세션 파일·로그는 실행 중 계속 바뀌므로 화면 갱신에서 뺀다
      if (name && /^(sessions|run)[\\/]/.test(name)) return;
      notify();
    });
  } catch {
    return undefined;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: "Pi Desktop Mate",
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    await mkdir(paths.requests, { recursive: true });
    registerIpc();
    createWindow();
    const watcher = watchHome();
    app.on("will-quit", () => watcher?.close());
    // 창을 먼저 띄우고 실행기를 확인한다. 실행기는 앱을 닫아도 남는다.
    await ensureRunner();
    mainWindow?.webContents.send(IpcChannels.changed);
  });
  app.on("window-all-closed", () => app.quit());
}
