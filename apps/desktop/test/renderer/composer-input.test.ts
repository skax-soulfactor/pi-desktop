import { describe, expect, it } from "vitest";
import {
  filterCommands,
  HISTORY_LIMIT,
  parseInput,
  pushHistory,
  shouldNavigateHistory,
  slashQuery,
  stepHistory,
} from "../../src/renderer/composer-input";

describe("parseInput", () => {
  it("일반 글은 prompt, 빈 글은 empty", () => {
    expect(parseInput("  안녕  ")).toEqual({ kind: "prompt", message: "안녕" });
    expect(parseInput("  \n ")).toEqual({ kind: "empty" });
  });

  it("!는 컨텍스트에 넣는 셸 명령, !!는 넣지 않는 셸 명령", () => {
    expect(parseInput("!ls -la")).toEqual({ kind: "bash", command: "ls -la", excludeFromContext: false });
    expect(parseInput("!! git status ")).toEqual({ kind: "bash", command: "git status", excludeFromContext: true });
    expect(parseInput("!!")).toEqual({ kind: "empty" });
  });

  it("/명령은 Pi가 처리하므로 prompt 그대로 보낸다", () => {
    expect(parseInput("/fix-tests now")).toEqual({ kind: "prompt", message: "/fix-tests now" });
  });
});

describe("/ 자동완성", () => {
  it("첫 단어를 치는 중일 때만 검색어를 돌려준다", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/sk")).toBe("sk");
    expect(slashQuery("/skill:x arg")).toBeUndefined();
    expect(slashQuery("hi /x")).toBeUndefined();
  });

  it("이름이 검색어로 시작하는 명령을 먼저, 설명에만 있는 명령을 뒤에", () => {
    const commands = [
      { name: "review", description: "코드 리뷰", source: "prompt" },
      { name: "skill:test-runner", description: "run tests", source: "skill" },
      { name: "test", description: "테스트", source: "prompt" },
    ];
    expect(filterCommands(commands, "te").map((c) => c.name)).toEqual(["test", "skill:test-runner"]);
    expect(filterCommands(commands, "리뷰").map((c) => c.name)).toEqual(["review"]);
    expect(filterCommands(commands, "").map((c) => c.name)).toEqual(["review", "skill:test-runner", "test"]);
  });
});

describe("입력 히스토리", () => {
  it("바로 앞과 같은 입력은 다시 넣지 않고, 개수를 제한한다", () => {
    expect(pushHistory(["a"], " a ")).toEqual(["a"]);
    expect(pushHistory(["a"], "b")).toEqual(["a", "b"]);
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => String(i));
    expect(pushHistory(full, "new")).toHaveLength(HISTORY_LIMIT);
  });

  it("↑·↓는 히스토리 끝(초안 자리)과 처음을 넘지 않는다", () => {
    expect(stepHistory(["a", "b"], 2, -1)).toBe(1);
    expect(stepHistory(["a", "b"], 0, -1)).toBeUndefined();
    expect(stepHistory(["a", "b"], 2, 1)).toBeUndefined();
  });

  it("여러 줄이면 커서가 첫 줄에서만 ↑, 마지막 줄에서만 ↓로 히스토리를 오간다", () => {
    const text = "one\ntwo";
    expect(shouldNavigateHistory(text, 2, -1)).toBe(true);
    expect(shouldNavigateHistory(text, 5, -1)).toBe(false);
    expect(shouldNavigateHistory(text, 5, 1)).toBe(true);
    expect(shouldNavigateHistory(text, 2, 1)).toBe(false);
  });
});
