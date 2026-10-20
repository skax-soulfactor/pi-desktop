import { describe, expect, it } from "vitest";
import { formatCost, formatPercent, formatTokens, modelKey, parseModelKey } from "../../src/renderer/format";

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
