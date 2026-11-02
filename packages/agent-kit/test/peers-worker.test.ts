import { afterEach, describe, expect, it, vi } from "vitest";
import peers from "../extensions/peers/index";
import { SCHEDULER_ENV, WORKER_ENV } from "../src/runtime";

/** 확장이 무엇을 등록하는지만 세는 가짜 Pi */
function fakePi() {
  return { on: vi.fn(), registerTool: vi.fn(), registerCommand: vi.fn() };
}

describe("피어 확장 — 워커에서는 돌지 않는다", () => {
  afterEach(() => {
    delete process.env[WORKER_ENV];
    delete process.env[SCHEDULER_ENV];
  });

  it("스케줄러가 띄운 워커(두 표시가 다 켜짐)는 피어 서버·동기화를 띄우지 않는다", () => {
    // 받은 작업의 워커는 스케줄러의 환경 변수를 물려받아 스케줄러 표시도 켜져 있다
    process.env[SCHEDULER_ENV] = "1";
    process.env[WORKER_ENV] = "1";
    const pi = fakePi();
    peers(pi as never);
    expect(pi.on).not.toHaveBeenCalled();
    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it("스케줄러 세션은 피어 서버를 띄운다", () => {
    process.env[SCHEDULER_ENV] = "1";
    const pi = fakePi();
    peers(pi as never);
    expect(pi.on.mock.calls.map((c) => c[0])).toContain("session_start");
  });
});
