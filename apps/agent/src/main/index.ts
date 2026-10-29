import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from "electron";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Methods,
  type PiModelsResult,
  type PiResponse,
  type PiStatus,
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
import { forgetMemory, loadAutoLearn, loadMemories, memoryDir, saveAutoLearn, saveMemory } from "@pi-desktop/agent-kit/memory";
import { loadAudit, loadRules, removeRule } from "@pi-desktop/agent-kit/permissions";
import { agentBuildId } from "../vendor/main/agent-build";
import { devSessionOverrides } from "../vendor/main/dev-overrides";
import { HostConnection } from "../vendor/main/host-connection";
import { resolveNodeRuntime } from "../vendor/main/node-runtime";
import { ReplayCollector } from "../vendor/main/replay-collector";
import { IpcChannels, type AttachResult, type ChatSummary, type MemoryView, type RuleView } from "../shared/api";
import { findPiDesktop, installPiDesktop, openPiDesktop } from "./pi-desktop";
import type { PiSetupView } from "../shared/pi-setup";
import { TaskWatcher } from "./task-watcher";
import { appMenuTemplate } from "./app-menu";
import { OWNER, REPO, Updater } from "./updater";

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
 * API 키·프로바이더 로그인은 Pi Desktop이 Pi 설정(auth.json)에 두므로 여기서 따로 넘기지 않는다 (설계 DESIGN-AGENT.md §0).
 */
async function sessionParams(cwd: string, extraEnv: Record<string, string> = {}): Promise<SessionOpenParams> {
  const overrides = devSessionOverrides();
  const kitArgs = extensionArgs(await extensionEntries(kitDir()));
  const env = { ...overrides.env, ...extraEnv };
  return { ...overrides, cwd, piArgs: [...(overrides.piArgs ?? []), ...kitArgs], env };
}

/**
 * 예약을 돌리는 스케줄러 세션을 데몬에 하나 띄워 둔다 (설계 DESIGN-AGENT.md §4 "예약·주기 작업").
 * 데몬은 돌고 있는 세션이 있으면 꺼지지 않으므로, 앱을 닫아도 예약이 돈다. 이미 떠 있으면 아무것도 하지 않는다.
 */
