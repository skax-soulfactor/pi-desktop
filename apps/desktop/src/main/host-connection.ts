import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createJsonlReader,
  encodeJsonl,
  JsonRpcPeer,
  Methods,
  Notifications,
  type DaemonStatus,
  type HostInfo,
  type SessionEventNotification,
  type SessionExitNotification,
  type SessionExternalWriteNotification,
  type SessionWriterChangedNotification,
  type FilesChangedNotification,
  type SessionUiResolvedNotification,
  type StoredChangedNotification,
  type PiUpdateOutputNotification,
} from "@pi-desktop/host-protocol";
import type { ConnectionState } from "../shared/api";
import { checkAgent } from "./agent-build";

/** 연결기(`host-agent connect`)를 띄우는 명령. 호스트 종류(로컬·WSL·SSH)마다 다르다. */
export interface LaunchSpec {
  command: string;
  args: string[];
  /** 앱 프로세스 환경에 덧붙일 변수 */
  env?: Record<string, string>;
  /** 연결기가 실행할 번들의 빌드 식별자 (agent-build.ts). 떠 있는 데몬과 비교한다 */
  agentBuild?: string;
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
  onWriterChanged: (notification: SessionWriterChangedNotification) => void;
  onFilesChanged: (notification: FilesChangedNotification) => void;
  onPiUpdateOutput: (notification: PiUpdateOutputNotification) => void;
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** 예전 데몬을 쓰는 동안 세션이 모두 끝났는지 다시 보는 간격 */
const STALE_CHECK_MS = 30_000;

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
  /** 예전 데몬을 끄는 중. 연결기가 끝나도 오류로 알리지 않고 바로 다시 붙는다 */
  private replacing = false;
  /** 교체를 시도한 번들의 빌드 식별자 (되풀이 방지) */
  private replaceTriedFor: string | undefined;
  private staleTimer: ReturnType<typeof setInterval> | undefined;

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
    this.stopStaleCheck();
    this.child?.kill();
  }

  /**
   * 예전 데몬을 지금 끄고 새 번들로 다시 띄운다 ("업데이트 대기"에서 사용자가 고른 경우).
   * 실행 중인 Pi 세션도 함께 끝난다. 앱은 다시 붙은 뒤 "다시 열기"로 세션 파일에서 이어 간다.
   */
  async replaceAgent(): Promise<void> {
    const peer = this.peer;
    if (this.state.status !== "connected" || !peer) throw new Error("연결되어 있지 않습니다");
    this.replacing = true;
    await peer.request(Methods.daemonShutdown).catch(() => {});
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
    peer.on(Notifications.sessionWriterChanged, (p) => this.options.onWriterChanged(p as SessionWriterChangedNotification));
    peer.on(Notifications.filesChanged, (p) => this.options.onFilesChanged(p as FilesChangedNotification));
    peer.on(Notifications.piUpdateOutput, (p) => this.options.onPiUpdateOutput(p as PiUpdateOutputNotification));

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
      this.stopStaleCheck();
      if (this.disposed) return;
      if (this.replacing) {
        // 예전 데몬을 일부러 껐다. 연결기가 새 번들로 데몬을 띄우도록 곧바로 다시 붙는다.
        this.replacing = false;
        this.retryDelay = RECONNECT_MIN_MS;
        this.setState({ status: "connecting" });
        this.scheduleReconnect();
        return;
      }
      this.setState({ status: "disconnected", reason: lastLines(stderr) || `연결기 종료 (code ${code})` });
      this.scheduleReconnect();
    });

    peer
      .request<HostInfo>(Methods.hostInfo, undefined, 60_000)
      .then(async (host) => {
        const agentUpdate = await this.checkAgent(peer, spec.agentBuild, host);
        if (agentUpdate === "replacing") return;
        this.retryDelay = RECONNECT_MIN_MS;
        this.setState({ status: "connected", host, ...(agentUpdate ? { agentUpdate } : {}) });
        if (agentUpdate) this.startStaleCheck(peer, spec.agentBuild);
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const resolve of waiters) resolve();
      })
      .catch(() => child.kill());
  }

  /**
   * 떠 있는 데몬이 앱의 번들과 같은지 본다 (설계 §3.4).
   * 예전 데몬이면 실행 중인 세션이 없을 때 끄고("replacing", 연결기 종료 뒤 다시 붙으면서 새 번들로 뜬다),
   * 세션이 있으면 그대로 쓰면서 업데이트 대기를 알린다.
   */
  private async checkAgent(
    peer: JsonRpcPeer,
    expected: string | undefined,
    host: HostInfo,
  ): Promise<"replacing" | { liveSessions: number } | undefined> {
    if (!expected || host.agentBuild === expected) return undefined;
    const status = await peer.request<DaemonStatus>(Methods.daemonStatus);
    const liveSessions = status.sessions.filter((s) => s.state === "running").length;
    const check = checkAgent(expected, host.agentBuild, liveSessions, this.replaceTriedFor === expected);
    if (check === "replace") {
      this.replaceTriedFor = expected;
      this.replacing = true;
      await peer.request(Methods.daemonShutdown).catch(() => {});
      return "replacing";
    }
    return check === "stale" ? { liveSessions } : undefined;
  }

  /** 업데이트 대기 중: 세션이 모두 끝나면 예전 데몬을 바꾼다. */
  private startStaleCheck(peer: JsonRpcPeer, expected: string | undefined): void {
    this.stopStaleCheck();
    this.staleTimer = setInterval(() => {
      void peer
        .request<DaemonStatus>(Methods.daemonStatus)
        .then((status) => {
          if (this.peer !== peer || status.sessions.some((s) => s.state === "running")) return;
          // 이미 한 번 바꿨는데도 같은 데몬이 떠 있으면(교체 실패) 되풀이하지 않는다.
          if (this.replaceTriedFor === expected) return;
          this.replaceTriedFor = expected;
          this.replacing = true;
          return peer.request(Methods.daemonShutdown);
        })
        .catch(() => {});
    }, STALE_CHECK_MS);
  }

  private stopStaleCheck(): void {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = undefined;
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
