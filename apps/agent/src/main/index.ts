import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFile } from "node:fs/promises";
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
} from "@pi-desktop/host-protocol";
import { extensionArgs, extensionEntries } from "@pi-desktop/agent-kit";
import { agentBuildId } from "@desktop/main/agent-build";
import { devSessionOverrides } from "@desktop/main/dev-overrides";
import { HostConnection } from "@desktop/main/host-connection";
import { resolveNodeRuntime } from "@desktop/main/node-runtime";
import { ReplayCollector } from "@desktop/main/replay-collector";
import { IpcChannels, type AttachResult } from "../shared/api";

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

let mainWindow: BrowserWindow | undefined;
const replays = new ReplayCollector<SessionEventNotification>();

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createConnection(): HostConnection {
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
    onState: (state) => sendToRenderer(IpcChannels.connectionChanged, state),
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
  ipcMain.handle(IpcChannels.defaultCwd, () => homedir());
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const options = { properties: ["openDirectory" as const, "createDirectory" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.openSession, async (_event, cwd: string) => {
    // 개발용 덮어쓰기(저장소의 Pi, 격리된 Pi 설정, mock 프로바이더)를 먼저 깔고 agent-kit 확장을 뒤에 붙인다.
    const overrides = devSessionOverrides();
    const kitArgs = extensionArgs(await extensionEntries(kitDir()));
    const params: SessionOpenParams = { ...overrides, cwd, piArgs: [...(overrides.piArgs ?? []), ...kitArgs] };
    const result = await connection.request<SessionOpenResult>(Methods.sessionOpen, params);
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
  connection = createConnection();
  registerIpc(connection);
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
