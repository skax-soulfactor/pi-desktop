import { describe, expect, it } from "vitest";
import { APP_SLASH_COMMANDS, parseAppSlash, splitModelArg, withAppCommands } from "../../src/renderer/app-commands";

const pi = [
  { name: "desktop:reload", source: "extension" },
  { name: "mcp", source: "extension" },
  { name: "export", description: "확장이 만든 export", source: "extension" },
];

describe("withAppCommands", () => {
  it("TUI 기본 명령을 앱 명령으로 더하고, Pi에 같은 이름이 있으면 Pi의 것만 둔다", () => {
    const merged = withAppCommands(pi);
    const names = merged.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["model", "compact", "tree", "new", "desktop:reload", "mcp"]));
    expect(merged.filter((c) => c.name === "export")).toEqual([pi[2]]);
    expect(merged.find((c) => c.name === "model")).toMatchObject({ source: "app", description: expect.stringContaining("[provider/model]") });
  });
});

describe("parseAppSlash·splitModelArg", () => {
  it("앱 명령과 인자를 가린다", () => {
    expect(parseAppSlash("/compact 테스트 결과만 남겨", pi)).toMatchObject({ command: { name: "compact" }, args: "테스트 결과만 남겨" });
    expect(parseAppSlash("/tree", pi)).toMatchObject({ command: { name: "tree" }, args: "" });
    expect(parseAppSlash("/name 새 이름\n둘째 줄", pi)?.args).toBe("새 이름\n둘째 줄");
    expect(parseAppSlash("/share", pi)?.command.unsupported).toBeDefined();
  });

  it("Pi 명령·모르는 명령·평범한 글은 Pi에 보낸다", () => {
    expect(parseAppSlash("/export", pi)).toBeUndefined();
    expect(parseAppSlash("/mcp", pi)).toBeUndefined();
    expect(parseAppSlash("/whatever", pi)).toBeUndefined();
    expect(parseAppSlash("모델을 /model 로 바꿔", pi)).toBeUndefined();
    expect(parseAppSlash("/models", pi)).toBeUndefined();
  });

  it("모델 인자는 첫 /로 나눈다", () => {
    expect(splitModelArg("openrouter/anthropic/claude")).toEqual({ provider: "openrouter", modelId: "anthropic/claude" });
    expect(splitModelArg("model-only")).toBeUndefined();
    expect(splitModelArg("/x")).toBeUndefined();
  });

  it("이름이 겹치지 않는다", () => {
    const names = APP_SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
