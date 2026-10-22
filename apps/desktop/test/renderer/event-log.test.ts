import { describe, expect, it } from "vitest";
import { EventLog, eventSummary, filterEvents, HANDLED_TYPES, typeCounts, typeOf, type LoggedEvent } from "../../src/renderer/event-log";

const n = (seq: number, event: unknown, sessionId = "s1") => ({ sessionId, seq, at: 1000 + seq, event });

describe("EventLog", () => {
  it("세션마다 모으고, 같은 seq는 한 번만, 오래된 것은 버린다", () => {
    const log = new EventLog(3);
    let changed = 0;
    log.subscribe(() => (changed += 1));
    log.add("local", n(1, { type: "agent_start" }));
    log.add("local", n(2, { type: "message_start" }));
    log.add("local", n(2, { type: "message_start" })); // 재연결 재생으로 다시 옴
    log.add("local", n(1, { type: "x" }, "s2"));
    expect(log.list("local", "s1").map((e) => e.seq)).toEqual([1, 2]);
    expect(log.list("local", "s2")).toHaveLength(1);
    log.add("local", n(3, {}));
    log.add("local", n(4, "raw text"));
    expect(log.list("local", "s1").map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(log.list("local", "s1").map((e) => e.type)).toEqual(["message_start", "(type 없음)", "(type 없음)"]);
    log.clear("local", "s1");
    expect(log.list("local", "s1")).toEqual([]);
    expect(changed).toBe(6);
  });
});

describe("eventSummary·typeOf", () => {
  it("눈에 띄는 필드로 한 줄 요약을 만든다", () => {
    expect(eventSummary({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } })).toBe(
      "assistant · text_delta",
    );
    expect(eventSummary({ type: "tool_execution_start", toolName: "bash", toolCallId: "call_abcdef123456" })).toBe("toolName=bash · #123456");
    expect(eventSummary({ type: "extension_ui_request", method: "confirm", title: "지울까요?" })).toBe("method=confirm · title=지울까요?");
    expect(eventSummary(42)).toBe("42");
    expect(typeOf({ type: "" })).toBe("(type 없음)");
    expect(HANDLED_TYPES.has("agent_settled")).toBe(true);
  });
});

describe("typeCounts·filterEvents", () => {
  const events: LoggedEvent[] = [
    { seq: 1, at: 0, type: "message_update", event: { type: "message_update", delta: "안녕" } },
    { seq: 2, at: 0, type: "message_update", event: { type: "message_update", delta: "hi" } },
    { seq: 3, at: 0, type: "tool_execution_start", event: { type: "tool_execution_start", toolName: "bash" } },
  ];

  it("종류별 개수는 많은 순", () => {
    expect(typeCounts(events)).toEqual([
      { type: "message_update", count: 2 },
      { type: "tool_execution_start", count: 1 },
    ]);
  });

  it("숨긴 종류를 빼고, 검색어는 종류와 원본 JSON에서 찾는다", () => {
    expect(filterEvents(events, new Set(["message_update"]), "").map((e) => e.seq)).toEqual([3]);
    expect(filterEvents(events, new Set(), "안녕").map((e) => e.seq)).toEqual([1]);
    expect(filterEvents(events, new Set(), "BASH").map((e) => e.seq)).toEqual([3]);
  });
});
