import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createJsonlReader,
  encodeJsonl,
  ErrorCodes,
  HOST_PROTOCOL_VERSION,
  JsonRpcError,
  JsonRpcPeer,
  Methods,
  Notifications,
  type DaemonStatus,
  type FsSearchParams,
  type FsSearchResult,
  type HostInfo,
  type PiLocateParams,
  type SessionAttachParams,
  type SessionAttachResult,
  type SessionEventNotification,
  type SessionExitNotification,
  type SessionExternalWriteNotification,
  type SessionUiResolvedNotification,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionRef,
  type SessionSendParams,
  type SessionHistoryParams,
  type SessionSummary,
  type StoredInspectResult,
  type StoredPathParams,
  type StoredReadResult,
  type StoredSession,
} from "@pi-desktop/host-protocol";
import { runDir, socketPath } from "./paths";
import { locatePi } from "./pi-locator";
import { FileIndex } from "./file-search";
import { FileWatcher } from "./file-watcher";
import { listStoredSessions, loadPiSdk, readStoredSession } from "./pi-sdk";
import { AgentSession } from "./session";
import { AGENT_VERSION } from "./version";

export interface DaemonOptions {
  env?: NodeJS.ProcessEnv;
  /** 세션·클라이언트가 모두 없을 때 스스로 종료하기까지 기다리는 시간 (ms) */
  idleShutdownMs?: number;
  journalCapacity?: number;
  /** 종료할 때 호출 (기본: process.exit) */
  onShutdown?: () => void;
}

/** 연결된 앱 하나 */
interface Client {
  id: number;
  socket: Socket;
  peer: JsonRpcPeer;
  /** 이 클라이언트가 이벤트를 받고 있는 세션들 */
  attached: Set<string>;
  /** 이 클라이언트가 팔로우 중인 세션 파일과 감시 해제 함수 */
  watches: Map<string, () => void>;
}

const DEFAULT_IDLE_SHUTDOWN_MS = 30 * 60 * 1000;

/**
 * Host Agent 상주 데몬 (설계 §3.4).
 *
 * 호스트·사용자당 하나만 뜬다. 앱은 연결기(connect)를 거쳐 이 데몬의 소켓에 붙는다.
 * 세션(Pi 프로세스)은 데몬이 소유하므로 앱 연결이 끊겨도 계속 실행된다.
 */
export class AgentDaemon {
  private server: Server | undefined;
  private nextClientId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private shuttingDown = false;
  private readonly startedAt = Date.now();
  private readonly clients = new Set<Client>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly files = new FileWatcher();
  /** 입력창 @ 파일 피커용 파일 목록 캐시 */
  private readonly fileIndex = new FileIndex();
  private readonly env: NodeJS.ProcessEnv;
  private readonly idleShutdownMs: number;

  constructor(private readonly options: DaemonOptions = {}) {
    this.env = options.env ?? process.env;
    this.idleShutdownMs =
      options.idleShutdownMs ?? (Number(this.env.PI_DESKTOP_IDLE_SHUTDOWN_MS) || DEFAULT_IDLE_SHUTDOWN_MS);
  }

  /**
   * 소켓을 열고 연결을 받기 시작한다.
   * 이미 다른 데몬이 듣고 있으면 `false`를 돌려준다 (연결기가 동시에 데몬을 띄운 경우).
   */
  async listen(): Promise<boolean> {
    const path = socketPath(this.env);
    // 로그 파일도 여기에 쓰므로 Windows에서도 만든다. 권한 제한은 POSIX 소켓 파일 보호용이다.
    mkdirSync(runDir(this.env), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(runDir(this.env), 0o700);

    const server = createServer((socket) => this.acceptClient(socket));
    const result = await tryListen(server, path);
    if (result === "in-use") {
      // 다른 데몬이 살아 있는지, 아니면 죽은 데몬이 남긴 소켓 파일인지 확인한다.
      if (await isAlive(path)) return false;
      if (process.platform !== "win32") {
        await unlink(path).catch(() => {});
        if ((await tryListen(server, path)) !== "ok") return false;
      } else {
        return false;
      }
    }
    this.server = server;
    this.log(`데몬 시작 pid=${process.pid} socket=${path}`);
    this.scheduleIdleCheck();
    return true;
  }

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.log(`데몬 종료: ${reason}`);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await Promise.allSettled([...this.sessions.values()].map((s) => s.stop()));
    for (const client of this.clients) {
      client.peer.close("데몬이 종료되었습니다");
      client.socket.destroy();
    }
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    (this.options.onShutdown ?? (() => process.exit(0)))();
  }

