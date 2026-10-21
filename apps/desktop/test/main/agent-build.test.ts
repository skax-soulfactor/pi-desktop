import { describe, expect, it } from "vitest";
import { agentBuildId, checkAgent } from "../../src/main/agent-build";
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
