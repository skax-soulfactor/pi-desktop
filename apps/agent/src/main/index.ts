import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell } from "electron";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Methods,
  type PiResponse,
  type SessionAttachResult,
  type SessionEventNotification,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionSummary,
} from "@pi-desktop/host-protocol";
import { extensionArgs, extensionEntries } from "@pi-desktop/agent-kit";
import { loadTasks, tasksDir } from "@pi-desktop/agent-kit/tasks";
import { loadSchedules, schedulesPath, updateSchedules } from "@pi-desktop/agent-kit/schedules";
import type { TaskRecord } from "@pi-desktop/agent-kit/task-types";
import { agentBuildId } from "../vendor/main/agent-build";
import { devSessionOverrides } from "../vendor/main/dev-overrides";
import { HostConnection } from "../vendor/main/host-connection";
import { resolveNodeRuntime } from "../vendor/main/node-runtime";
import { ReplayCollector } from "../vendor/main/replay-collector";
import { IpcChannels, type AttachResult } from "../shared/api";
import { KeyStore } from "./key-store";
import { TaskWatcher } from "./task-watcher";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * 에이전트 앱이 쓰는 Host Agent 데몬 홈 (설계 DESIGN-AGENT.md §2.2).
 * Pi Desktop의 `~/.pi-desktop`과 나눠, 따로 배포된 두 앱이 서로의 데몬을 교체하지 않게 한다.
 * Pi 설정과 세션(`~/.pi/agent`)은 나누지 않는다.
 */
function daemonHome(): string {
  return process.env.PI_DESKTOP_HOME || join(homedir(), ".pi-desktop-agent");
}

/** 번들된 Host Agent 위치. 설치본은 앱 리소스, 개발 중에는 워크스페이스의 빌드 결과 */
function agentScriptPath(): string {
  if (process.env.PI_DESKTOP_AGENT_SCRIPT) return process.env.PI_DESKTOP_AGENT_SCRIPT;
  if (app.isPackaged) return join(process.resourcesPath, "host-agent", "host-agent.mjs");
  return resolve(app.getAppPath(), "../../packages/host-agent/dist/host-agent.mjs");
}

/** agent-kit 폴더. 확장은 대상 호스트(지금은 로컬)의 Pi가 이 경로에서 불러온다 */
function kitDir(): string {
  if (process.env.PI_DESKTOP_AGENT_KIT) return process.env.PI_DESKTOP_AGENT_KIT;
  if (app.isPackaged) return join(process.resourcesPath, "agent-kit");
  return resolve(app.getAppPath(), "../../packages/agent-kit");
}

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

/**
 * agent-kit 상태 폴더 (agent-kit permissions/store.ts의 dataDir와 같은 규칙). 지금은 로컬 호스트만 다루므로 앱이 직접 읽는다.
 */
function agentDataDir(): string {
  if (process.env.PI_DESKTOP_AGENT_DATA) return process.env.PI_DESKTOP_AGENT_DATA;
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pi-desktop-agent");
}

/** 끝난 작업을 OS 알림으로 알린다. 창을 보고 있으면 목록이 바뀌는 것으로 충분하다 */
function notifyTask(task: TaskRecord): void {
  if (!Notification.isSupported() || mainWindow?.isFocused()) return;
  const status = task.status === "done" ? "완료" : task.status === "failed" ? "실패" : "취소됨";
  const origin = task.origin === "schedule" ? "예약" : "작업";
  const body = (task.status === "failed" ? task.error : task.result)?.slice(0, 200) ?? "";
  new Notification({ title: `${origin} ${status}: ${task.title}`, body }).show();
}

/** 데몬에 상주시키는 스케줄러 세션의 작업 폴더. 이 폴더로 연 세션이 있으면 이미 떠 있는 것으로 본다 */
function schedulerDir(): string {
  return join(daemonHome(), "scheduler");
}

/**
 * 세션 열기 파라미터. 개발용 덮어쓰기(저장소의 Pi, 격리된 Pi 설정, mock 프로바이더)를 먼저 깔고 agent-kit 확장을 뒤에 붙인다.
 * 키체인에 둔 API 키는 이 세션의 Pi 프로세스 환경으로만 넘긴다 (설계 DESIGN-AGENT.md §3).
 */
async function sessionParams(cwd: string, keys: KeyStore, extraEnv: Record<string, string> = {}): Promise<SessionOpenParams> {
  const overrides = devSessionOverrides();
  const kitArgs = extensionArgs(await extensionEntries(kitDir()));
  const env = { ...overrides.env, ...keys.env(), ...extraEnv };
  return { ...overrides, cwd, piArgs: [...(overrides.piArgs ?? []), ...kitArgs], env };
}

/**
 * 예약을 돌리는 스케줄러 세션을 데몬에 하나 띄워 둔다 (설계 DESIGN-AGENT.md §4 "예약·주기 작업").
 * 데몬은 돌고 있는 세션이 있으면 꺼지지 않으므로, 앱을 닫아도 예약이 돈다. 이미 떠 있으면 아무것도 하지 않는다.
 */
async function ensureSchedulerSession(connection: HostConnection, keys: KeyStore): Promise<void> {
  const cwd = schedulerDir();
  const sessions = await connection.request<SessionSummary[]>(Methods.sessionList);
  if (sessions.some((s) => s.cwd === cwd && s.state === "running")) return;
  await mkdir(cwd, { recursive: true });
  await connection.request<SessionOpenResult>(Methods.sessionOpen, await sessionParams(cwd, keys, { PI_DESKTOP_AGENT_SCHEDULER: "1" }));
}