  status(): DaemonStatus {
    return {
      pid: process.pid,
      agentVersion: AGENT_VERSION,
      startedAt: this.startedAt,
      clients: this.clients.size,
      sessions: this.sessionSummaries(),
      idleShutdownMs: this.idleShutdownMs,
    };
  }

  private acceptClient(socket: Socket): void {
    const client: Client = {
      id: this.nextClientId++,
      socket,
      attached: new Set(),
      watches: new Map(),
      peer: new JsonRpcPeer({ send: (message) => socket.write(encodeJsonl(message)) }),
    };
    this.clients.add(client);
    this.scheduleIdleCheck();

    const reader = createJsonlReader((record) => client.peer.receive(record));
    socket.on("data", (chunk: Buffer) => reader.push(chunk));
    socket.on("error", () => {});
    socket.on("close", () => {
      client.peer.close();
      for (const off of client.watches.values()) off();
      client.watches.clear();
      this.clients.delete(client);
      this.scheduleIdleCheck();
    });

    this.registerHandlers(client);
  }

  private registerHandlers(client: Client): void {
    const { peer } = client;

    peer.handle(Methods.hostInfo, (): HostInfo => ({
      protocolVersion: HOST_PROTOCOL_VERSION,
      agentVersion: AGENT_VERSION,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
      homeDir: homedir(),
    }));

    peer.handle(Methods.piLocate, (params) =>
      locatePi({ piCliPath: (params as PiLocateParams | undefined)?.piCliPath, env: this.env }),
    );

    peer.handle(Methods.sessionOpen, async (params): Promise<SessionOpenResult> => {
      const p = params as SessionOpenParams;
      if (!p?.cwd) throw new JsonRpcError(ErrorCodes.InvalidParams, "cwd가 필요합니다");
      // 없는 폴더로 spawn하면 Windows는 "node.exe ENOENT"처럼 엉뚱한 오류를 내므로 미리 확인한다.
      const cwdStat = await stat(p.cwd).catch(() => undefined);
      if (p.sessionFile && p.forkFrom) {
        throw new JsonRpcError(ErrorCodes.InvalidParams, "sessionFile과 forkFrom은 함께 줄 수 없습니다");
      }
      if (!cwdStat?.isDirectory()) {
        throw new JsonRpcError(ErrorCodes.InvalidParams, `작업 폴더를 찾을 수 없습니다: ${p.cwd}`);
      }
      const pi = await locatePi({ piCliPath: p.piCliPath, env: this.env });
      const session = new AgentSession({
        cwd: p.cwd,
        pi,
        // 관리형 설치가 자체 Node를 가지고 있으면 그 node로, 아니면 데몬의 node로 실행한다.
        nodePath: pi.nodePath ?? process.execPath,
        sessionFile: p.sessionFile,
        forkFrom: p.forkFrom,
        piArgs: p.piArgs,
        env: { ...this.env, ...pi.env, ...p.env },
        journalCapacity: this.options.journalCapacity ?? (Number(this.env.PI_DESKTOP_JOURNAL_CAPACITY) || undefined),
        files: this.files,
        externalWriteGraceMs: Number(this.env.PI_DESKTOP_EXTERNAL_WRITE_GRACE_MS) || undefined,
      });
      this.sessions.set(session.id, session);
      this.wireSession(session);
      try {
        await session.start();
      } catch (error) {
        this.sessions.delete(session.id);
        await session.stop().catch(() => {});
        throw error;
      }
      this.log(`세션 시작 ${session.id} cwd=${p.cwd} pi=${pi.version}`);
      this.scheduleIdleCheck();
      return { session: session.summary() };
    });

    peer.handle(Methods.sessionList, (): SessionSummary[] => this.sessionSummaries());

    peer.handle(Methods.storedInspect, async (params): Promise<StoredInspectResult> => {
      const { path } = requirePath(params);
      const info = await stat(path).catch(() => undefined);
      const owner = [...this.sessions.values()].find((s) => s.isRunning && s.summary().sessionFile === path);
      const result: StoredInspectResult = {
        path,
        exists: Boolean(info?.isFile()),
        size: info?.size ?? 0,
        modified: info?.mtimeMs ?? 0,
      };
      if (owner) result.ownedBy = owner.id;
      return result;
    });

    peer.handle(Methods.storedRead, async (params): Promise<StoredReadResult> => {
      const p = requirePath(params);
      const pi = await locatePi({ piCliPath: p.piCliPath, env: this.env });
      return readStoredSession(await loadPiSdk(pi), p.path);
    });

    // 팔로우 모드: 다른 프로그램이 쓰는 세션 파일의 변경을 이 앱에 알린다. 앱이 끊기면 함께 멈춘다.
    peer.handle(Methods.storedWatch, (params) => {
      const { path } = requirePath(params);
      if (!client.watches.has(path)) {
        client.watches.set(path, this.files.watch(path, (change) => peer.notify(Notifications.storedChanged, change)));
      }
      return null;
    });

    peer.handle(Methods.storedUnwatch, (params) => {
      const { path } = requirePath(params);
      client.watches.get(path)?.();
      client.watches.delete(path);
      return null;
    });

    peer.handle(Methods.sessionHistory, async (params): Promise<StoredSession[]> => {
      const p = (params ?? {}) as SessionHistoryParams;
      const pi = await locatePi({ piCliPath: p.piCliPath, env: this.env });
      return listStoredSessions(await loadPiSdk(pi), p);
    });

    peer.handle(Methods.sessionAttach, (params): SessionAttachResult => {
      const p = params as SessionAttachParams;
      const session = this.requireSession(p?.sessionId);
      // 재생과 구독 등록 사이에 다른 이벤트가 끼지 않도록 동기적으로 처리한다.
      const { entries, truncated } = session.journal.since(Math.max(0, p.lastSeq ?? 0));
      for (const entry of entries) {
        const notification: SessionEventNotification = { sessionId: session.id, ...entry };
        peer.notify(Notifications.sessionEvent, notification);
      }
      client.attached.add(session.id);
      const first = entries[0];
      const last = entries[entries.length - 1];
      return {
        session: session.summary(),
        truncated,
        replayed: first && last ? { fromSeq: first.seq, toSeq: last.seq } : null,
        pendingUi: session.dialogs.ids(),
      };
    });

    peer.handle(Methods.sessionDetach, (params) => {
      client.attached.delete((params as SessionRef)?.sessionId);
      return null;
    });

    peer.handle(Methods.sessionSend, async (params) => {
      const p = params as SessionSendParams;
      const session = this.requireSession(p?.sessionId);
      if (!p.command || typeof p.command !== "object") {
        throw new JsonRpcError(ErrorCodes.InvalidParams, "command가 필요합니다");
      }
      if (p.noResponse) {
        session.sendRaw(p.command);
        return null;
      }
      return session.send(p.command);
    });

    peer.handle(Methods.sessionClose, async (params) => {
      const session = this.requireSession((params as SessionRef)?.sessionId);
      this.sessions.delete(session.id);
      await session.stop();
      for (const c of this.clients) c.attached.delete(session.id);
      this.log(`세션 닫음 ${session.id}`);
      this.scheduleIdleCheck();
      return null;
    });

    peer.handle(Methods.sessionClearExternalWrite, (params) => {
      this.requireSession((params as SessionRef)?.sessionId).clearExternalWrite();
      return null;
    });

    peer.handle(Methods.fsSearch, (params): Promise<FsSearchResult> => {
      const p = (params ?? {}) as Partial<FsSearchParams>;
      if (typeof p.cwd !== "string" || !p.cwd) throw new JsonRpcError(ErrorCodes.InvalidParams, "cwd가 필요합니다");
      const limit = typeof p.limit === "number" && p.limit > 0 ? Math.min(p.limit, 200) : 50;
      return this.fileIndex.search(p.cwd, typeof p.query === "string" ? p.query : "", limit);
    });

    peer.handle(Methods.daemonStatus, () => this.status());

    peer.handle(Methods.daemonShutdown, () => {
      // 응답을 먼저 보낸 뒤 종료한다.
      setImmediate(() => void this.shutdown("클라이언트 요청"));
      return null;
    });
  }

