import { describe, expect, it } from "vitest";
import {
  baseName,
  htmlExportPath,
  formatCost,
  formatPercent,
  formatRelative,
  formatTokens,
  modelKey,
  parseModelKey,
} from "../../src/renderer/format";

describe("formatTokens", () => {
  it("크기에 따라 k, M 단위로 줄인다", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(12_300)).toBe("12.3k");
    expect(formatTokens(200_000)).toBe("200k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("값이 없으면 –", () => {
    expect(formatTokens(null)).toBe("–");
    expect(formatTokens(undefined)).toBe("–");
  });
});

describe("formatCost", () => {
  it("1센트 미만은 소수 넷째 자리까지", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0034)).toBe("$0.0034");
    expect(formatCost(0.45)).toBe("$0.45");
    expect(formatCost(12.3)).toBe("$12.30");
  });
});

describe("modelKey / parseModelKey", () => {
  it("프로바이더와 ID를 묶고 다시 나눈다", () => {
    const key = modelKey({ provider: "anthropic", id: "claude-haiku-5-5" });
    expect(parseModelKey(key)).toEqual({ provider: "anthropic", id: "claude-haiku-5-5" });
  });

  it("ID에 '/'가 있어도 첫 번째 '/'에서만 자른다", () => {
    expect(parseModelKey("openrouter/meta-llama/llama-4")).toEqual({ provider: "openrouter", id: "meta-llama/llama-4" });
  });

  it("형식이 잘못되면 undefined", () => {
    expect(parseModelKey("nomodel")).toBeUndefined();
    expect(parseModelKey("/x")).toBeUndefined();
    expect(parseModelKey("x/")).toBeUndefined();
  });
});

describe("formatPercent", () => {
  it("10% 미만은 소수 한 자리, 그 이상은 반올림", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.29)).toBe("0.3%");
    expect(formatPercent(4)).toBe("4%");
    expect(formatPercent(30.6)).toBe("31%");
    expect(formatPercent(null)).toBe("–");
  });
});

describe("formatRelative", () => {
  const now = new Date(2026, 9, 20, 12, 0, 0).getTime();
  it("지난 시간에 따라 방금·분·시간·일·날짜로 표시한다", () => {
    expect(formatRelative(now - 30_000, now)).toBe("방금");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5분 전");
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe("3시간 전");
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe("2일 전");
    expect(formatRelative(new Date(2026, 0, 5).getTime(), now)).toBe("2026-01-05");
  });
});

describe("baseName", () => {
  it("Windows와 POSIX 경로 모두에서 마지막 폴더 이름을 준다", () => {
    expect(baseName("C:\\Users\\me\\project\\")).toBe("project");
    expect(baseName("/home/me/app")).toBe("app");
    expect(baseName("/")).toBe("/");
  });
});

describe("htmlExportPath", () => {
  it("세션 파일 옆에 확장자만 html로", () => {
    expect(htmlExportPath(String.raw`C:\Users\me\.pi\agent\sessions\x\2026_abc.jsonl`)).toBe(
      String.raw`C:\Users\me\.pi\agent\sessions\x\2026_abc.html`,
    );
    expect(htmlExportPath("/home/me/.pi/agent/sessions/x/a.JSONL")).toBe("/home/me/.pi/agent/sessions/x/a.html");
    expect(htmlExportPath("/tmp/a")).toBe("/tmp/a.html");
    expect(htmlExportPath(undefined)).toBeUndefined();
  });
});
