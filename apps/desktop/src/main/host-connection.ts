import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createJsonlReader,
  encodeJsonl,
  JsonRpcPeer,
  Methods,
  Notifications,
  type HostInfo,
  type SessionEventNotification,
  type SessionExitNotification,
  type SessionExternalWriteNotification,
  type SessionUiResolvedNotification,
  type StoredChangedNotification,
} from "@pi-desktop/host-protocol";
import type { ConnectionState } from "../shared/api";

/** 연결기(`host-agent connect`)를 띄우는 명령. 호스트 종류(로컬·WSL·SSH)마다 다르다. */
export interface LaunchSpec {
  command: string;
  args: string[];
  /** 앱 프로세스 환경에 덧붙일 변수 */
  env?: Record<string, string>;
}

export interface HostConnectionOptions {
  /**
   * 연결을 시도할 때마다 호출된다. 여기서 Agent 배포·버전 확인 같은 준비를 하고 실행 명령을 돌려준다.
   * 예외를 던지면 그 메시지를 연결 끊김 사유로 보여주고 나중에 다시 시도한다.
   */
  prepare: () => Promise<LaunchSpec>;
  onState: (state: ConnectionState) => void;
  onSessionEvent: (notification: SessionEventNotification) => void;
  onSessionExit: (notification: SessionExitNotification) => void;
  onUiResolved: (notification: SessionUiResolvedNotification) => void;
  onStoredChanged: (notification: StoredChangedNotification) => void;
  onExternalWrite: (notification: SessionExternalWriteNotification) => void;
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

/**
 * 호스트 하나의 Host Agent 연결 (설계 §3.2).
 *
 * 연결기를 자식 프로세스로 띄워 stdio로 JSON-RPC를 주고받는다. 로컬이면 node를 직접,
 * WSL이면 wsl.exe를 거쳐 띄운다. 연결기는 앱과 함께 죽지만 데몬과 Pi 세션은 남는다.
 * 연결기가 끊기면 지수 백오프로 다시 붙는다.
 */
export class HostConnection {
  private child: ChildProcessWithoutNullStreams | undefined;
  private peer: JsonRpcPeer | undefined;
  private state: ConnectionState = { status: "connecting" };
  private retryDelay = RECONNECT_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private started = false;
  private readyWaiters: Array<() => void> = [];

  constructor(private readonly options: HostConnectionOptions) {}

  /** 처음 한 번만 연결을 시작한다. 이미 시작했으면 아무것도 하지 않는다. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.connect();
  }

  get current(): ConnectionState {
    return this.state;
  }

  /** 연결될 때까지 기다린 뒤 요청한다. */
  /** @param timeoutMs 응답 제한 시간. 생략하면 기본값(2분), 0이면 제한 없음 */
  async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    this.start();
    if (this.state.status !== "connected" || !this.peer) {
      await new Promise<void>((resolve) => this.readyWaiters.push(resolve));
    }
    return this.peer!.request<T>(method, params, timeoutMs);
  }

  /** 앱 종료 시 호출. 연결기만 끝내고 데몬·세션은 그대로 둔다 (설계 §3.4). */
  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.child?.kill();
  }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    this.setState({ status: "connecting" });

    let spec: LaunchSpec;
    try {
      spec = await this.options.prepare();
    } catch (error) {
      this.setState({ status: "disconnected", reason: error instanceof Error ? error.message : String(error) });
      this.scheduleReconnect();
      return;
    }
    if (this.disposed) return;

    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const peer = new JsonRpcPeer({
      send: (message) => child.stdin.write(encodeJsonl(message)),
      defaultTimeoutMs: 120_000,
    });
    this.peer = peer;
    peer.on(Notifications.sessionEvent, (p) => this.options.onSessionEvent(p as SessionEventNotification));
    peer.on(Notifications.sessionExit, (p) => this.options.onSessionExit(p as SessionExitNotification));
    peer.on(Notifications.sessionUiResolved, (p) => this.options.onUiResolved(p as SessionUiResolvedNotification));
    peer.on(Notifications.storedChanged, (p) => this.options.onStoredChanged(p as StoredChangedNotification));
    peer.on(Notifications.sessionExternalWrite, (p) => this.options.onExternalWrite(p as SessionExternalWriteNotification));

    // stdout에 프로토콜이 아닌 줄(예: 셸 안내 문구)이 섞여도 무시하고 계속 읽는다.
    const reader = createJsonlReader((record) => peer.receive(record));
    child.stdout.on("data", (chunk: Buffer) => reader.push(chunk));
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-4000)));
    child.stdin.on("error", () => {});
    child.on("error", (error) => (stderr += `\n${error.message}`));
    child.on("exit", (code) => {
      peer.close("Host Agent 연결이 끊겼습니다");
      if (this.child === child) this.child = undefined;
      if (this.disposed) return;
      this.setState({ status: "disconnected", reason: lastLines(stderr) || `연결기 종료 (code ${code})` });
      this.scheduleReconnect();
    });

    peer
      .request<HostInfo>(Methods.hostInfo, undefined, 60_000)
      .then((host) => {
        this.retryDelay = RECONNECT_MIN_MS;
        this.setState({ status: "connected", host });
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const resolve of waiters) resolve();
      })
      .catch(() => child.kill());
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.options.onState(state);
  }
}

/** 오류 표시용으로 stderr 마지막 몇 줄만 남긴다. WSL의 경로 변환 경고처럼 의미 없는 줄은 뺀다. */
function lastLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.includes("Failed to translate"))
    .slice(-5)
    .join("\n");
}