  /** 세션 이벤트를 붙어 있는 클라이언트들에게 전달한다. */
  private wireSession(session: AgentSession): void {
    session.onEntry((entry) => {
      const notification: SessionEventNotification = { sessionId: session.id, ...entry };
      for (const client of this.clients) {
        if (client.attached.has(session.id)) client.peer.notify(Notifications.sessionEvent, notification);
      }
    });
    session.onExternalWrite((path, at) => {
      this.log(`다른 프로그램이 세션 파일에 씀 ${session.id} ${path}`);
      const notification: SessionExternalWriteNotification = { sessionId: session.id, at, path };
      for (const client of this.clients) {
        if (client.attached.has(session.id)) client.peer.notify(Notifications.sessionExternalWrite, notification);
      }
    });
    session.onDialogResolved((id) => {
      const notification: SessionUiResolvedNotification = { sessionId: session.id, id };
      for (const client of this.clients) {
        if (client.attached.has(session.id)) client.peer.notify(Notifications.sessionUiResolved, notification);
      }
    });
    session.onExit((exit) => {
      this.log(`Pi 종료 ${session.id} code=${exit.exitCode} signal=${exit.signal}`);
      const notification: SessionExitNotification = { sessionId: session.id, ...exit };
      for (const client of this.clients) {
        if (client.attached.has(session.id)) client.peer.notify(Notifications.sessionExit, notification);
      }
      this.scheduleIdleCheck();
    });
  }

