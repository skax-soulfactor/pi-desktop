import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DaemonEvents, Methods, type SessionOpenResult, type SessionSummary } from "@pi-desktop/host-protocol";
import { isolatedEnv, joinedText, TestClient } from "./helpers/agent-client";
import { MOCK_MODEL_ARGS, PI_CLI, setupRealPi, type RealPiFixture } from "./helpers/real-pi";

/**
 * 실제 Pi(`@earendil-works/pi-coding-agent`, devDependency)를 데몬 아래에서 RPC 모드로 돌리는 계약 테스트.
 * LLM은 mock 서버로 대신해 API 키 없이 실행한다.
 * Pi 업데이트로 RPC 이벤트 형식이 바뀌면 여기서 먼저 깨진다 (설계 §9).
 */
describe("실제 Pi 계약 테스트", () => {
  let fixture: RealPiFixture;
  let client: TestClient;
  let projectDir: string;
  let piEnv: Record<string, string>;

  beforeAll(async () => {
    fixture = await setupRealPi();
    ({ projectDir, piEnv } = fixture);
    client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI }));
  });

  afterAll(async () => {
    await client?.shutdownDaemon();
    await fixture?.llm.close();
  });

  it("Pi를 띄우고 텍스트 스트리밍을 agent_settled까지 받는다", async () => {
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: projectDir,
      piArgs: MOCK_MODEL_ARGS,
      env: piEnv,
    });
    expect(session.piVersion).toBe("1.3.0");
    expect(session.sessionFile).toMatch(/\.jsonl$/);

    await client.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
    const response = await client.request<Record<string, unknown>>(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "hello pi" },
    });
    expect(response).toMatchObject({ type: "response", command: "prompt", success: true });

    await client.waitForEvent((e) => e.type === "agent_settled");
    expect(joinedText(client.events)).toBe("echo: hello pi");

    // 활동 패널용 요약: 끝났으면 busy가 아니고, 제목은 첫 질문
    const listed = (await client.request<SessionSummary[]>(Methods.sessionList)).find((s) => s.sessionId === session.sessionId);
    expect(listed).toMatchObject({ busy: false, title: "hello pi" });

    // 이름을 붙이면 제목이 이름으로 바뀐다
    await client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "set_session_name", name: "인사 세션" },
    });
    const renamed = (await client.request<SessionSummary[]>(Methods.sessionList)).find((s) => s.sessionId === session.sessionId);
    expect(renamed?.title).toBe("인사 세션");

    const types = client.events.map((n) => (n.event as { type: string }).type);
    for (const expected of ["agent_start", "message_start", "message_update", "message_end", "agent_end"]) {
      expect(types).toContain(expected);
    }
  });

  it("툴 호출(read) 이벤트와 결과를 받는다", async () => {
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: projectDir,
      piArgs: MOCK_MODEL_ARGS,
      env: piEnv,
    });
    await client.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
    await client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "read:hello.txt" },
    });

    // 앞 테스트의 세션 이벤트도 같은 클라이언트로 들어오므로 세션 ID로 거른다.
    const isMine = (n: { sessionId: string }) => n.sessionId === session.sessionId;
    await client.waitForEvent((e, n) => isMine(n) && e.type === "agent_settled");
    const mineNotifications = client.events.filter(isMine);
    const mine = mineNotifications.map((n) => n.event as Record<string, unknown>);

    const start = mine.find((e) => e.type === "tool_execution_start");
    const end = mine.find((e) => e.type === "tool_execution_end");
    expect(start).toMatchObject({ toolName: "read", args: { path: "hello.txt" } });
    expect(end).toMatchObject({ toolName: "read", isError: false });
    expect(JSON.stringify(end?.result)).toContain("안녕 Pi");
    expect(joinedText(mineNotifications)).toContain("파일 내용: 안녕 Pi");
  });

  it("! 셸 명령(bash)은 데몬이 시작·끝 이벤트를 저널에 남기고, 출력 조각과 id가 같다", async () => {
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: projectDir,
      piArgs: MOCK_MODEL_ARGS,
      env: piEnv,
    });
    await client.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
    const response = await client.request<Record<string, unknown>>(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "bash", command: "echo hello-bash", excludeFromContext: true },
    });
    expect(response).toMatchObject({ command: "bash", success: true, data: { exitCode: 0 } });

    const isMine = (n: { sessionId: string }) => n.sessionId === session.sessionId;
    await client.waitForEvent((e, n) => isMine(n) && e.type === DaemonEvents.bashEnd);
    const mine = client.events.filter(isMine).map((n) => n.event as Record<string, unknown>);
    const start = mine.find((e) => e.type === DaemonEvents.bashStart);
    const updates = mine.filter((e) => e.type === "bash_execution_update");
    const end = mine.find((e) => e.type === DaemonEvents.bashEnd);

    expect(start).toMatchObject({ command: "echo hello-bash", excludeFromContext: true });
    expect(end).toMatchObject({ id: start?.id, exitCode: 0, cancelled: false });
    expect(updates.every((u) => u.id === start?.id)).toBe(true);
    expect(updates.map((u) => u.delta).join("")).toContain("hello-bash");
    // 시작 → 출력 → 끝 순서
    expect(mine.indexOf(start!)).toBeLessThan(mine.indexOf(updates[0]!));
    expect(mine.indexOf(updates.at(-1)!)).toBeLessThan(mine.indexOf(end!));
  });
});
