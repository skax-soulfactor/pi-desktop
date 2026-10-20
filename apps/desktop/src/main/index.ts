import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
import { HostManager, LOCAL_HOST_ID } from "./host-manager";

const here = fileURLToPath(new URL(".", import.meta.url));

/** 번들된 Host Agent 위치. 개발 중에는 워크스페이스의 빌드 결과를 쓴다. 패키징 경로는 M5에서 정한다. */
function agentScriptPath(): string {
  return process.env.PI_DESKTOP_AGENT_SCRIPT ?? resolve(app.getAppPath(), "../../packages/host-agent/dist/host-agent.mjs");
}

/** Agent 번들 옆의 package.json에서 버전을 읽는다 (원격 배포 파일 이름에 쓰임). */
function agentVersion(script: string): string {
  try {
    return String(JSON.parse(readFileSync(join(dirname(script), "..", "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

// 개발·E2E 검증용: 지정한 포트로 Chrome DevTools Protocol을 연다. 일반 실행에서는 열지 않는다.
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;
let hosts: HostManager | undefined;

/** 렌더러로 알림을 보낸다. 창이 닫혀 있으면 버린다 (다시 열면 저널에서 재생하므로 잃지 않음). */
function sendToRenderer(channel: string, ...payload: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...payload);
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

function registerIpc(manager: HostManager): void {
  const conn = (hostId: string) => manager.get(hostId);

  ipcMain.handle(IpcChannels.listHosts, () => manager.listHosts());
  ipcMain.handle(IpcChannels.connectHost, (_event, hostId: string) => conn(hostId).current);
  ipcMain.handle(IpcChannels.locatePi, (_event, hostId: string) =>
    conn(hostId).request<PiLocation>(Methods.piLocate, hostId === LOCAL_HOST_ID ? { piCliPath: process.env.PI_DESKTOP_PI_CLI } : {}),
  );
  ipcMain.handle(IpcChannels.listSessions, (_event, hostId: string) =>
    conn(hostId).request<SessionSummary[]>(Methods.sessionList),
  );
  ipcMain.handle(IpcChannels.openSession, async (_event, hostId: string, request: OpenSessionRequest) => {
    // 개발용 덮어쓰기 값은 Windows 경로라서 로컬 호스트에만 적용한다.
    const overrides = hostId === LOCAL_HOST_ID ? devSessionOverrides() : {};
    const params: SessionOpenParams = { ...overrides, cwd: request.cwd };
    const result = await conn(hostId).request<SessionOpenResult>(Methods.sessionOpen, params);
    return result.session;
  });
  ipcMain.handle(IpcChannels.attachSession, (_event, hostId: string, sessionId: string, lastSeq: number) =>
    conn(hostId).request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq }),
  );
  ipcMain.handle(IpcChannels.closeSession, (_event, hostId: string, sessionId: string) =>
    conn(hostId).request(Methods.sessionClose, { sessionId }),
  );
  ipcMain.handle(
    IpcChannels.sendCommand,
    (_event, hostId: string, sessionId: string, command: Record<string, unknown>) =>
      conn(hostId).request<PiResponse>(Methods.sessionSend, { sessionId, command }),
  );
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const options = { properties: ["openDirectory" as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
}

app.whenReady().then(() => {
  const script = agentScriptPath();
  hosts = new HostManager({
    agentScript: script,
    agentVersion: agentVersion(script),
    onState: (hostId, state) => sendToRenderer(IpcChannels.connectionChanged, hostId, state),
    onSessionEvent: (hostId, n) => sendToRenderer(IpcChannels.sessionEvent, hostId, n),
    onSessionExit: (hostId, n) => sendToRenderer(IpcChannels.sessionExit, hostId, n),
  });
  registerIpc(hosts);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 앱을 닫아도 각 호스트의 데몬과 Pi 세션은 계속 돈다. 연결기만 정리한다 (설계 §3.4).
app.on("will-quit", () => hosts?.dispose());
