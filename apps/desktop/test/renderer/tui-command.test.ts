import { describe, expect, it } from "vitest";
import { tuiCommand } from "../../src/renderer/tui-command";

describe("tuiCommand", () => {
  it("Windows: PowerShell·Git Bash 공통 형식으로 작업 폴더 이동 후 세션을 연다", () => {
    expect(tuiCommand("windows", "C:\\Users\\me\\My Project", "C:\\Users\\me\\.pi\\agent\\sessions\\a.jsonl")).toBe(
      'cd "C:\\Users\\me\\My Project"; pi --session "C:\\Users\\me\\.pi\\agent\\sessions\\a.jsonl"',
    );
  });

  it("POSIX(WSL 등): 작은따옴표 인용, 따옴표가 든 경로도 안전하게", () => {
    expect(tuiCommand("posix", "/home/me/it's", "/home/me/.pi/agent/sessions/a.jsonl")).toBe(
      "cd '/home/me/it'\\''s' && pi --session '/home/me/.pi/agent/sessions/a.jsonl'",
    );
  });
});
