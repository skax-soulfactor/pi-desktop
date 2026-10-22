import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";
import {
  activityCounts,
  activityState,
  activityTitle,
  collectActivity,
  tabShowing,
  terminalActionDetail,
} from "../../src/renderer/activity-view";

const session = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: id,
  cwd: "/home/me/proj",
  state: "running",
  lastSeq: 0,
  piVersion: "1.3.0",
  startedAt: 0,
  pendingUi: 0,
  busy: false,
  ...over,
});

describe("activityState", () => {
  it("종료 > 입력 필요(다이얼로그·끼어들기) > 작업 중 > 대기", () => {
    expect(activityState(session("a", { state: "exited", pendingUi: 1 }))).toBe("exited");
    expect(activityState(session("a", { pendingUi: 1, busy: true }))).toBe("input");
    expect(activityState(session("a", { externalWriteAt: 1 }))).toBe("input");
    expect(activityState(session("a", { busy: true }))).toBe("busy");
    expect(activityState(session("a"))).toBe("idle");
  });
});

describe("collectActivity", () => {
  it("호스트를 모아 상태 순, 같으면 최근에 시작한 것부터", () => {
    const entries = collectActivity([
      { hostId: "local", hostLabel: "로컬", sessions: [session("idle-old", { startedAt: 1 }), session("busy", { busy: true })] },
      { hostId: "wsl:U", hostLabel: "WSL", sessions: [session("idle-new", { startedAt: 5 }), session("ask", { pendingUi: 1 })] },
    ]);
    expect(entries.map((e) => e.session.sessionId)).toEqual(["ask", "busy", "idle-new", "idle-old"]);
    expect(entries[0]).toMatchObject({ hostId: "wsl:U", hostLabel: "WSL", state: "input" });
    expect(activityCounts(entries)).toEqual({ input: 1, busy: 1 });
  });
});

describe("tabShowing·activityTitle", () => {
  it("같은 호스트·세션을 보는 탭을 찾는다", () => {
    const statuses = { main: { hostId: "local", sessionId: "a" }, t1: { hostId: "wsl:U", sessionId: "a" }, t2: undefined };
    expect(tabShowing(statuses, "wsl:U", "a")).toBe("t1");
    expect(tabShowing(statuses, "local", "b")).toBeUndefined();
  });

  it("제목이 없으면 작업 폴더 이름", () => {
    expect(activityTitle(session("a", { title: "인증 작업" }))).toBe("인증 작업");
    expect(activityTitle(session("a", { cwd: "C:\\work\\api\\" }))).toBe("api");
  });
});

describe("terminalActionDetail", () => {
  it("대신 실행하는 명령만 글로 만든다", () => {
    expect(terminalActionDetail({ kind: "pi", args: ["install", "npm:pi-tools", "-l"] })).toBe("pi install npm:pi-tools -l");
    expect(terminalActionDetail({ kind: "pi", initialInput: "/login anthropic\r" })).toBe("pi (입력: /login anthropic)");
    expect(terminalActionDetail({ kind: "shell", initialInput: "npm install -g x\r" })).toBe("npm install -g x");
    expect(terminalActionDetail({ kind: "shell" })).toBeUndefined();
    expect(terminalActionDetail({ kind: "pi" })).toBeUndefined();
  });
});
