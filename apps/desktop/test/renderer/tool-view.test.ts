import { describe, expect, it } from "vitest";
import {
  diffStats,
  editLines,
  editPreview,
  parsePatch,
  resultLineCount,
  shellExitCode,
  shellOutput,
  toolKind,
  toolTarget,
  writePreview,
} from "../../src/renderer/tool-view";

// Pi 1.3.0 edit 툴이 실제로 돌려준 patch
const PATCH = "--- a.txt\n+++ a.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line 2 changed\n line three\n";

describe("parsePatch", () => {
  it("머리글을 빼고 줄 번호를 붙인다", () => {
    expect(parsePatch(PATCH)).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "ctx", text: "line one", oldNo: 1, newNo: 1 },
      { kind: "del", text: "line two", oldNo: 2 },
      { kind: "add", text: "line 2 changed", newNo: 2 },
      { kind: "ctx", text: "line three", oldNo: 3, newNo: 3 },
    ]);
  });

  it("여러 hunk와 줄 끝 안내를 처리한다", () => {
    const lines = parsePatch("@@ -10 +10,2 @@\n-a\n+b\n+c\n\\ No newline at end of file\n@@ -40,1 +41,1 @@\n x\n");
    expect(lines.filter((l) => l.kind === "add").map((l) => l.newNo)).toEqual([10, 11]);
    expect(lines.at(-1)).toEqual({ kind: "ctx", text: "x", oldNo: 40, newNo: 41 });
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });
});

describe("edit·write 미리보기", () => {
  const args = { path: "a.txt", edits: [{ oldText: "x\ny\n", newText: "z" }] };

  it("patch가 없으면 인자의 oldText·newText로 보여준다", () => {
    expect(editPreview(args)).toEqual([
      { kind: "del", text: "x" },
      { kind: "del", text: "y" },
      { kind: "add", text: "z" },
    ]);
    expect(editLines(args, undefined)).toEqual(editPreview(args));
    expect(editLines(args, { patch: PATCH })).toEqual(parsePatch(PATCH));
  });

  it("여러 변경은 구분선을 넣고, 모르는 모양이면 빈 목록", () => {
    const two = editPreview({ edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] });
    expect(two.filter((l) => l.kind === "hunk").map((l) => l.text)).toEqual(["변경 1/2", "변경 2/2"]);
    expect(editPreview({ edits: "nope" })).toEqual([]);
    expect(editPreview(undefined)).toEqual([]);
  });

  it("write 내용은 줄 번호가 붙은 추가 줄", () => {
    expect(writePreview({ path: "b.txt", content: "hello\nworld\n" })).toEqual([
      { kind: "add", text: "hello", newNo: 1 },
      { kind: "add", text: "world", newNo: 2 },
    ]);
  });
});

describe("셸 툴", () => {
  it("종료 코드는 이벤트 값 우선, 없으면 결과 끝 안내에서 읽는다", () => {
    const text = "hi\n\n\nCommand exited with code 3";
    expect(shellExitCode(3, text)).toBe(3);
    expect(shellExitCode(undefined, text)).toBe(3);
    expect(shellExitCode(undefined, "hi\n")).toBeUndefined();
    expect(shellOutput(text)).toBe("hi\n");
  });
});

describe("toolKind·toolTarget", () => {
  it("툴 이름으로 종류를 고른다", () => {
    expect(["edit", "write", "bash", "powershell", "read", "grep", "find", "ls", "mcp__x"].map(toolKind)).toEqual([
      "edit",
      "write",
      "shell",
      "shell",
      "read",
      "search",
      "search",
      "search",
      "generic",
    ]);
  });

  it("카드 머리에 보여줄 대상", () => {
    expect(toolTarget("read", { path: "a.ts", offset: 10, limit: 5 })).toBe("a.ts (10–14줄)");
    expect(toolTarget("read", { path: "a.ts", offset: 10 })).toBe("a.ts (10줄부터)");
    expect(toolTarget("grep", { pattern: "TODO", path: "src", glob: "*.ts" })).toBe("TODO in src (*.ts)");
    expect(toolTarget("ls", {})).toBe(".");
    expect(toolTarget("edit", { path: "a.txt" })).toBe("a.txt");
    expect(toolTarget("mcp__x", { query: { q: 1 } })).toBe('{"q":1}');
    expect(toolTarget("mcp__x", null)).toBe("");
  });

  it("결과 줄 수", () => {
    expect(resultLineCount("a.txt\nb.txt\n")).toBe(2);
    expect(resultLineCount("  ")).toBe(0);
    // Pi 1.3.0 read 결과 끝의 안내는 세지 않는다
    expect(resultLineCount("line 2\nline 3\n\n[1 more lines in file. Use offset=4 to continue.]")).toBe(2);
  });
});
