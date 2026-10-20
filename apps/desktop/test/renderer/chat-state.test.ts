import { describe, expect, it } from "vitest";
import { applyEvent, initialChatState, type ChatState } from "../../src/renderer/chat-state";

/** 이벤트 목록을 seq 1부터 차례로 적용한다. */
function run(events: unknown[], start: ChatState = initialChatState): ChatState {
  return events.reduce<ChatState>((state, event, i) => applyEvent(state, start.lastSeq + i + 1, event), start);
}

const textDelta = (delta: string, contentIndex = 0) => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", contentIndex, delta },
});

describe("applyEvent", () => {
  it("사용자 메시지와 스트리밍 응답을 조립하고 agent_settled에서 실행을 끝낸다", () => {
    const state = run([
      { type: "agent_start" },
      { type: "message_start", message: { role: "user", content: "안녕" } },
      { type: "message_start", message: { role: "assistant", content: [] } },
      textDelta("안"),
      textDelta("녕하세요"),
    ]);
    expect(state.running).toBe(true);
    expect(state.items).toMatchObject([
      { kind: "user", text: "안녕" },
      { kind: "assistant", blocks: [{ type: "text", text: "안녕하세요" }], done: false },
    ]);

    const settled = run([{ type: "agent_settled", aborted: false }], state);
    expect(settled.running).toBe(false);
    expect(settled.items[1]).toMatchObject({ done: true });
  });

  it("message_end의 확정본으로 델타 조립 결과를 교체한다", () => {
    const state = run([
      { type: "message_start", message: { role: "assistant", content: [] } },
      textDelta("틀린 중간 값"),
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "생각" },
            { type: "text", text: "최종" },
          ],
          stopReason: "stop",
        },
      },
    ]);
    expect(state.items[0]).toMatchObject({
      kind: "assistant",
      done: true,
      stopReason: "stop",
      blocks: [
        { type: "thinking", text: "생각" },
        { type: "text", text: "최종" },
      ],
    });
  });

  it("오류로 끝난 응답의 errorMessage를 보존한다", () => {
    const state = run([
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401" } },
    ]);
    expect(state.items[0]).toMatchObject({ stopReason: "error", errorMessage: "401" });
  });

  it("thinking과 text 블록을 contentIndex별로 따로 쌓는다", () => {
    const state = run([
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "음" } },
      textDelta("답", 1),
    ]);
    expect(state.items[0]).toMatchObject({
      blocks: [
        { type: "thinking", text: "음" },
        { type: "text", text: "답" },
      ],
    });
  });

  it("툴 실행 시작·진행·종료를 하나의 카드로 묶는다", () => {
    const state = run([
      { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } },
      {
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "a" }] },
      },
      {
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "a\nb" }] },
        isError: false,
        durationMs: 12,
      },
    ]);
    expect(state.items).toEqual([
      expect.objectContaining({
        kind: "tool",
        toolName: "bash",
        args: { command: "ls" },
        status: "done",
        output: "a\nb",
        durationMs: 12,
      }),
    ]);
  });

  it("툴 오류는 error 상태로 표시한다", () => {
    const state = run([
      { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: { content: [] }, isError: true },
    ]);
    expect(state.items[0]).toMatchObject({ status: "error" });
  });

  it("이미 반영한 seq의 이벤트는 무시한다 (재생 중복 방지)", () => {
    const once = applyEvent(initialChatState, 1, { type: "message_start", message: { role: "user", content: "a" } });
    const twice = applyEvent(once, 1, { type: "message_start", message: { role: "user", content: "a" } });
    expect(twice).toBe(once);
  });

  it("모르는 이벤트는 상태를 바꾸지 않고 seq만 올린다", () => {
    const state = applyEvent(initialChatState, 5, { type: "brand_new_event_from_future_pi" });
    expect(state.items).toEqual([]);
    expect(state.lastSeq).toBe(5);
  });
});

describe("applyEvent — 컴팩션·재시도 안내", () => {
  it("컴팩션 시작과 결과(토큰 감소)를 안내한다", () => {
    const state = run([
      { type: "compaction_start", reason: "threshold" },
      { type: "compaction_end", reason: "threshold", result: { tokensBefore: 150000, estimatedTokensAfter: 32000 } },
    ]);
    expect(state.items.map((i) => (i.kind === "notice" ? i.text : ""))).toEqual([
      "컨텍스트를 요약(컴팩션)하는 중… (컨텍스트 임계치 도달)",
      "요약 완료: 150k → 약 32k 토큰",
    ]);
  });

  it("컴팩션 실패는 오류로, 중단은 안내로 보여준다", () => {
    const failed = run([{ type: "compaction_end", reason: "manual", aborted: false, errorMessage: "boom" }]);
    expect(failed.items[0]).toMatchObject({ kind: "notice", level: "error", text: "요약 실패: boom" });
    const aborted = run([{ type: "compaction_end", reason: "manual", aborted: true }]);
    expect(aborted.items[0]).toMatchObject({ kind: "notice", level: "info", text: "요약을 중단했습니다." });
  });

  it("자동 재시도 시작과 최종 실패를 안내하고, 성공한 재시도는 조용히 넘어간다", () => {
    const state = run([
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "529 overloaded" },
      { type: "auto_retry_end", success: true, attempt: 2 },
      { type: "auto_retry_end", success: false, attempt: 3, finalError: "429" },
    ]);
    expect(state.items).toMatchObject([
      { kind: "notice", level: "info", text: "응답 오류로 2초 뒤 다시 시도합니다 (1/3): 529 overloaded" },
      { kind: "notice", level: "error", text: "재시도 실패: 429" },
    ]);
  });
});
