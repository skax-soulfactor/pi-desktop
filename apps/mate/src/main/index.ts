import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import { loadWindowState, trackWindowState } from "@pi-desktop/window-state";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannels } from "../shared/api";
import { getAutostart, isRunnerOnlyLaunch, RUNNER_ONLY_ARG, setAutostart } from "./autostart";
import { installPiDesktop, openPiDesktop, piDesktopInfo } from "./pi-setup";
import { Updater } from "./updater";
import { createMateMain } from "./mate-main";

/**
 * 단독 Pi Desktop Mate 앱: 창·단일 실행·로그인 시작·자동 업데이트만 여기 있고, 실행기 연결·IPC·알림은 mate-main.ts가 맡는다.
 * Pi Desktop의 Mate 작업 공간도 mate-main.ts를 같은 방식으로 쓴다 (설계 DESIGN-ONE-APP.md).
 */
const here = fileURLToPath(new URL(".", import.meta.url));

// 개발 실행은 설치본과 userData(창 상태·단일 인스턴스 잠금)를 나눈다.
// 같으면 설치본이 켜져 있을 때 개발 실행이 잠금에 걸려 바로 끝나고, 설치본 창을 앞으로 불러낸다.
if (!app.isPackaged) app.setPath("userData", join(app.getPath("appData"), "Pi Desktop Mate (dev)"));

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;

/**
 * 창에 알린다. 앱을 닫는 중에는 창이 먼저 없어지고 연결 정리·업데이트 알림이 뒤에 올 수 있다.
 * 없어진 창에 보내면 "Object has been destroyed"로 main 프로세스 오류 창이 뜨므로 건너뛴다.
 */
function sendToWindow(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, ...args);
}

const mate = createMateMain({
  window: () => mainWindow,
  send: sendToWindow,
  isViewing: () => mainWindow?.isFocused() ?? false,
  reveal: () => {
    if (!mainWindow) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  },
  reload: () => mainWindow?.webContents.reload(),
  get userData() {
    return app.getPath("userData");
  },
  piDesktop: {
    info: () => piDesktopInfo(),
    open: () => openPiDesktop(),
    install: () => installPiDesktop(mainWindow, (received, total) => sendToWindow(IpcChannels.installProgress, received, total)),
  },
  autostart: { get: getAutostart, set: setAutostart },
});

function createWindow(): void {
  // 지난번 창 크기·위치·최대화를 되살린다 (화면 밖이면 위치는 버린다)
  const windowStateFile = join(app.getPath("userData"), "window-state.json");
  const windowState = loadWindowState(
    windowStateFile,
    { width: 1100, height: 760, minWidth: 720, minHeight: 480 },
    screen.getAllDisplays().map((d) => d.workArea),
  );
  mainWindow = new BrowserWindow({
    ...(windowState.x !== undefined && windowState.y !== undefined ? { x: windowState.x, y: windowState.y } : {}),
    width: windowState.width,
    height: windowState.height,
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
  if (windowState.maximized) mainWindow.maximize();
  trackWindowState(mainWindow, windowStateFile);
  mainWindow.on("closed", () => (mainWindow = undefined));
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
    await mate.ensureRunner();
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
    mate.start();
    createWindow();
    app.on("will-quit", () => mate.dispose());
    // 자동 업데이트: 설치 직전에는 실행기를 멈춘다 (실행기가 Electron을 Node로 쓰는 경우 설치 파일을 잡고 있지 않게)
    const updater = new Updater(
      (state) => sendToWindow(IpcChannels.updateStateChanged, state),
      () => mainWindow,
      () => mate.stopLocalRunner(),
    );
    ipcMain.handle(IpcChannels.updateState, () => updater.current);
    ipcMain.handle(IpcChannels.checkForUpdates, (_e, interactive: boolean) => updater.check(interactive === true));
    ipcMain.handle(IpcChannels.confirmUpdate, () => updater.confirmUpdate());
    updater.start();
  });
  app.on("window-all-closed", () => app.quit());
}
