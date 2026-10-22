import { describe, expect, it } from "vitest";
import { appendOutput, EXAMPLES, insertIndent, resultText } from "../../src/renderer/playground-view";

describe("appendOutput", () => {
  it("이어 온 같은 종류는 하나로 붙인다", () => {
    let chunks = appendOutput([], { stream: "stdout", text: "a" });
    chunks = appendOutput(chunks, { stream: "stdout", text: "b" });
    chunks = appendOutput(chunks, { stream: "stderr", text: "x" });
    chunks = appendOutput(chunks, { stream: "stdout", text: "c" });
    expect(chunks).toEqual([
      { stream: "stdout", text: "ab" },
      { stream: "stderr", text: "x" },
      { stream: "stdout", text: "c" },
    ]);
  });
});

describe("resultText·insertIndent·EXAMPLES", () => {
  it("결과를 한 줄로", () => {
    expect(resultText({ exitCode: 0, durationMs: 1234, timedOut: false, truncated: false })).toBe("종료 코드 0 · 1.23초");
    expect(resultText({ exitCode: null, durationMs: 120_000, timedOut: true, truncated: true })).toBe("제한 시간을 넘어 멈춤 · 120.0초 · 출력이 너무 많아 잘림");
    expect(resultText({ exitCode: null, signal: "SIGTERM", durationMs: 500, timedOut: false, truncated: false })).toBe("멈춤 (SIGTERM) · 0.50초");
  });

  it("Tab은 공백 두 칸", () => {
    expect(insertIndent("ab", 1, 1)).toEqual({ text: "a  b", cursor: 3 });
    expect(insertIndent("abcd", 1, 3)).toEqual({ text: "a  d", cursor: 3 });
  });

  it("예제는 모두 pi를 쓰는 스크립트다", () => {
    for (const e of EXAMPLES) expect(e.code).toMatch(/\bpi\b/);
  });
});