async function ensureSchedulerSession(connection: HostConnection): Promise<void> {
  const cwd = schedulerDir();
  const sessions = await connection.request<SessionSummary[]>(Methods.sessionList);
  if (sessions.some((s) => s.cwd === cwd && s.state === "running")) return;
  await mkdir(cwd, { recursive: true });
  await connection.request<SessionOpenResult>(Methods.sessionOpen, await sessionParams(cwd, { PI_DESKTOP_AGENT_SCHEDULER: "1" }));
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

function registerIpc(connection: HostConnection): void {
  ipcMain.handle(IpcChannels.connectionState, () => connection.current);
  ipcMain.handle(IpcChannels.piSetup, async (): Promise<PiSetupView> => {
    // Pi 관리는 Pi Desktop이 맡는다. 여기서는 데몬이 아는 상태를 모아 안내만 한다 (설계 DESIGN-AGENT.md §0)
    const status = await connection.request<PiStatus>(Methods.piStatus);
    const models = status.pi ? await connection.request<PiModelsResult>(Methods.piModels, undefined, 60_000).catch((e: unknown) => ({ models: [], error: String(e) })) : { models: [] };
    return {
      ...(status.pi ? { piVersion: status.pi.version } : {}),
      ...(status.piError ? { piError: status.piError } : {}),
      node: { version: status.node.version, required: status.node.required, ok: status.node.ok },
      ...(status.gitBash ? { gitBash: { found: status.gitBash.found } } : {}),
      authProviders: status.data.authProviders,
      models: models.models,
      ...(models.error ? { modelsError: models.error } : {}),
      ...(findPiDesktop() ? { piDesktopPath: findPiDesktop() } : {}),
      platform: status.platform,
    };
  });
  ipcMain.handle(IpcChannels.openPiDesktop, () => openPiDesktop());
  ipcMain.handle(IpcChannels.installPiDesktop, async () => {
    const result = await installPiDesktop(mainWindow, (received, total) => mainWindow?.webContents.send(IpcChannels.installProgress, received, total));
    return { status: result.status };
  });
  // 기억·승인 규칙은 agent-kit의 같은 함수로 같은 파일을 읽고 고친다 (사람이 직접 고쳐도 되는 파일)
  ipcMain.handle(IpcChannels.listMemories, async () => (await loadMemories(memoryDir(agentDataDir()))).reverse());
  ipcMain.handle(IpcChannels.addMemory, async (_event, kind: MemoryView["kind"], text: string) => {
    if (!text.trim()) throw new Error("기억할 내용이 비어 있습니다");
    await saveMemory(memoryDir(agentDataDir()), kind, text);
  });
  ipcMain.handle(IpcChannels.getAutoLearn, () => loadAutoLearn(memoryDir(agentDataDir())));
  ipcMain.handle(IpcChannels.setAutoLearn, (_event, on: boolean) => saveAutoLearn(memoryDir(agentDataDir()), on === true));
  ipcMain.handle(IpcChannels.forgetMemory, async (_event, id: string) => {
    await forgetMemory(memoryDir(agentDataDir()), id);
  });
  ipcMain.handle(IpcChannels.listRules, () => loadRules(agentDataDir()));
  ipcMain.handle(IpcChannels.removeRule, (_event, rule: RuleView) => removeRule(agentDataDir(), rule));
  ipcMain.handle(IpcChannels.listAudit, () => loadAudit(agentDataDir(), 100));
  ipcMain.handle(IpcChannels.listSessions, async (): Promise<ChatSummary[]> => {
    const sessions = await connection.request<SessionSummary[]>(Methods.sessionList);
    const chats = sessions.filter((s) => s.state === "running" && s.cwd !== schedulerDir()).sort((a, b) => b.startedAt - a.startedAt);
    // 이름은 Pi 세션 파일에 있다 (set_session_name). 이름을 못 읽어도 목록은 보인다
    return Promise.all(
      chats.map(async (s): Promise<ChatSummary> => {
        try {
          const state = await connection.request<PiResponse>(Methods.sessionSend, { sessionId: s.sessionId, command: { type: "get_state" } }, 3000);
          const name = (state.data as { sessionName?: string } | undefined)?.sessionName;
          return name ? { ...s, name } : s;
        } catch {
          return s;
        }
      }),
    );
  });
  ipcMain.handle(IpcChannels.closeSession, async (_event, sessionId: string) => {
    await connection.request(Methods.sessionClose, { sessionId });
  });
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
  ipcMain.handle(IpcChannels.listTasks, async () => (await loadTasks(tasksDir(agentDataDir()))).slice(0, 30));
  ipcMain.handle(IpcChannels.listSchedules, () => loadSchedules(schedulesPath(agentDataDir())));
  ipcMain.handle(IpcChannels.setScheduleEnabled, async (_event, id: string, enabled: boolean) => {
    await updateSchedules(schedulesPath(agentDataDir()), (all) => all.map((s) => (s.id === id ? { ...s, enabled } : s)));
  });
  ipcMain.handle(IpcChannels.removeSchedule, async (_event, id: string) => {
    await updateSchedules(schedulesPath(agentDataDir()), (all) => all.filter((s) => s.id !== id));
  });
  ipcMain.handle(IpcChannels.openSession, async (_event, cwd: string, forkFrom?: string) => {
    // forkFrom: 다른 폴더로 대화를 옮길 때 지금 세션 파일에서 분기한다 (pi --fork, 원래 세션 파일은 그대로)
    const params = await sessionParams(cwd);
    const result = await connection.request<SessionOpenResult>(Methods.sessionOpen, forkFrom ? { ...params, forkFrom } : params);
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

/** 창 아이콘. 개발 실행은 build/icon.png, Linux 설치본은 실행 파일에 아이콘이 없어 리소스의 것을 준다 (Pi Desktop과 같음) */
function windowIcon(): { icon?: string } {
  if (!app.isPackaged) return { icon: join(app.getAppPath(), "build", "icon.png") };
  return process.platform === "linux" ? { icon: join(process.resourcesPath, "icon.png") } : {};
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    title: "Pi Desktop Agent",
    backgroundColor: "#16171d",
    ...windowIcon(),
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
  const created = createConnection(() => {
    // 실패해도 대화는 쓸 수 있어야 한다. 다음에 다시 붙을 때 다시 시도한다
    ensureSchedulerSession(created).catch((error: unknown) => console.error("스케줄러 세션을 띄우지 못했다:", error));
  });
  connection = created;
  registerIpc(connection);

  // 자동 업데이트 (Pi Desktop Mate와 같은 방식: 가장 높은 agent-v* 릴리스를 generic으로)
  const updater = new Updater((state) => sendToRenderer(IpcChannels.updateStateChanged, state), () => mainWindow);
  ipcMain.handle(IpcChannels.updateState, () => updater.current);
  ipcMain.handle(IpcChannels.checkForUpdates, (_event, interactive?: boolean) => updater.check(interactive === true));
  ipcMain.handle(IpcChannels.confirmUpdate, () => updater.confirmUpdate());
  updater.start();

  // 기능 화면은 사이드바가 아니라 메뉴바에서 연다 (app-menu.ts)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      appMenuTemplate(process.platform, app.isPackaged, {
        command: (id) => sendToRenderer(IpcChannels.menuCommand, id),
        checkForUpdates: () => void updater.check(true),
        openReleases: () => void shell.openExternal(`https://github.com/${OWNER}/${REPO}/releases`),
        about: () =>
          void dialog.showMessageBox({
            type: "info",
            title: "Pi Desktop Agent 정보",
            message: `Pi Desktop Agent ${app.getVersion()}`,
            detail: `Pi를 엔진으로 쓰는 데스크톱 에이전트 (기능은 agent-kit)\nElectron ${process.versions.electron} · Node ${process.versions.node}\nhttps://github.com/${OWNER}/${REPO}`,
          }),
      }),
    ),
  );
  // Windows 작업 표시줄·알림의 앱 식별자. 설치 프로그램이 만든 바로 가기는 electron-builder의 appId를 쓰므로
  // 같은 값이어야 한다. 다르면 실행 중인 창이 다른 앱으로 묶여 기본 Electron 아이콘이 보인다.
  app.setAppUserModelId("dev.pi-desktop.agent");
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
