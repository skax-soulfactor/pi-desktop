import { describe, expect, it } from "vitest";
import { ErrorCodes, JsonRpcError } from "@pi-desktop/host-protocol";
import { agentBuildId, checkAgent, staleAgentError } from "../../src/main/agent-build";
import { agentFileName } from "../../src/main/remote-agent";

describe("agentBuildId", () => {
  it("번들 SHA-256의 앞 12자리이고, WSL에 올리는 파일 이름에도 같은 값이 들어간다", () => {
    const bundle = Buffer.from("console.log(1)");
    const id = agentBuildId(bundle);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(agentFileName("0.0.1", bundle)).toBe(`host-agent-0.0.1-${id}.mjs`);
  });
});

describe("checkAgent", () => {
  it("같은 번들이거나 앱이 기대값을 모르면 그대로 쓴다", () => {
    expect(checkAgent("abc", "abc", 3, false)).toBe("ok");
    expect(checkAgent(undefined, "old", 0, false)).toBe("ok");
  });

  it("예전 데몬(빌드 식별자가 다르거나 없음)이고 세션이 없으면 바꾼다", () => {
    expect(checkAgent("new", "old", 0, false)).toBe("replace");
    expect(checkAgent("new", undefined, 0, false)).toBe("replace");
  });

  it("세션이 돌고 있거나 이미 바꿔 봤으면 그대로 쓰며 업데이트 대기", () => {
    expect(checkAgent("new", "old", 1, false)).toBe("stale");
    expect(checkAgent("new", "old", 0, true)).toBe("stale");
  });
});

describe("staleAgentError", () => {
  it("모르는 메서드·잘못된 인자 거절은 Agent를 바꾸라는 안내로 바꾼다", () => {
    const hinted = staleAgentError(new JsonRpcError(ErrorCodes.InvalidParams, "kind는 prompt·skill·agents, scope는 user·project여야 합니다"));
    expect(hinted?.code).toBe(ErrorCodes.InvalidParams);
    expect(hinted?.message).toContain("지금 바꾸기");
    expect(hinted?.message).toContain("kind는 prompt·skill·agents");
    expect(staleAgentError(new JsonRpcError(ErrorCodes.MethodNotFound, "알 수 없는 메서드: resources.createPackage"))?.message).toContain("이전 버전");
  });

  it("그 밖의 오류는 그대로 둔다", () => {
    expect(staleAgentError(new JsonRpcError(ErrorCodes.InternalError, "x"))).toBeUndefined();
    expect(staleAgentError(new Error("x"))).toBeUndefined();
  });
});