let mainWindow: BrowserWindow | undefined;
const replays = new ReplayCollector<SessionEventNotification>();

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createConnection(onConnected: () => void): HostConnection {
  const script = agentScriptPath();
  const ignore = () => {};
  return new HostConnection({
    prepare: async () => {
      const runtime = await resolveNodeRuntime();
      // 연결할 때마다 번들을 해시한다. 개발 중 다시 빌드하면 예전 데몬을 바꾸도록 (Pi Desktop과 같음).
      const agentBuild = agentBuildId(await readFile(script));
      return {
        command: runtime.command,
        args: [script, "connect"],
        env: { ...runtime.env, PI_DESKTOP_HOME: daemonHome() },
        agentBuild,
      };
    },
    onState: (state) => {
      sendToRenderer(IpcChannels.connectionChanged, state);
      if (state.status === "connected") onConnected();
    },
    onSessionEvent: (n) => {
      replays.capture(n.sessionId, n);
      sendToRenderer(IpcChannels.sessionEvent, n);
    },
    onSessionExit: (n) => sendToRenderer(IpcChannels.sessionExit, n),
    onUiResolved: (n) => sendToRenderer(IpcChannels.uiResolved, n),
    // 아래는 Pi Desktop 전용 기능(팔로우·여러 앱 입력 권한·Playground 등)이라 P0에서는 쓰지 않는다.
    onStoredChanged: ignore,
    onExternalWrite: ignore,
    onWriterChanged: ignore,
    onFilesChanged: ignore,
    onPlaygroundOutput: ignore,
    onPiUpdateOutput: ignore,
  });
}

function registerIpc(connection: HostConnection, keys: KeyStore): void {
  ipcMain.handle(IpcChannels.connectionState, () => connection.current);
  ipcMain.handle(IpcChannels.defaultCwd, () => homedir());
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const options = { properties: ["openDirectory" as const, "createDirectory" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.pickFiles, async () => {
    const options = { properties: ["openFile" as const, "multiSelections" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IpcChannels.listKeys, () => keys.names());
  ipcMain.handle(IpcChannels.setKey, (_event, name: string, value: string) => keys.set(name, value));
  ipcMain.handle(IpcChannels.removeKey, (_event, name: string) => keys.remove(name));
  ipcMain.handle(IpcChannels.listTasks, async () => (await loadTasks(tasksDir(agentDataDir()))).slice(0, 30));
  ipcMain.handle(IpcChannels.listSchedules, () => loadSchedules(schedulesPath(agentDataDir())));
  ipcMain.handle(IpcChannels.setScheduleEnabled, async (_event, id: string, enabled: boolean) => {
    await updateSchedules(schedulesPath(agentDataDir()), (all) => all.map((s) => (s.id === id ? { ...s, enabled } : s)));
  });
  ipcMain.handle(IpcChannels.removeSchedule, async (_event, id: string) => {
    await updateSchedules(schedulesPath(agentDataDir()), (all) => all.filter((s) => s.id !== id));
  });
  ipcMain.handle(IpcChannels.openSession, async (_event, cwd: string) => {
    const result = await connection.request<SessionOpenResult>(Methods.sessionOpen, await sessionParams(cwd, keys));
    return result.session;
  });
  ipcMain.handle(IpcChannels.attachSession, async (_event, sessionId: string, lastSeq: number) => {
    // attach 도중 알림으로 온 이벤트도 결과에 담는다. 렌더러는 순번으로 중복을 거른다 (replay-collector.ts).
    const events = replays.begin(sessionId);
    try {
      const result = await connection.request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq });
      const reply: AttachResult = { ...result, events };
      return reply;
    } finally {
      replays.end(sessionId, events);
    }
  });
  ipcMain.handle(IpcChannels.sendCommand, (_event, sessionId: string, command: Record<string, unknown>) =>
    connection.request<PiResponse>(Methods.sessionSend, { sessionId, command }),
  );
  ipcMain.handle(IpcChannels.sendRecord, async (_event, sessionId: string, record: Record<string, unknown>) => {
    await connection.request(Methods.sessionSend, { sessionId, command: record, noResponse: true });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    title: "Pi Desktop Agent",
    backgroundColor: "#16171d",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 응답 속 링크가 앱 창을 다른 페이지로 바꾸지 않게 한다. http(s) 링크만 외부 브라우저로 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  // 개발 서버 주소는 개발 실행에서만 쓴다 (설치본이 환경 변수의 주소를 열면 그 페이지가 preload API를 갖게 된다).
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(here, "../renderer/index.html"));
  }
}

let connection: HostConnection | undefined;

app.whenReady().then(() => {
  const keys = new KeyStore(join(app.getPath("userData"), "keys.json"), safeStorage);
  const created = createConnection(() => {
    // 실패해도 대화는 쓸 수 있어야 한다. 다음에 다시 붙을 때 다시 시도한다
    ensureSchedulerSession(created, keys).catch((error: unknown) => console.error("스케줄러 세션을 띄우지 못했다:", error));
  });
  connection = created;
  registerIpc(connection, keys);
  // Windows 알림에 앱 이름이 보이게 한다
  app.setAppUserModelId("Pi Desktop Agent");
  new TaskWatcher(
    () => loadTasks(tasksDir(agentDataDir())),
    notifyTask,
    () => sendToRenderer(IpcChannels.tasksChanged, null),
  ).start();
  createWindow();
  connection.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 앱을 닫아도 데몬과 Pi 세션은 계속 돈다. 연결기만 정리한다 (DESIGN.md §3.4).
app.on("will-quit", () => connection?.dispose());
