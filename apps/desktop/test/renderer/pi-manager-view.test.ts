import { describe, expect, it } from "vitest";
import type { PiStatus } from "@pi-desktop/host-protocol/messages";
import { statusChecks, updateState } from "../../src/renderer/pi-manager-view";

const base: PiStatus = {
  platform: "linux",
  pi: { cliPath: "/p/cli.js", packageDir: "/p", version: "1.3.0", source: "npm-global" },
  node: { path: "/usr/bin/node", version: "v22.19.0", required: ">=22.19.0", ok: true },
  data: {
    agentDir: "/home/me/.pi/agent",
    exists: true,
    sessionDir: "/home/me/.pi/agent/sessions",
    sessions: { count: 12, bytes: 2048, truncated: false },
    authProviders: ["anthropic", "openai"],
    hasModelsJson: true,
    hasSettings: false,
  },
};

describe("updateState", () => {
  it("설치된 버전과 최신 버전을 비교한다", () => {
    expect(updateState("1.3.0", { version: "1.4.0", checkedAt: 0 })).toBe("available");
    expect(updateState("1.3.0", { version: "1.3.0", checkedAt: 0 })).toBe("latest");
    expect(updateState("1.10.0", { version: "1.9.0", checkedAt: 0 })).toBe("ahead");
    expect(updateState("1.3.0", { error: "offline", checkedAt: 0 })).toBe("unknown");
    expect(updateState(undefined, { version: "1.4.0", checkedAt: 0 })).toBe("unknown");
  });
});

describe("statusChecks", () => {
  const byId = (checks: ReturnType<typeof statusChecks>) => Object.fromEntries(checks.map((c) => [c.id, c]));

  it("정상 상태를 점검표로 보여준다", () => {
    const checks = byId(statusChecks(base, { version: "1.4.0", checkedAt: 0 }));
    expect(checks.pi).toMatchObject({ level: "ok", value: "1.3.0 · npm 전역 설치" });
    expect(checks.update).toMatchObject({ level: "warn", value: "1.4.0 사용 가능" });
    expect(checks.node).toMatchObject({ level: "ok", value: "v22.19.0 (필요: >=22.19.0)" });
    expect(checks.data).toMatchObject({ value: "세션 12개 · 2KB" });
    expect(checks.auth).toMatchObject({ level: "ok", value: "anthropic, openai" });
    expect(checks.config).toMatchObject({ value: "models.json" });
    expect(checks["git-bash"]).toBeUndefined();
  });

  it("Pi 없음, Node 부족, Git Bash 없음, 최신 버전 확인 실패", () => {
    const { pi: _pi, ...rest } = base;
    const status: PiStatus = {
      ...rest,
      piError: "설치된 Pi를 찾지 못했습니다",
      node: { path: "/n", version: "v20.0.0", required: ">=22.19.0", ok: false },
      gitBash: { found: false },
    };
    const checks = byId(statusChecks(status, { error: "ENOTFOUND", checkedAt: 0 }));
    expect(checks.pi).toMatchObject({ level: "bad", value: "설치되지 않음", detail: "설치된 Pi를 찾지 못했습니다" });
    expect(checks.update).toMatchObject({ level: "info", value: "확인하지 못함", detail: "ENOTFOUND" });
    expect(checks.node).toMatchObject({ level: "bad" });
    expect(checks["git-bash"]).toMatchObject({ level: "warn", value: "찾지 못함 — Pi의 bash 툴에 필요합니다" });
  });
});
