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
} from "@pi-desktop/host-protocol";
import type { ConnectionState } from "../shared/api";
import type { NodeRuntime } from "./node-runtime";

export interface HostConnectionOptions {
  runtime: NodeRuntime;
  /** 번들된 Host Agent 스크립트(dist/host-agent.mjs) 경로 */
  agentScript: string;
  onState: (state: ConnectionState) => void;
  onSessionEvent: (notification: SessionEventNotification) => void;
  onSessionExit: (notification: SessionExitNotification) => void;
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

/**
 * 로컬 호스트의 Host Agent 연결 (설계 §3.2 Local transport).
 *
 * `host-agent connect`를 자식 프로세스로 띄워 stdio로 JSON-RPC를 주고받는다.
 * 연결기는 앱과 함께 죽지만 데몬과 Pi 세션은 남는다. 연결기가 끊기면 지수 백오프로 다시 붙는다.
 * WSL·SSH는 M3에서 같은 인터페이스로 transport만 바꿔 추가한다.
 */
export class HostConnection {
  private child: ChildProcessWithoutNullStreams | undefined;
  private peer: JsonRpcPeer | undefined;
  private state: ConnectionState = { status: "connecting" };
  private retryDelay = RECONNECT_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readyWaiters: Array<() => void> = [];

  constructor(private readonly options: HostConnectionOptions) {}

  start(): void {
    this.connect();
  }

  get current(): ConnectionState {
    return this.state;
  }

  /** 연결될 때까지 기다린 뒤 요청한다. */
  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.state.status !== "connected" || !this.peer) {
      await new Promise<void>((resolve) => this.readyWaiters.push(resolve));
    }
    return this.peer!.request<T>(method, params);
  }

  /** 앱 종료 시 호출. 연결기만 끝내고 데몬·세션은 그대로 둔다 (설계 §3.4). */
  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.child?.kill();
  }

  private connect(): void {
    if (this.disposed) return;
    this.setState({ status: "connecting" });

    const child = spawn(this.options.runtime.command, [this.options.agentScript, "connect"], {
      env: { ...process.env, ...this.options.runtime.env },
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
      this.setState({ status: "disconnected", reason: stderr.trim() || `연결기 종료 (code ${code})` });
      this.scheduleReconnect();
    });

    peer
      .request<HostInfo>(Methods.hostInfo, undefined, 30_000)
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
    this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.options.onState(state);
  }
}
