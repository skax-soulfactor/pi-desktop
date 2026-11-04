import { app, ipcMain, type BrowserWindow, type WebFrameMain } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { IpcChannels, type PluginWorkspaceId, type WorkspaceId, type WorkspacesState } from "../shared/api";
import { createAgentMain, type AgentMain, type SshHostList } from "../../../agent/src/main/agent-main";
import { IpcChannels as AgentChannels } from "../../../agent/src/shared/api";
import { createMateMain, type MateMain } from "../../../mate/src/main/mate-main";
import { IpcChannels as MateChannels } from "../../../mate/src/shared/api";
import { getAutostart, setAutostart } from "../../../mate/src/main/autostart";

/** 징검다리 Mate 0.7.0이 남기는 표시: 옛 Mate에서 "로그인할 때 실행기 시작"이 켜져 있었다 (Pi Desktop이 이어받는다) */
export const MATE_AUTOSTART_WISH = "mate-autostart-wanted";

/**
 * 작업 공간 (설계 DESIGN-ONE-APP.md). Pi Desktop 화면("pi") 옆에 내장 플러그인(Agent·Mate)을 작업 공간으로 띄운다.
 * 0.7.0부터 기본으로 켜져 있다. 끈 것만 userData/workspaces.json에 적는다.
 *
 * - 화면: 플러그인 화면(빌드된 Agent 화면, out/renderer/agent/)을 Pi Desktop 창 안의 iframe으로 연다.
 *   CSS·화면 코드가 섞이지 않고, 한 작업 공간이 멈춰도 다른 화면은 그대로다.
 * - preload: 창의 preload가 모든 프레임에서 돌고(nodeIntegrationInSubFrames), Agent 프레임에서는 window.piAgent,
 *   Mate 프레임에서는 window.mate를 만든다.
 * - main: Agent 본체(createAgentMain)·Mate 본체(createMateMain)를 이 창에 맞춘 컨텍스트로 띄운다.
 *   IPC 채널은 "agent:"·"mate:"라 Pi Desktop의 "pi:"와 부딪히지 않는다. main이 플러그인 화면에 보내는 것은 그 프레임으로만 간다.
 */

const PLUGINS: Array<{ id: PluginWorkspaceId; name: string }> = [
  { id: "agent", name: "Agent" },
  { id: "mate", name: "Mate" },
];

interface Settings {
  enabled: Partial<Record<PluginWorkspaceId, boolean>>;
}

export interface WorkspaceHost {
  window(): BrowserWindow | undefined;
  /** Pi Desktop 화면(메인 프레임)에 보낸다 */
  sendToShell(channel: string, ...args: unknown[]): void;
  /** 이 플러그인 화면의 파일 (설치본·개발 빌드 모두 out/renderer/<id>/index.html) */
  rendererFile(id: PluginWorkspaceId): string;
  /** 메뉴바를 지금 작업 공간에 맞춘다 */
  onActiveChanged(id: WorkspaceId): void;
  /** Pi Desktop의 SSH 호스트 목록 (Agent·Mate 작업 공간이 함께 쓴다) */
  sshHosts(): SshHostList | undefined;
  /** Pi 관리를 연다 (Agent 화면의 "Pi Desktop에서 관리") */
  openPiManager(): void;
}

export class Workspaces {
  private readonly file: string;
  private active: WorkspaceId = "pi";
  private agent: AgentMain | undefined;
  private agentStarted = false;
  private mate: MateMain | undefined;
  private mateStarted = false;
  private readyWaiters: Partial<Record<PluginWorkspaceId, Array<() => void>>> = {};
  private readySet: Partial<Record<PluginWorkspaceId, boolean>> = {};
  /** 새 창으로 연 작업 공간 (D4). 창 안의 iframe과 함께 쓴다 */
  private readonly detached = new Map<PluginWorkspaceId, BrowserWindow>();
  /** 작업 공간을 보지 않는 동안 생긴 알림 수 (막대에 보인다) */
  private unread: Partial<Record<PluginWorkspaceId, number>> = {};

