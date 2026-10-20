import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Methods, type SessionOpenResult } from "@pi-desktop/host-protocol";
import { isolatedEnv, joinedText, TestClient } from "./helpers/agent-client";
import { startMockLlm, type MockLlm } from "./fixtures/mock-llm";

/**
 * 실제 Pi(`@earendil-works/pi-coding-agent`, devDependency)를 데몬 아래에서 RPC 모드로 돌리는 계약 테스트.
 * LLM은 mock 서버로 대신해 API 키 없이 실행한다.
 * Pi 업데이트로 RPC 이벤트 형식이 바뀌면 여기서 먼저 깨진다 (설계 §9).
 */
// Pi의 exports는 import 조건만 열어 두어 require.resolve를 쓸 수 없다. node_modules를 위로 올라가며 찾는다.
const PI_PACKAGE_DIR = findPackageDir("@earendil-works/pi-coding-agent");
const PI_CLI = join(PI_PACKAGE_DIR, "dist", "bundle", "cli.js");

function findPackageDir(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name}을 찾을 수 없습니다. npm install을 먼저 실행하세요`);
    dir = parent;
  }
}

describe("실제 Pi 계약 테스트", () => {
  let llm: MockLlm;
  let client: TestClient;
  let projectDir: string;
  let piEnv: Record<string, string>;

  beforeAll(async () => {
    llm = await startMockLlm();

    // 사용자 ~/.pi를 건드리지 않도록 Pi 설정 디렉터리를 격리한다.
    const piAgentDir = await mkdtemp(join(tmpdir(), "pi-agent-dir-"));
    await writeFile(
      join(piAgentDir, "models.json"),
      JSON.stringify({
        providers: {
          mock: { baseUrl: llm.baseUrl, api: "openai-completions", apiKey: "mock", models: [{ id: "mock-model" }] },
        },
      }),
    );
    projectDir = await mkdtemp(join(tmpdir(), "pi-project-"));
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "hello.txt"), "안녕 Pi\n");

    piEnv = {
      PI_CODING_AGENT_DIR: piAgentDir,
      PI_CODING_AGENT_SESSION_DIR: join(piAgentDir, "sessions"),
    };
    client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI }));
  });

  afterAll(async () => {
    await client?.shutdownDaemon();
    await llm?.close();
  });

  it("Pi를 띄우고 텍스트 스트리밍을 agent_settled까지 받는다", async () => {
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: projectDir,
      piArgs: ["--provider", "mock", "--model", "mock-model"],
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

    const types = client.events.map((n) => (n.event as { type: string }).type);
    for (const expected of ["agent_start", "message_start", "message_update", "message_end", "agent_end"]) {
      expect(types).toContain(expected);
    }
  });

  it("툴 호출(read) 이벤트와 결과를 받는다", async () => {
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: projectDir,
      piArgs: ["--provider", "mock", "--model", "mock-model"],
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
});
