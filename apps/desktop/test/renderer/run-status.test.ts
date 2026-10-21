import { describe, expect, it } from "vitest";
import type { ChatItem } from "../../src/renderer/chat-state";
import { resendCandidate, restoreQueueToDraft, secondsLeft } from "../../src/renderer/run-status";

describe("restoreQueueToDraft", () => {
  it("Steer, Follow-up, 쓰던 초안 순으로 빈 줄을 두고 합친다", () => {
    expect(restoreQueueToDraft({ steering: ["방향"], followUp: ["요약", " "] }, "쓰던 글")).toBe("방향\n\n요약\n\n쓰던 글");
    expect(restoreQueueToDraft(undefined, "쓰던 글")).toBe("쓰던 글");
    expect(restoreQueueToDraft({ followUp: ["요약"] }, "")).toBe("요약");
  });
});

describe("resendCandidate", () => {
  const user = (key: string, text: string): ChatItem => ({ kind: "user", key, text });
  const assistant = (key: string, stopReason?: string): ChatItem => ({
    kind: "assistant",
    key,
    blocks: [],
    done: true,
    ...(stopReason ? { stopReason } : {}),
  });

  it("마지막 응답이 오류면 그 앞 사용자 메시지를 돌려준다 (사이에 툴 카드가 있어도)", () => {
    const tool: ChatItem = { kind: "tool", key: "t", toolCallId: "c", toolName: "read", args: {}, status: "done", output: "" };
    expect(resendCandidate([user("u1", "질문"), tool, assistant("a1", "error")])).toEqual({ anchorKey: "a1", text: "질문" });
  });

  it("재시도를 취소해 오류 안내로 끝났으면 그 안내에 붙인다", () => {
    const notice: ChatItem = { kind: "notice", key: "n1", level: "error", text: "재시도 실패: Retry cancelled" };
    const info: ChatItem = { kind: "notice", key: "n0", level: "info", text: "다시 시도합니다" };
    expect(resendCandidate([user("u1", "질문"), info, notice])).toEqual({ anchorKey: "n1", text: "질문" });
  });

  it("오류가 아니거나, 오류 뒤에 대화가 이어졌으면 없음", () => {
    expect(resendCandidate([user("u1", "질문"), assistant("a1")])).toBeUndefined();
    expect(resendCandidate([user("u1", "질문"), assistant("a1", "error"), user("u2", "다음")])).toBeUndefined();
    expect(resendCandidate([assistant("a1", "error")])).toBeUndefined();
  });
});

describe("secondsLeft", () => {
  it("올림한 초, 지나면 0", () => {
    expect(secondsLeft(10_500, 9_000)).toBe(2);
    expect(secondsLeft(1_000, 2_000)).toBe(0);
  });
});
