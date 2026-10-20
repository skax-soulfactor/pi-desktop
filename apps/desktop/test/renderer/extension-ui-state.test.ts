import { describe, expect, it } from "vitest";
import {
  applyUiEvent,
  dialogResponse,
  dismissToast,
  FRESH_MS,
  initialExtensionUiState,
  prunePending,
  resolveDialog,
  type ExtensionUiState,
} from "../../src/renderer/extension-ui-state";

const NOW = 1_000_000;
const ui = (id: string, method: string, extra: Record<string, unknown> = {}) => ({
  type: "extension_ui_request",
  id,
  method,
  ...extra,
});

/** 이벤트를 seq 1부터 적용한다. 받은 시각은 기본적으로 지금. */
function run(events: Array<{ event: unknown; at?: number }>, start: ExtensionUiState = initialExtensionUiState) {
  return events.reduce(
    (state, { event, at }, i) => applyUiEvent(state, start.lastSeq + i + 1, at ?? NOW, event, NOW),
    start,
  );
}

describe("applyUiEvent — 다이얼로그", () => {
  it("select·confirm·input·editor 요청을 다이얼로그로 쌓는다", () => {
    const state = run([
      { event: ui("1", "select", { title: "고르세요", options: ["Allow", "Block"] }) },
      { event: ui("2", "confirm", { title: "확인", message: "정말요?" }) },
      { event: ui("3", "input", { title: "입력", placeholder: "여기에" }) },
      { event: ui("4", "editor", { title: "편집", prefill: "a\nb" }) },
    ]);
    expect(state.dialogs).toMatchObject([
      { id: "1", method: "select", title: "고르세요", options: ["Allow", "Block"] },
      { id: "2", method: "confirm", message: "정말요?" },
      { id: "3", method: "input", placeholder: "여기에" },
      { id: "4", method: "editor", prefill: "a\nb" },
    ]);
  });

  it("제한 시간이 이미 지난 다이얼로그는 띄우지 않는다", () => {
    const state = run([{ event: ui("1", "confirm", { title: "x", timeout: 5000 }), at: NOW - 6000 }]);
    expect(state.dialogs).toEqual([]);
  });

  it("처리된 다이얼로그를 닫고, 대기 목록에 없는 것은 걸러 낸다", () => {
    const state = run([{ event: ui("1", "input", { title: "a" }) }, { event: ui("2", "input", { title: "b" }) }]);
    expect(resolveDialog(state, "1").dialogs.map((d) => d.id)).toEqual(["2"]);
    expect(prunePending(state, ["2"]).dialogs.map((d) => d.id)).toEqual(["2"]);
    expect(prunePending(state, ["1", "2"])).toBe(state);
  });
});

describe("applyUiEvent — 알림", () => {
  it("방금 받은 notify는 토스트로, 오래된(재생된) notify는 무시한다", () => {
    const state = run([
      { event: ui("n1", "notify", { message: "막았습니다", notifyType: "warning" }) },
      { event: ui("n2", "notify", { message: "옛날 알림" }), at: NOW - FRESH_MS - 1 },
    ]);
    expect(state.toasts).toEqual([{ key: "n1", message: "막았습니다", level: "warning", at: NOW }]);
    expect(dismissToast(state, "n1").toasts).toEqual([]);
  });

  it("setStatus는 키별로 덮어쓰고, 텍스트가 없으면 지운다 (재생돼도 상태가 맞음)", () => {
    const state = run([
      { event: ui("a", "setStatus", { statusKey: "demo", statusText: "Turn 1" }), at: 0 },
      { event: ui("b", "setStatus", { statusKey: "demo", statusText: "Turn 2" }), at: 0 },
      { event: ui("c", "setStatus", { statusKey: "other", statusText: "x" }), at: 0 },
      { event: ui("d", "setStatus", { statusKey: "other" }), at: 0 },
    ]);
    expect(state.statuses).toEqual({ demo: "Turn 2" });
  });

  it("setWidget은 줄 목록과 위치를 저장하고, 줄이 없으면 지운다", () => {
    const state = run([
      { event: ui("a", "setWidget", { widgetKey: "w", widgetLines: ["1", "2"] }) },
      { event: ui("b", "setWidget", { widgetKey: "x", widgetLines: ["z"], widgetPlacement: "belowEditor" }) },
      { event: ui("c", "setWidget", { widgetKey: "x" }) },
    ]);
    expect(state.widgets).toEqual({ w: { lines: ["1", "2"], placement: "aboveEditor" } });
  });

  it("setTitle과 방금 받은 set_editor_text를 반영한다", () => {
    const state = run([
      { event: ui("t", "setTitle", { title: "pi RPC Demo" }) },
      { event: ui("e", "set_editor_text", { text: "채워 넣기" }) },
      { event: ui("old", "set_editor_text", { text: "옛날" }), at: 0 },
    ]);
    expect(state.title).toBe("pi RPC Demo");
    expect(state.editorText).toEqual({ text: "채워 넣기", seq: 2 });
  });

  it("확장 UI가 아닌 이벤트나 이미 반영한 seq는 무시한다", () => {
    const state = run([{ event: { type: "agent_start" } }]);
    expect(state).toMatchObject({ dialogs: [], toasts: [], lastSeq: 1 });
    expect(applyUiEvent(state, 1, NOW, ui("x", "input", { title: "y" }), NOW)).toBe(state);
  });
});

describe("dialogResponse", () => {
  const dialog = (method: "select" | "confirm" | "input" | "editor") => ({ id: "d", method, title: "", at: 0 });

  it("메서드에 맞는 응답 레코드를 만든다", () => {
    expect(dialogResponse(dialog("select"), { value: "Allow" })).toEqual({ type: "extension_ui_response", id: "d", value: "Allow" });
    expect(dialogResponse(dialog("confirm"), { confirmed: true })).toEqual({ type: "extension_ui_response", id: "d", confirmed: true });
    expect(dialogResponse(dialog("editor"), { value: "a\nb" })).toEqual({ type: "extension_ui_response", id: "d", value: "a\nb" });
    expect(dialogResponse(dialog("input"), { cancelled: true })).toEqual({ type: "extension_ui_response", id: "d", cancelled: true });
  });
});

describe("applyUiEvent — 재생 구분", () => {
  it("재생 중에 들어온 notify·set_editor_text는 방금 받았더라도 무시하고, 상태는 반영한다", () => {
    let state = initialExtensionUiState;
    state = applyUiEvent(state, 1, NOW, ui("n", "notify", { message: "옛 알림" }), NOW, true);
    state = applyUiEvent(state, 2, NOW, ui("e", "set_editor_text", { text: "옛 글" }), NOW, true);
    state = applyUiEvent(state, 3, NOW, ui("s", "setStatus", { statusKey: "k", statusText: "v" }), NOW, true);
    state = applyUiEvent(state, 4, NOW, ui("d", "confirm", { title: "대기 중" }), NOW, true);
    expect(state.toasts).toEqual([]);
    expect(state.editorText).toBeUndefined();
    expect(state.statuses).toEqual({ k: "v" });
    expect(state.dialogs.map((d) => d.id)).toEqual(["d"]);
  });
});
