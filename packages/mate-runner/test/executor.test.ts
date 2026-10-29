import { describe, expect, it } from "vitest";
import { EventSummary, piArgs, piEnv } from "../src/executor";
import type { Duty } from "../src/types";

const duty: Duty = {
  id: "ci",
  name: "CI 확인",
  enabled: true,
  cwd: ".",
  prompt: "CI를 봐",
  profile: "observe",
  trigger: { kind: "manual" },
  createdAt: 0,
};
const input = {
  duty,
  runId: "r1",
  model: "anthropic/claude-haiku-5-5",
  extensions: ["/kit/a.ts"],
  inboxPath: "/h/inbox.jsonl",
  sessionsDir: "/h/sessions",
  timeoutSec: 60,
  maxCostUsd: 0,
};

describe("piArgs", () => {
  it("모델을 정하지 않으면 --model을 넘기지 않아 Pi 기본 모델을 따른다", () => {
    expect(piArgs(input)).toContain("--model");
    expect(piArgs({ ...input, model: "" })).not.toContain("--model");
  });

  it("권한 단계에 맞는 도구만 선언하고 지시는 마지막 인자", () => {
    const observe = piArgs(input);
    expect(observe.slice(0, 4)).toEqual(["--mode", "json", "--session-dir", "/h/sessions"]);
    expect(observe[observe.indexOf("--tools") + 1]).toBe("read,grep,find,ls,bash");
    expect(observe.at(-1)).toBe("CI를 봐");
    const propose = piArgs({ ...input, duty: { ...duty, profile: "propose" } });
    expect(propose[propose.indexOf("--tools") + 1]).toBe("read,grep,find,ls,bash,mate_propose");
    expect(propose[propose.indexOf("--append-system-prompt") + 1]).toContain("mate_propose");
    expect(piEnv(input, "observe")).toMatchObject({ PI_DESKTOP_MATE_PROFILE: "observe", PI_DESKTOP_MATE_DUTY: "ci" });
    // 관찰자 실행은 제안에 붙일 주제를 넘긴다
    expect(piEnv({ ...input, topic: "untested-edit" }, "propose")).toMatchObject({ PI_DESKTOP_MATE_TOPIC: "untested-edit" });
    expect(piEnv(input, "observe")).not.toHaveProperty("PI_DESKTOP_MATE_TOPIC");
  });
});

describe("EventSummary", () => {
  it("세션 id, 마지막 답변, 비용, 새 제안 수를 모은다", () => {
    const s = new EventSummary();
    const usage = (tokens: number, cost: number) => ({ totalTokens: tokens, cost: { total: cost } });
    const lines = [
      { type: "session", id: "sess-1" },
      { type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [], usage: usage(10, 0.001) } },
      { type: "tool_execution_end", toolName: "mate_propose", isError: false, result: { details: { added: true } } },
      { type: "tool_execution_end", toolName: "mate_propose", isError: false, result: { details: { added: false } } },
      {
        type: "message_end",
        message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "요약입니다" }], usage: usage(5, 0.002) },
      },
      { type: "agent_settled", aborted: false },
    ];
    for (const l of lines) s.push(JSON.stringify(l));
    s.push("not json");
    expect(s).toMatchObject({ sessionId: "sess-1", lastText: "요약입니다", tokens: 15, proposals: 1, settled: true, errorMessage: undefined });
    expect(s.costUsd).toBeCloseTo(0.003);
  });

  it("모델 오류로 끝나면 오류를 남긴다", () => {
    const s = new EventSummary();
    s.push(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Connection error", content: [] } }));
    expect(s.errorMessage).toBe("Connection error");
  });
});
