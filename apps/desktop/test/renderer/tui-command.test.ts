import { describe, expect, it } from "vitest";
import { piSessionIdOf, tuiCommand } from "../../src/renderer/tui-command";

describe("tuiCommand", () => {
  it("Windows: PowerShell·Git Bash 공통 형식으로 작업 폴더 이동 후 세션을 연다", () => {
    expect(tuiCommand("windows", "C:\\Users\\me\\My Project", { sessionFile: "C:\\Users\\me\\.pi\\agent\\sessions\\a.jsonl" })).toBe(
      'cd "C:\\Users\\me\\My Project"; pi --session "C:\\Users\\me\\.pi\\agent\\sessions\\a.jsonl"',
    );
  });

  it("POSIX(WSL 등): 작은따옴표 인용, 따옴표가 든 경로도 안전하게", () => {
    expect(tuiCommand("posix", "/home/me/it's", { sessionFile: "/home/me/.pi/agent/sessions/a.jsonl" })).toBe(
      "cd '/home/me/it'\\''s' && pi --session '/home/me/.pi/agent/sessions/a.jsonl'",
    );
  });
});

describe("세션 파일이 아직 없을 때", () => {
  it("같은 세션 ID로 연다 (--session-id는 없으면 만든다)", () => {
    expect(tuiCommand("posix", "/home/me", { sessionId: "01a16211-29b9" })).toBe("cd '/home/me' && pi --session-id '01a16211-29b9'");
    expect(tuiCommand("windows", "C:\\p", { sessionId: "abc" })).toBe('cd "C:\\p"; pi --session-id "abc"');
  });

  it("파일 이름에서 Pi 세션 ID를 꺼낸다", () => {
    expect(piSessionIdOf("/home/me/.pi/agent/sessions/--home--/2026-10-22T05-24-14-394Z_01a16211-29b9-7291-881e-006b6f49ab17.jsonl")).toBe(
      "01a16211-29b9-7291-881e-006b6f49ab17",
    );
    expect(piSessionIdOf("C:\\s\\2026-10-22T05-24-14-394Z_abc.jsonl")).toBe("abc");
    expect(piSessionIdOf("/x/notes.txt")).toBeUndefined();
  });
});
