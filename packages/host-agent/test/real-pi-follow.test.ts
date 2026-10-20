import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createJsonlReader,
  encodeJsonl,
  Methods,
  type SessionOpenResult,
  type StoredInspectResult,
  type StoredReadResult,
} from "@pi-desktop/host-protocol";
import { isolatedEnv, TestClient } from "./helpers/agent-client";
import { MOCK_MODEL_ARGS, PI_CLI, setupRealPi, type RealPiFixture } from "./helpers/real-pi";

/**
 * TUI와 병행 사용 계약 테스트 (설계 §5.4).
 *
 * 데몬 밖에서 따로 띄운 Pi 프로세스를 "TUI"로 보고 그 세션 파일에 쓰게 한 뒤,
 * 데몬이 그 파일을 검사·읽기·팔로우하고, 같은 파일에 쓰지 않도록 분기(--fork)해서 여는지 확인한다.
 */

/** 데몬과 무관하게 직접 띄운 Pi (TUI 대역) */
class ExternalPi {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly records: Array<Record<string, unknown>> = [];
  private nextId = 1;

  constructor(cwd: string, env: Record<string, string>) {
    this.child = spawn(process.execPath, [PI_CLI, "--mode", "rpc", ...MOCK_MODEL_ARGS], {
      cwd,
      env: { ...process.env, ...env },
    });
    const reader = createJsonlReader((r) => this.records.push(r as Record<string, unknown>));
    this.child.stdout.on("data", (c: Buffer) => reader.push(c));
  }

  async command(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = `ext-${this.nextId++}`;
    this.child.stdin.write(encodeJsonl({ ...command, id }));
    return this.waitFor((r) => r.type === "response" && r.id === id);
  }

  async prompt(message: string): Promise<void> {
    const settled = this.records.filter((r) => r.type === "agent_settled").length;
    await this.command({ type: "prompt", message });
    await this.waitFor(() => this.records.filter((r) => r.type === "agent_settled").length > settled);
  }

  async sessionFile(): Promise<string> {
    const state = await this.command({ type: "get_state" });
    return String((state.data as { sessionFile: string }).sessionFile);
  }

  stop(): void {
    this.child.stdin.end();
  }

  private async waitFor(check: (r: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const hit = this.records.find(check) ?? (check({}) ? {} : undefined);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error("외부 Pi 응답 시간 초과");
      await new Promise((r) => setTimeout(r, 30));
    }
  }
}

/** 사용자 메시지 본문. content는 문자열이거나 {type:"text"} 블록 배열이다. */
const userTexts = (messages: unknown[]) =>
  messages
    .map((m) => m as { role?: string; content?: unknown })
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ type?: string; text?: string }>)
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
    );

describe("TUI와 병행 사용 (외부 Pi 프로세스)", () => {
  let fixture: RealPiFixture;
  let client: TestClient;
  let external: ExternalPi;
  let externalFile: string;

  beforeAll(async () => {
    fixture = await setupRealPi();
    client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI }));
    external = new ExternalPi(fixture.projectDir, fixture.piEnv);
    await external.prompt("외부 첫 질문");
    externalFile = await external.sessionFile();
  });

  afterAll(async () => {
    external?.stop();
    await client?.shutdownDaemon();
    await fixture?.llm.close();
  });

  it("stored.inspect: 다른 프로그램이 쓰는 파일은 최근 수정 시각만 있고 ownedBy가 없다", async () => {
    const info = await client.request<StoredInspectResult>(Methods.storedInspect, { path: externalFile });
    expect(info).toMatchObject({ path: externalFile, exists: true });
    expect(info.ownedBy).toBeUndefined();
    expect(Date.now() - info.modified).toBeLessThan(60_000);
  });

  it("stored.read: 파일을 읽기만 해서 현재 갈래의 대화를 만든다", async () => {
    const before = (await stat(externalFile)).size;
    const read = await client.request<StoredReadResult>(Methods.storedRead, { path: externalFile });
    expect(userTexts(read.messages)).toEqual(["외부 첫 질문"]);
    expect(read.leafId).toBeTruthy();
    expect((await stat(externalFile)).size).toBe(before);
  });

  it("stored.watch: 외부 Pi가 파일에 덧붙이면 알림을 받고, 다시 읽으면 새 대화가 보인다", async () => {
    await client.request(Methods.storedWatch, { path: externalFile });
    const seen = client.storedChanges.length;
    await external.prompt("외부 두 번째 질문");
    // 파일 감시는 주기적으로 stat하므로 알림이 조금 늦게 올 수 있다.
    const deadline = Date.now() + 10_000;
    while (client.storedChanges.length === seen && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(client.storedChanges.length).toBeGreaterThan(seen);
    expect(client.storedChanges.at(-1)?.path).toBe(externalFile);

    const read = await client.request<StoredReadResult>(Methods.storedRead, { path: externalFile });
    expect(userTexts(read.messages)).toEqual(["외부 첫 질문", "외부 두 번째 질문"]);
    await client.request(Methods.storedUnwatch, { path: externalFile });
  });

  it("forkFrom: 같은 파일에 쓰지 않고 분기한 새 세션으로 이어 간다", async () => {
    const sizeBefore = (await stat(externalFile)).size;
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: fixture.projectDir,
      forkFrom: externalFile,
      piArgs: MOCK_MODEL_ARGS,
      env: fixture.piEnv,
    });
    expect(session.sessionFile).toBeDefined();
    expect(session.sessionFile).not.toBe(externalFile);

    const messages = await client.request<{ data: { messages: unknown[] } }>(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "get_messages" },
    });
    expect(userTexts(messages.data.messages)).toEqual(["외부 첫 질문", "외부 두 번째 질문"]);

    await client.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
    await client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "분기에서 이어 가기" },
    });
    await client.waitForEvent((e, n) => n.sessionId === session.sessionId && e.type === "agent_settled");
    // 원래 파일(외부 Pi의 파일)은 건드리지 않았다
    expect((await stat(externalFile)).size).toBe(sizeBefore);

    const owned = await client.request<StoredInspectResult>(Methods.storedInspect, { path: session.sessionFile });
    expect(owned.ownedBy).toBe(session.sessionId);
  });

  it("sessionFile과 forkFrom을 함께 주면 거부한다", async () => {
    await expect(
      client.request(Methods.sessionOpen, { cwd: fixture.projectDir, sessionFile: externalFile, forkFrom: externalFile }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});
