import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createJsonlReader,
  encodeJsonl,
  JsonRpcPeer,
  Methods,
  Notifications,
  type SessionEventNotification,
  type SessionUiResolvedNotification,
} from "@pi-desktop/host-protocol";

/** 번들된 Host Agent. 테스트 전에 `npm run build`가 실행된다. */
export const AGENT_SCRIPT = fileURLToPath(new URL("../../dist/host-agent.mjs", import.meta.url));

/** 테스트마다 다른 데몬을 쓰도록 격리된 PI_DESKTOP_HOME을 만든다. */
export async function isolatedEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const home = await mkdtemp(join(tmpdir(), "pi-desktop-test-"));
  return { ...process.env, PI_DESKTOP_HOME: home, ...extra };
}

/**
 * 앱이 하는 것과 똑같이 `host-agent connect`를 자식 프로세스로 띄워 데몬에 붙는 테스트 클라이언트.
 */
export class TestClient {
  readonly peer: JsonRpcPeer;
  readonly events: SessionEventNotification[] = [];
  /** session.uiResolved로 받은 다이얼로그 id */
  readonly uiResolved: string[] = [];
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiters = new Set<() => void>();

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [AGENT_SCRIPT, "connect"], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.peer = new JsonRpcPeer({
      send: (m) => this.child.stdin.write(encodeJsonl(m)),
      defaultTimeoutMs: 30_000,
    });
    const reader = createJsonlReader((r) => this.peer.receive(r));
    this.child.stdout.on("data", (c: Buffer) => reader.push(c));
    this.child.stdin.on("error", () => {});
    this.child.on("exit", () => this.peer.close());
    this.peer.on(Notifications.sessionUiResolved, (p) => {
      this.uiResolved.push((p as SessionUiResolvedNotification).id);
    });
    this.peer.on(Notifications.sessionEvent, (p) => {
      this.events.push(p as SessionEventNotification);
      for (const w of this.waiters) w();
    });
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    return this.peer.request<T>(method, params);
  }

  /** 조건을 만족하는 이벤트가 올 때까지 기다린다. */
  waitForEvent(
    predicate: (event: Record<string, unknown>, notification: SessionEventNotification) => boolean,
    timeoutMs = 20_000,
  ): Promise<SessionEventNotification> {
    const find = () => this.events.find((n) => predicate(n.event as Record<string, unknown>, n));
    const found = find();
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error("이벤트 대기 시간 초과"));
      }, timeoutMs);
      const check = () => {
        const hit = find();
        if (!hit) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(hit);
      };
      this.waiters.add(check);
    });
  }

  /** 연결기 프로세스를 끝낸다 = 앱 종료·네트워크 끊김과 같은 상황. */
  async disconnect(): Promise<void> {
    await this.kill();
  }

  private exitPromise: Promise<void> | undefined;

  private kill(): Promise<void> {
    // 신호로 끝난 프로세스는 exitCode가 null이고 signalCode만 남으므로 둘 다 확인한다.
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve();
    this.exitPromise ??= new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      this.child.kill();
    });
    return this.exitPromise;
  }

  /** 데몬을 끝내고 연결도 정리한다. */
  async shutdownDaemon(): Promise<void> {
    await this.request(Methods.daemonShutdown).catch(() => {});
    await this.disconnect();
  }
}

/** 스트리밍된 text_delta를 이어 붙인다. */
export function joinedText(events: SessionEventNotification[]): string {
  return events
    .map((n) => n.event as { type?: string; assistantMessageEvent?: { type?: string; delta?: string } })
    .filter((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta")
    .map((e) => e.assistantMessageEvent?.delta ?? "")
    .join("");
}
