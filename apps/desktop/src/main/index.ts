import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Methods,
  type PiLocation,
  type PiResponse,
  type SessionAttachResult,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionSummary,
} from "@pi-desktop/host-protocol";
import { IpcChannels, type OpenSessionRequest } from "../shared/api";
import { devSessionOverrides } from "./dev-overrides";
import { HostConnection } from "./host-connection";
import { resolveNodeRuntime } from "./node-runtime";

const here = fileURLToPath(new URL(".", import.meta.url));

/** 번들된 Host Agent 위치. 개발 중에는 워크스페이스의 빌드 결과를 쓴다. 패키징 경로는 M5에서 정한다. */
function agentScriptPath(): string {
  return process.env.PI_DESKTOP_AGENT_SCRIPT ?? resolve(app.getAppPath(), "../../packages/host-agent/dist/host-agent.mjs");
}

// 개발·E2E 검증용: 지정한 포트로 Chrome DevTools Protocol을 연다. 일반 실행에서는 열지 않는다.
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;
let connection: HostConnection | undefined;

/** 렌더러로 알림을 보낸다. 창이 닫혀 있으면 버린다 (다시 열면 저널에서 재생하므로 잃지 않음). */
function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: "Pi Desktop",
    backgroundColor: "#16171d",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(here, "../renderer/index.html"));
  }
}

function registerIpc(conn: HostConnection): void {
  ipcMain.handle(IpcChannels.getConnection, () => conn.current);
  ipcMain.handle(IpcChannels.locatePi, () =>
    conn.request<PiLocation>(Methods.piLocate, { piCliPath: process.env.PI_DESKTOP_PI_CLI }),
  );
  ipcMain.handle(IpcChannels.listSessions, () => conn.request<SessionSummary[]>(Methods.sessionList));
  ipcMain.handle(IpcChannels.openSession, async (_event, request: OpenSessionRequest) => {
    const params: SessionOpenParams = { ...devSessionOverrides(), cwd: request.cwd };
    const result = await conn.request<SessionOpenResult>(Methods.sessionOpen, params);
    return result.session;
  });
  ipcMain.handle(IpcChannels.attachSession, (_event, sessionId: string, lastSeq: number) =>
    conn.request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq }),
  );
  ipcMain.handle(IpcChannels.closeSession, (_event, sessionId: string) =>
    conn.request(Methods.sessionClose, { sessionId }),
  );
  ipcMain.handle(IpcChannels.sendCommand, (_event, sessionId: string, command: Record<string, unknown>) =>
    conn.request<PiResponse>(Methods.sessionSend, { sessionId, command }),
  );
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const options = { properties: ["openDirectory" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
}

app.whenReady().then(async () => {
  connection = new HostConnection({
    prepare: async () => {
      const runtime = await resolveNodeRuntime();
      return { command: runtime.command, args: [agentScriptPath(), "connect"], env: runtime.env };
    },
    onState: (state) => sendToRenderer(IpcChannels.connectionChanged, state),
    onSessionEvent: (n) => sendToRenderer(IpcChannels.sessionEvent, n),
    onSessionExit: (n) => sendToRenderer(IpcChannels.sessionExit, n),
  });
  registerIpc(connection);
  connection.start();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 앱을 닫아도 데몬과 Pi 세션은 계속 돈다. 연결기만 정리한다 (설계 §3.4).
app.on("will-quit", () => connection?.dispose());
