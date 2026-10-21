import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Methods, type ProjectTrustInfo, type SessionOpenResult } from "@pi-desktop/host-protocol";
import { effectiveTrust, trustArgs } from "../src/trust";
import { isolatedEnv, TestClient } from "./helpers/agent-client";
import { MOCK_MODEL_ARGS, PI_CLI, setupRealPi, type RealPiFixture } from "./helpers/real-pi";

describe("effectiveTrust·trustArgs", () => {
  it("필요 없음 → 저장된 결정 → 기본값 순으로 정한다", () => {
    expect(effectiveTrust(false, false, "never")).toBe("trusted");
    expect(effectiveTrust(true, true, "never")).toBe("trusted");
    expect(effectiveTrust(true, false, "always")).toBe("untrusted");
    expect(effectiveTrust(true, null, "always")).toBe("trusted");
    expect(effectiveTrust(true, null, "never")).toBe("untrusted");
    expect(effectiveTrust(true, null, "ask")).toBe("ask");
  });

  it("이번만 결정은 pi --approve / --no-approve로", () => {
    expect(trustArgs("yes")).toEqual(["--approve"]);
    expect(trustArgs("no")).toEqual(["--no-approve"]);
    expect(trustArgs(undefined)).toEqual([]);
  });
});

/** 프로젝트 .pi/prompts가 있는 폴더를 앱처럼 열었을 때 신뢰에 따라 프롬프트를 불러오는지 (실제 Pi) */
describe("프로젝트 신뢰 (실제 Pi)", () => {
  let fixture: RealPiFixture;
  let client: TestClient;
  let project: string;
  const agentDir = () => fixture.piEnv.PI_CODING_AGENT_DIR!;

  const commandsWhenOpened = async (trust?: "yes" | "no") => {
    const { session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: project,
      piArgs: MOCK_MODEL_ARGS,
      env: fixture.piEnv,
      ...(trust ? { trust } : {}),
    });
    const listed = await client.request<{ data: { commands: Array<{ name: string }> } }>(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "get_commands" },
    });
    await client.request(Methods.sessionClose, { sessionId: session.sessionId });
    return listed.data.commands.map((c) => c.name);
  };

  beforeAll(async () => {
    fixture = await setupRealPi();
    project = mkdtempSync(join(tmpdir(), "pi-trust-project-"));
    mkdirSync(join(project, ".pi", "prompts"), { recursive: true });
    writeFileSync(join(project, ".pi", "prompts", "team.md"), "---\ndescription: 팀 프롬프트\n---\nhi\n");
    // 데몬의 trust.get·set이 테스트용 데이터 폴더를 보도록 데몬 환경에도 준다
    client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI, PI_CODING_AGENT_DIR: fixture.piEnv.PI_CODING_AGENT_DIR! }));
  });

  afterAll(async () => {
    await client?.shutdownDaemon();
    await fixture?.llm.close();
  });

  it("정해진 것이 없으면 ask이고, 그대로 열면 RPC 모드라 프로젝트 프롬프트를 건너뛴다", async () => {
    const info = await client.request<ProjectTrustInfo>(Methods.trustGet, { cwd: project });
    expect(info).toMatchObject({ required: true, saved: null, defaultProjectTrust: "ask", effective: "ask" });
    expect(await commandsWhenOpened()).not.toContain("team");
  });

  it("이번만 신뢰하면 불러오고, 이번만 신뢰하지 않으면 건너뛰며, 둘 다 저장하지 않는다", async () => {
    expect(await commandsWhenOpened("yes")).toContain("team");
    expect(await commandsWhenOpened("no")).not.toContain("team");
    expect(existsSync(join(agentDir(), "trust.json"))).toBe(false);
  });

  it("신뢰를 저장하면 Pi의 trust.json에 남고, 다음부터 묻지 않고 불러온다", async () => {
    const info = await client.request<ProjectTrustInfo>(Methods.trustSet, { cwd: project, decision: true });
    expect(info).toMatchObject({ saved: true, effective: "trusted" });
    expect(existsSync(join(agentDir(), "trust.json"))).toBe(true);
    expect(await commandsWhenOpened()).toContain("team");

    const cleared = await client.request<ProjectTrustInfo>(Methods.trustSet, { cwd: project, decision: null });
    expect(cleared.effective).toBe("ask");
  });

  it(".pi/ 리소스가 없는 폴더는 결정할 것이 없다", async () => {
    const plain = mkdtempSync(join(tmpdir(), "pi-trust-plain-"));
    expect(await client.request<ProjectTrustInfo>(Methods.trustGet, { cwd: plain })).toMatchObject({
      required: false,
      effective: "trusted",
    });
  });
});
