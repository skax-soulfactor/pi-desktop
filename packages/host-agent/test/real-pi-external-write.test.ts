import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Methods, type SessionOpenResult, type SessionSummary } from "@pi-desktop/host-protocol";
import { isolatedEnv, TestClient, waitUntil } from "./helpers/agent-client";
import { ExternalPi } from "./helpers/external-pi";
import { MOCK_MODEL_ARGS, PI_CLI, setupRealPi, type RealPiFixture } from "./helpers/real-pi";

/**
 * GUI(데몬)가 쓰는 세션 파일에 다른 프로그램(TUI 대역 외부 Pi)이 끼어드는 경우의 감지 (설계 §5.4).
 * 테스트를 빠르게 하려고 "우리 Pi가 조용한 시간" 기준을 800ms로 줄인다 (기본 3초).
 */
const GRACE_MS = 800;

describe("다른 프로그램의 끼어들기 감지 (실제 Pi)", () => {
  let fixture: RealPiFixture;
  let client: TestClient;
  let session: SessionSummary;
  const externals: ExternalPi[] = [];

  const summary = async () =>
    (await client.request<SessionSummary[]>(Methods.sessionList)).find((s) => s.sessionId === session.sessionId)!;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    fixture = await setupRealPi();
    client = new TestClient(
      await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI, PI_DESKTOP_EXTERNAL_WRITE_GRACE_MS: String(GRACE_MS) }),
    );
    ({ session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: fixture.projectDir,
      piArgs: MOCK_MODEL_ARGS,
      env: fixture.piEnv,
    }));
    await client.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
    await client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "GUI 첫 질문" },
    });
    await client.waitForEvent((e, n) => n.sessionId === session.sessionId && e.type === "agent_settled");
    session = await summary();
  });

  afterAll(async () => {
    for (const external of externals) external.stop();
    await client?.shutdownDaemon();
    await fixture?.llm.close();
  });

  it("우리 Pi가 쓰는 동안에는 감지하지 않는다", async () => {
    // 파일 감시 주기(1초)와 기준 시간이 지나도록 기다린 뒤에도 알림이 없어야 한다.
    await sleep(GRACE_MS + 1500);
    expect(client.externalWrites).toEqual([]);
    expect((await summary()).externalWriteAt).toBeUndefined();
  });

  it("외부 Pi가 같은 파일에 쓰면 감지해 알리고, 세션 요약에도 표시한다", async () => {
    const external = new ExternalPi(fixture.projectDir, fixture.piEnv, ["--session", session.sessionFile!]);
    externals.push(external);
    await external.prompt("TUI 끼어들기");

    await waitUntil(() => client.externalWrites.length > 0, 10_000, "끼어들기를 감지하지 못함");
    expect(client.externalWrites[0]).toMatchObject({ sessionId: session.sessionId, path: session.sessionFile });
    expect((await summary()).externalWriteAt).toBeGreaterThan(0);
  });

  it("무시하고 계속(clear)하면 표시가 지워진다", async () => {
    await client.request(Methods.sessionClearExternalWrite, { sessionId: session.sessionId });
    expect((await summary()).externalWriteAt).toBeUndefined();
  });

  it("복제(clone)로 새 파일로 옮기면, 옛 파일에 외부가 써도 더 이상 감지하지 않는다", async () => {
    const oldFile = session.sessionFile!;
    await client.request(Methods.sessionSend, { sessionId: session.sessionId, command: { type: "clone" } });
    const moved = await summary();
    expect(moved.sessionFile).not.toBe(oldFile);

    const seen = client.externalWrites.length;
    await externals[0]!.prompt("옛 파일에 계속 쓰기");
    await sleep(GRACE_MS + 1500);
    expect(client.externalWrites.length).toBe(seen);
    expect((await summary()).externalWriteAt).toBeUndefined();
  });
});
