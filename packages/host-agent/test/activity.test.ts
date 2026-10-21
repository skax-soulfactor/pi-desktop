import { describe, expect, it } from "vitest";
import { ActivityTracker, TITLE_LIMIT } from "../src/activity";

const userMessage = (content: unknown) => ({ type: "message_start", message: { role: "user", content } });

describe("ActivityTracker", () => {
  it("agent_start ~ agent_settled 동안 busy", () => {
    const t = new ActivityTracker();
    t.observe({ type: "agent_start" });
    expect(t.busy).toBe(true);
    t.observe({ type: "agent_end" });
    expect(t.busy).toBe(true); // 재시도·큐가 남았을 수 있다
    t.observe({ type: "agent_settled" });
    expect(t.busy).toBe(false);
  });

  it("제목은 이름이 있으면 이름, 없으면 첫 질문 (공백 정리, 길면 자름)", () => {
    const t = new ActivityTracker();
    t.observe(userMessage([{ type: "text", text: "인증\n  버그 고쳐줘" }, { type: "image", data: "x" }]));
    t.observe(userMessage("두 번째 질문"));
    expect(t.title).toBe("인증 버그 고쳐줘");
    t.setName("  인증 작업 ");
    expect(t.title).toBe("인증 작업");
    t.setName("");
    expect(t.title).toBe("인증 버그 고쳐줘");

    const long = new ActivityTracker();
    long.observe(userMessage("가".repeat(TITLE_LIMIT + 5)));
    expect(long.title).toBe(`${"가".repeat(TITLE_LIMIT)}…`);
  });

  it("다른 세션 파일로 옮기면 제목을 비우고 다음 질문부터 다시 잡는다", () => {
    const t = new ActivityTracker();
    t.setName("옛 이름");
    t.observe(userMessage("옛 질문"));
    t.resetForNewSession();
    expect(t.title).toBeUndefined();
    t.observe(userMessage("새 질문"));
    expect(t.title).toBe("새 질문");
  });
});
