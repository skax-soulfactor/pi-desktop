import { app, ipcMain, type BrowserWindow, type WebFrameMain } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { IpcChannels, type PluginWorkspaceId, type WorkspaceId, type WorkspacesState } from "../shared/api";
import { createAgentMain, type AgentMain } from "../../../agent/src/main/agent-main";
import { IpcChannels as AgentChannels } from "../../../agent/src/shared/api";

/**
 * 작업 공간 (설계 DESIGN-ONE-APP.md). Pi Desktop 화면("pi") 옆에 내장 플러그인을 작업 공간으로 띄운다.
 * 지금은 Agent 하나이고 미리 보기라 기본 꺼짐이다 (설정은 userData/workspaces.json).
 *
 * - 화면: 플러그인 화면(빌드된 Agent 화면, out/renderer/agent/)을 Pi Desktop 창 안의 iframe으로 연다.
 *   CSS·화면 코드가 섞이지 않고, 한 작업 공간이 멈춰도 다른 화면은 그대로다.
 * - preload: 창의 preload가 모든 프레임에서 돌고(nodeIntegrationInSubFrames), Agent 프레임에서는 window.piAgent를 만든다.
 * - main: Agent 본체(createAgentMain)를 이 창에 맞춘 컨텍스트로 띄운다. IPC 채널은 "agent:"라 Pi Desktop의 "pi:"와 부딪히지 않는다.
 *   main이 Agent 화면에 보내는 것은 Agent 프레임으로만 간다.
 */

const PLUGINS: Array<{ id: PluginWorkspaceId; name: string }> = [{ id: "agent", name: "Agent (미리 보기)" }];

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
  /** Pi 관리를 연다 (Agent 화면의 "Pi Desktop에서 관리") */
  openPiManager(): void;
}

export class Workspaces {
  private readonly file: string;
  private active: WorkspaceId = "pi";
  private agent: AgentMain | undefined;
  private agentStarted = false;
  private readyWaiters: Array<() => void> = [];
  private agentReady = false;

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

  enabled(id: PluginWorkspaceId): boolean {
    return this.settings().enabled[id] === true;
  }

  state(): WorkspacesState {
    const settings = this.settings();
    return {
      plugins: PLUGINS.map((p) => {
        const enabled = settings.enabled[p.id] === true;
        const file = this.host.rendererFile(p.id);
        // 개발 서버(http)로 띄운 창은 file:// 프레임을 열 수 없다. 빌드한 화면으로 실행해야 한다
        const reason = process.env.ELECTRON_RENDERER_URL && !app.isPackaged ? "개발 서버 실행에서는 열 수 없습니다 (빌드한 뒤 실행하세요)" : !existsSync(file) ? `화면 파일이 없습니다: ${file}` : undefined;
        return { id: p.id, name: p.name, enabled, ...(reason ? { reason } : { url: pathToFileURL(file).href }) };
      }),
    };
  }

  /** 켜 둔 플러그인의 백그라운드를 시작한다 (앱 시작 때) */
  start(): void {
    if (this.enabled("agent")) this.startAgent();
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
    if (!on && this.active === id) this.show("pi");
    return this.state();
  }

  /** 화면이 작업 공간을 바꿨다 */
  shown(id: WorkspaceId): void {
    this.active = id;
    this.host.onActiveChanged(id);
  }

  /** main에서 작업 공간을 보이게 한다 (알림을 누름·메뉴바) */
  show(id: WorkspaceId): void {
    this.host.sendToShell(IpcChannels.showWorkspace, id);
    this.shown(id);
  }

  ready(id: PluginWorkspaceId): void {
    if (id !== "agent") return;
    this.agentReady = true;
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) waiter();
  }

  /** Agent 화면에 메뉴 명령을 보낸다 (Agent 작업 공간을 보는 동안의 메뉴바) */
  agentMenuCommand(id: string): void {
    this.sendToAgent(AgentChannels.menuCommand, id);
  }

  private agentFrames(): WebFrameMain[] {
    const win = this.host.window();
    if (!win || win.isDestroyed()) return [];
    const url = pathToFileURL(this.host.rendererFile("agent")).href;
    return win.webContents.mainFrame.framesInSubtree.filter((f) => f !== win.webContents.mainFrame && f.url.split("#")[0] === url);
  }

  private sendToAgent(channel: string, ...args: unknown[]): void {
    for (const frame of this.agentFrames()) {
      try {
        frame.send(channel, ...args);
      } catch {
        // 프레임이 막 사라졌다
      }
    }
  }

  private startAgent(): void {
    if (this.agentStarted) return;
    this.agent ??= createAgentMain({
      window: () => this.host.window(),
      send: (channel, ...args) => this.sendToAgent(channel, ...args),
      isViewing: () => Boolean(this.host.window()?.isFocused()) && this.active === "agent",
      reveal: (then) => {
        const win = this.host.window();
        if (win?.isMinimized()) win.restore();
        win?.show();
        win?.focus();
        this.show("agent");
        if (!then) return;
        if (this.agentReady && this.agentFrames().length > 0) then();
        else this.readyWaiters.push(then);
      },
      reload: () => {
        this.agentReady = false;
        for (const frame of this.agentFrames()) frame.reload();
      },
      // Agent 상태 파일(지금 호스트·SSH 호스트·앱 수치)은 Pi Desktop 데이터 폴더 안의 agent/에 둔다 (단독 Agent 앱과 섞지 않는다)
      userData: join(app.getPath("userData"), "agent"),
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
    if (!this.agentStarted) return;
    this.agent?.dispose();
    this.agentStarted = false;
    this.agentReady = false;
  }

  dispose(): void {
    this.stopAgent();
  }

  /** Pi Desktop에는 Agent 업데이트가 따로 없다 (Pi Desktop이 함께 업데이트한다). Agent 화면이 묻는 것에 답만 한다 */
  registerAgentStubs(updateState: () => unknown): void {
    ipcMain.handle(AgentChannels.updateState, () => updateState());
    ipcMain.handle(AgentChannels.checkForUpdates, () => updateState());
    ipcMain.handle(AgentChannels.confirmUpdate, () => undefined);
  }
}