  private requireSession(sessionId: string | undefined): AgentSession {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) throw new JsonRpcError(ErrorCodes.SessionNotFound, `세션을 찾을 수 없습니다: ${sessionId}`);
    return session;
  }

  private sessionSummaries(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => s.summary());
  }

  /**
   * 연결된 앱도, 실행 중인 세션도 없으면 일정 시간 뒤 스스로 종료한다.
   * 종료된(exited) 세션은 "실행 중"으로 치지 않는다.
   */
  private scheduleIdleCheck(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.shuttingDown) return;
    const busy = this.clients.size > 0 || [...this.sessions.values()].some((s) => s.isRunning);
    if (busy) return;
    this.idleTimer = setTimeout(() => void this.shutdown("유휴 시간 초과"), this.idleShutdownMs);
  }

  private log(message: string): void {
    try {
      appendFileSync(join(runDir(this.env), "agentd.log"), `${new Date().toISOString()} ${message}\n`);
    } catch {
      // 로그 실패로 데몬이 죽지 않게 한다.
    }
  }
}

function tryListen(server: Server, path: string): Promise<"ok" | "in-use"> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") resolve("in-use");
      else reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve("ok");
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(path);
  });
}

function isAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function requirePath(params: unknown): StoredPathParams {
  const p = params as StoredPathParams | undefined;
  if (!p?.path) throw new JsonRpcError(ErrorCodes.InvalidParams, "path가 필요합니다");
  return p;
}