  constructor(private readonly host: WorkspaceHost) {
    this.file = join(app.getPath("userData"), "workspaces.json");
  }

  get current(): WorkspaceId {
    return this.active;
  }

  private settings(): Settings {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Settings>;
      return { enabled: parsed.enabled ?? {} };
    } catch {
      return { enabled: {} };
    }
  }

  /** 켜져 있는가 (적지 않았으면 켜짐) */
  enabled(id: PluginWorkspaceId): boolean {
    return this.settings().enabled[id] !== false;
  }

  state(): WorkspacesState {
    const settings = this.settings();
    return {
      plugins: PLUGINS.map((p) => {
        const enabled = settings.enabled[p.id] !== false;
        const file = this.host.rendererFile(p.id);
        // 개발 서버(http)로 띄운 창은 file:// 프레임을 열 수 없다. 빌드한 화면으로 실행해야 한다
        const reason = process.env.ELECTRON_RENDERER_URL && !app.isPackaged ? "개발 서버 실행에서는 열 수 없습니다 (빌드한 뒤 실행하세요)" : !existsSync(file) ? `화면 파일이 없습니다: ${file}` : undefined;
        const unread = this.unread[p.id] ?? 0;
        return { id: p.id, name: p.name, enabled, ...(unread > 0 ? { unread } : {}), ...(reason ? { reason } : { url: pathToFileURL(file).href }) };
      }),
    };
  }

  /** 켜 둔 플러그인의 백그라운드를 시작한다 (앱 시작 때) */
  start(): void {
    if (this.enabled("agent")) this.startAgent();
    if (this.enabled("mate")) this.startMate();
    void this.takeMateAutostartWish();
  }

  /** 로그인할 때 띄운 실행(--mate-runner-only): 창 없이 Mate 실행기만 확인한다 */
  async loginLaunch(): Promise<void> {
    await this.takeMateAutostartWish();
    if (this.enabled("mate")) await this.mateMain().ensureRunner();
  }

  /** 옛 Mate에서 켜 두었던 "로그인할 때 실행기 시작"을 Pi Desktop 로그인 항목으로 이어받는다 */
  private async takeMateAutostartWish(): Promise<void> {
    const wish = join(app.getPath("userData"), MATE_AUTOSTART_WISH);
    if (!existsSync(wish)) return;
    try {
      if (this.enabled("mate")) await setAutostart(true);
      rmSync(wish, { force: true });
    } catch {
      // 다음 실행에 다시 한다
    }
  }

  setEnabled(id: PluginWorkspaceId, on: boolean): WorkspacesState {
    const settings = this.settings();
    settings.enabled[id] = on;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    if (id === "agent") {
      if (on) this.startAgent();
      else this.stopAgent();
    }
    if (id === "mate") {
      if (on) this.startMate();
      else {
        this.stopMate();
        // Mate를 끄면 로그인할 때 실행기를 띄우지 않는다
        if (getAutostart().enabled) void setAutostart(false).catch(() => undefined);
      }
    }
    if (!on && this.active === id) this.show("pi");
    return this.state();
  }

  /** 화면이 작업 공간을 바꿨다 */
  shown(id: WorkspaceId): void {
    this.active = id;
    this.host.onActiveChanged(id);
    if (id !== "pi" && this.unread[id]) {
      this.unread[id] = 0;
      this.host.sendToShell(IpcChannels.workspacesChanged);
    }
  }

  /** 플러그인이 알림을 띄웠다: 그 작업 공간을 보고 있지 않으면 막대에 수를 올린다 (셸의 알림 모음) */
  /** 새 창으로 연 작업 공간 창 (없거나 닫혔으면 undefined) */
  windowOf(id: PluginWorkspaceId): BrowserWindow | undefined {
    const win = this.detached.get(id);
    return win && !win.isDestroyed() ? win : undefined;
  }

  /** 새 창을 이 작업 공간의 창으로 둔다 (main/index.ts가 만들어 넘긴다) */
  attachWindow(id: PluginWorkspaceId, win: BrowserWindow): void {
    this.detached.set(id, win);
    win.on("closed", () => {
      if (this.detached.get(id) === win) this.detached.delete(id);
    });
  }

  /** 사용자가 이 작업 공간을 지금 보고 있는가 (창 안에서든, 새 창에서든) */
  private viewing(id: PluginWorkspaceId): boolean {
    return (Boolean(this.host.window()?.isFocused()) && this.active === id) || Boolean(this.windowOf(id)?.isFocused());
  }

  private notified(id: PluginWorkspaceId): void {
    if (this.viewing(id)) return;
    this.unread[id] = (this.unread[id] ?? 0) + 1;
    this.host.sendToShell(IpcChannels.workspacesChanged);
  }

  /** main에서 작업 공간을 보이게 한다 (알림을 누름·메뉴바) */
  show(id: WorkspaceId): void {
    this.host.sendToShell(IpcChannels.showWorkspace, id);
    this.shown(id);
  }

  ready(id: PluginWorkspaceId): void {
    this.readySet[id] = true;
    const waiters = this.readyWaiters[id] ?? [];
    this.readyWaiters[id] = [];
    for (const waiter of waiters) waiter();
  }

  /** Agent 화면에 메뉴 명령을 보낸다 (Agent 작업 공간을 보는 동안의 메뉴바) */
  /** win을 주면 그 창(새 창으로 연 작업 공간)에만 보낸다 */
  agentMenuCommand(id: string, win?: BrowserWindow): void {
    if (win) for (const frame of this.frames("agent", win)) frame.send(AgentChannels.menuCommand, id);
    else this.sendTo("agent", AgentChannels.menuCommand, id);
  }

  /** 그 작업 공간 화면의 프레임: Pi Desktop 창 안의 iframe과 새 창 (only를 주면 그 창 것만) */
  private frames(id: PluginWorkspaceId, only?: BrowserWindow): WebFrameMain[] {
    const url = pathToFileURL(this.host.rendererFile(id)).href;
    const windows = only ? [only] : [this.host.window(), this.windowOf(id)];
    const frames: WebFrameMain[] = [];
    for (const win of windows) {
      if (!win || win.isDestroyed()) continue;
      for (const frame of win.webContents.mainFrame.framesInSubtree) if (frame.url.split("#")[0] === url) frames.push(frame);
    }
    return frames;
  }

  private sendTo(id: PluginWorkspaceId, channel: string, ...args: unknown[]): void {
    for (const frame of this.frames(id)) {
      try {
        frame.send(channel, ...args);
      } catch {
        // 프레임이 막 사라졌다
      }
    }
  }

  /** 창을 앞으로 가져와 그 작업 공간을 보이고, then은 화면이 뜬 뒤에 부른다 (알림을 누름) */
  reveal(id: WorkspaceId, then?: () => void): void {
    // 새 창으로 연 작업 공간이면 그 창을 앞으로
    const own = id === "pi" ? undefined : this.windowOf(id);
    if (own) {
      if (own.isMinimized()) own.restore();
      own.show();
      own.focus();
      if (!then) return;
      if (own.webContents.isLoading()) own.webContents.once("did-finish-load", then);
      else then();
      return;
    }
    const win = this.host.window();
    if (win?.isMinimized()) win.restore();
    win?.show();
    win?.focus();
    this.show(id);
    if (!then) return;
    if (id === "pi" || (this.readySet[id] && this.frames(id).length > 0)) then();
    else (this.readyWaiters[id] ??= []).push(then);
  }

  private reload(id: PluginWorkspaceId): void {
    this.readySet[id] = false;
    for (const frame of this.frames(id)) frame.reload();
  }

  private startAgent(): void {
    if (this.agentStarted) return;
    this.agent ??= createAgentMain({
      window: () => this.host.window(),
      send: (channel, ...args) => this.sendTo("agent", channel, ...args),
      isViewing: () => this.viewing("agent"),
      onNotify: () => this.notified("agent"),
      reveal: (then) => this.reveal("agent", then),
      reload: () => this.reload("agent"),
      // Agent 상태 파일(지금 호스트·SSH 호스트·앱 수치)은 Pi Desktop 데이터 폴더 안의 agent/에 둔다 (단독 Agent 앱과 섞지 않는다)
      userData: join(app.getPath("userData"), "agent"),
      sshHosts: this.host.sshHosts(),
      piDesktop: {
        // 이 앱이 Pi Desktop이다: "설치하세요" 대신 Pi 관리를 연다
        path: () => process.execPath,
        open: () => this.host.openPiManager(),
        install: async () => {
          this.host.openPiManager();
          return { status: "opened" };
        },
      },
    });
    this.agent.start();
    this.agentStarted = true;
  }

  private stopAgent(): void {
    this.windowOf("agent")?.close();
    if (!this.agentStarted) return;
    this.agent?.dispose();
    this.agentStarted = false;
    this.readySet.agent = false;
  }

  private startMate(): void {
    if (this.mateStarted) return;
    this.mateMain().start();
    this.mateStarted = true;
  }

  private mateMain(): MateMain {
    this.mate ??= createMateMain({
      window: () => this.host.window(),
      send: (channel, ...args) => this.sendTo("mate", channel, ...args),
      isViewing: () => this.viewing("mate"),
      onNotify: () => this.notified("mate"),
      reveal: (then) => this.reveal("mate", then),
      reload: () => this.reload("mate"),
      // Mate 상태 파일(지금 호스트·SSH 호스트·앱 수치)은 Pi Desktop 데이터 폴더 안의 mate/에 둔다. Mate 홈(~/.pi-desktop-mate)과 실행기는 단독 Mate 앱과 같다
      userData: join(app.getPath("userData"), "mate"),
      sshHosts: this.host.sshHosts(),
      piDesktop: {
        // 이 앱이 Pi Desktop이다
        info: async () => ({ installedPath: process.execPath }),
        open: () => this.host.openPiManager(),
        install: async () => {
          this.host.openPiManager();
          return { status: "opened" };
        },
      },
      // 로그인할 때 실행기 시작: Pi Desktop을 --mate-runner-only로 띄워 창 없이 실행기만 확인한다 (main/index.ts)
      autostart: { get: getAutostart, set: setAutostart },
    });
    return this.mate;
  }

  private stopMate(): void {
    this.windowOf("mate")?.close();
    if (!this.mateStarted) return;
    this.mate?.dispose();
    this.mateStarted = false;
    this.readySet.mate = false;
  }

  /** 업데이트 설치 직전: 이 PC의 Mate 실행기가 이 앱 실행 파일을 Node로 쓰고 있으면 놓게 한다 */
  async beforeInstall(): Promise<void> {
    if (this.mateStarted) await this.mate?.stopLocalRunner().catch(() => undefined);
  }

  dispose(): void {
    this.stopAgent();
    this.stopMate();
  }

  /** Pi Desktop에는 Agent·Mate 업데이트가 따로 없다 (Pi Desktop이 함께 업데이트한다). 플러그인 화면이 묻는 것에 답만 한다 */
  registerUpdateStubs(updateState: () => unknown): void {
    for (const channels of [AgentChannels, MateChannels]) {
      ipcMain.handle(channels.updateState, () => updateState());
      ipcMain.handle(channels.checkForUpdates, () => updateState());
      ipcMain.handle(channels.confirmUpdate, () => undefined);
    }
  }
}
