import { app, BrowserWindow, dialog, Menu, screen, shell } from "electron";
import { loadWindowState, trackWindowState } from "@pi-desktop/window-state";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannels } from "../shared/api";
import { readOnlySshHosts } from "@pi-desktop/host-deploy";
import { piWebSshHostsFile } from "@pi-desktop/web-shell/embed";
import { appMenuTemplate } from "./app-menu";
import { OWNER, REPO, Updater } from "@pi-desktop/web-shell/stubs/updater";
import { createAgentMain } from "./agent-main";

/**
 * 휴대폰 웹(pi-web agent)의 Agent 앱: src/server/index.ts가 web-shell의 "electron" 대체 위에서 불러온다.
 * 0.6.x 단독 Agent 앱의 시작 코드 그대로다 (창은 브라우저 화면, 메뉴는 ⋮ 메뉴, 업데이트는 pi-web update).
 * 0.7.0부터 Electron 단독 앱(index.ts)은 징검다리이고, Pi Desktop의 Agent 작업 공간이 agent-main.ts를 쓴다 (DESIGN-ONE-APP.md).
 */
const here = fileURLToPath(new URL(".", import.meta.url));

// 개발·E2E 검증용 Chrome DevTools Protocol. 설치본은 환경 변수로 열지 않는다 (Pi Desktop과 같은 이유).
if (process.env.PI_DESKTOP_REMOTE_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.PI_DESKTOP_REMOTE_DEBUG_PORT);
}

let mainWindow: BrowserWindow | undefined;

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

const agent = createAgentMain({
  window: () => mainWindow,
  send: sendToRenderer,
  isViewing: () => mainWindow?.isFocused() ?? false,
  reveal: (then) => {
    if (mainWindow) then?.();
    else {
      createWindow();
      // 새로 연 창은 화면이 뜬 뒤에 보낸다
      if (then) (mainWindow as BrowserWindow | undefined)?.webContents.once("did-finish-load", then);
    }
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  },
  reload: () => mainWindow?.webContents.reload(),
  get userData() {
    return app.getPath("userData");
  },
  // SSH 호스트는 Pi Web 목록을 함께 쓴다 (더하기·고치기는 Pi Web). Pi 관리 열기는 웹 서버가 Pi Web을 연다 (src/server/index.ts)
  sshHosts: readOnlySshHosts(piWebSshHostsFile()),
});

/** 창 아이콘. 개발 실행은 build/icon.png, Linux 설치본은 실행 파일에 아이콘이 없어 리소스의 것을 준다 (Pi Desktop과 같음) */
function windowIcon(): { icon?: string } {
  if (!app.isPackaged) return { icon: join(app.getAppPath(), "build", "icon.png") };
  return process.platform === "linux" ? { icon: join(process.resourcesPath, "icon.png") } : {};
}

function createWindow(): void {
  // 지난번 창 크기·위치·최대화를 되살린다 (화면 밖이면 위치는 버린다)
  const windowStateFile = join(app.getPath("userData"), "window-state.json");
  const windowState = loadWindowState(
    windowStateFile,
    { width: 1000, height: 760, minWidth: 640, minHeight: 480 },
    screen.getAllDisplays().map((d) => d.workArea),
  );
  mainWindow = new BrowserWindow({
    ...(windowState.x !== undefined && windowState.y !== undefined ? { x: windowState.x, y: windowState.y } : {}),
    width: windowState.width,
    height: windowState.height,
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
  if (windowState.maximized) mainWindow.maximize();
  trackWindowState(mainWindow, windowStateFile);

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

app.whenReady().then(() => {
  agent.start();

  // 업데이트는 웹 대체 (pi-web update로 묶음째 바꾼다). 메뉴의 "업데이트 확인"이 방법을 알린다
  const updater = new Updater();

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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 앱을 닫아도 데몬과 Pi 세션은 계속 돈다. 연결기만 정리한다 (DESIGN.md §3.4).
app.on("will-quit", () => agent.dispose());
