import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Methods } from "@pi-desktop/host-protocol";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

/**
 * 에이전트 앱의 데이터 함수를 데몬으로 부른다 (설계 DESIGN-APPS.md §6 D4).
 * 데몬 홈(PI_DESKTOP_HOME)이 Agent 홈이고, 상태는 그 아래 data/, 스킬은 skills/에 있다.
 */
describe("agent.call", () => {
  let client: TestClient;
  let home: string;
  const call = <T>(name: string, ...args: unknown[]) => client.request<T>(Methods.agentCall, { name, args });

  beforeAll(async () => {
    const env = await isolatedEnv();
    home = env.PI_DESKTOP_HOME!;
    client = new TestClient(env);
  });

  afterAll(async () => {
    await client?.shutdownDaemon();
  });

  it("지식베이스를 만들고 읽는다 (데몬 홈의 data/)", async () => {
    const entry = await call<{ id: string; title: string }>("kbSave", undefined, { type: "user", title: "선호", content: "한국어로 답한다", tags: [] });
    expect(entry.title).toBe("선호");
    const list = await call<Array<{ id: string }>>("kbList", false);
    expect(list.map((e) => e.id)).toEqual([entry.id]);
    expect(existsSync(join(home, "data", "memory"))).toBe(true);
    await expect(call("kbSave", undefined, { type: "user", title: "", content: "" })).rejects.toThrow(/제목과 본문/);
  });

  it("스킬은 데몬 홈의 skills/에 둔다", async () => {
    await call("skillSave", undefined, { name: "weekly-report", description: "주간 보고", instructions: "1. 본다", modelInvocation: true });
    expect(existsSync(join(home, "skills", "weekly-report", "SKILL.md"))).toBe(true);
    expect((await call<Array<{ name: string }>>("skillsList")).map((s) => s.name)).toEqual(["weekly-report"]);
    expect(await call("skillsDir")).toBe(join(home, "skills"));
  });

  it("돌려줄 값이 없으면 null, 모르는 이름이나 Object 원형의 이름은 거절한다", async () => {
    expect(await call("setElevation", true)).toBeNull();
    expect(await call("getElevation")).toBe(true);
    await expect(call("nope")).rejects.toThrow(/모르는 에이전트 함수/);
    await expect(call("toString")).rejects.toThrow(/모르는 에이전트 함수/);
  });
});
