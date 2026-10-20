import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingDialogs } from "../src/pending-dialogs";

const request = (id: string, method: string, extra: Record<string, unknown> = {}) => ({
  type: "extension_ui_request",
  id,
  method,
  title: "t",
  ...extra,
});

describe("PendingDialogs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("다이얼로그 요청(select·confirm·input·editor)만 추가한다", () => {
    const dialogs = new PendingDialogs(() => {});
    for (const method of ["select", "confirm", "input", "editor"]) dialogs.observe(request(method, method));
    for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]) {
      dialogs.observe(request(method, method));
    }
    dialogs.observe({ type: "agent_start" });
    dialogs.observe(null);
    expect(dialogs.ids().sort()).toEqual(["confirm", "editor", "input", "select"]);
  });

  it("응답하면 제거하고 알린다. 모르는 id는 무시한다", () => {
    const resolved: string[] = [];
    const dialogs = new PendingDialogs((id) => resolved.push(id));
    dialogs.observe(request("a", "confirm"));
    expect(dialogs.resolve("a")).toBe(true);
    expect(dialogs.resolve("a")).toBe(false);
    expect(dialogs.resolve("zzz")).toBe(false);
    expect(resolved).toEqual(["a"]);
    expect(dialogs.size).toBe(0);
  });

  it("timeout이 있으면 그 시간에 자동으로 제거한다 (Pi가 기본값으로 처리하므로)", () => {
    vi.useFakeTimers();
    const resolved: string[] = [];
    const dialogs = new PendingDialogs((id) => resolved.push(id));
    dialogs.observe(request("t", "select", { timeout: 5000 }));
    vi.advanceTimersByTime(4999);
    expect(dialogs.ids()).toEqual(["t"]);
    vi.advanceTimersByTime(1);
    expect(dialogs.ids()).toEqual([]);
    expect(resolved).toEqual(["t"]);
  });

  it("clear()는 남은 다이얼로그를 모두 처리됨으로 알린다 (Pi 종료 시)", () => {
    const resolved: string[] = [];
    const dialogs = new PendingDialogs((id) => resolved.push(id));
    dialogs.observe(request("a", "input"));
    dialogs.observe(request("b", "editor"));
    dialogs.clear();
    expect(resolved.sort()).toEqual(["a", "b"]);
    expect(dialogs.size).toBe(0);
  });
});
