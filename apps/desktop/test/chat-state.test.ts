import { describe, expect, it } from "vitest";
import { applyEvent, initialChatState, type ChatState } from "../src/renderer/chat-state";

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
