import { describe, expect, it } from "vitest";
import { matchesQuery, normalizeSessionName } from "../../src/renderer/session-search";

describe("matchesQuery", () => {
  const fields = ["인증 리팩터링", "Fix login bug", "C:\\work\\api"];

  it("모든 낱말이 어느 필드에든 있으면 맞다 (대소문자 무시)", () => {
    expect(matchesQuery("login 인증", fields)).toBe(true);
    expect(matchesQuery("API", fields)).toBe(true);
    expect(matchesQuery("login 결제", fields)).toBe(false);
  });

  it("빈 검색어는 모두 맞고, 빈 필드는 건너뛴다", () => {
    expect(matchesQuery("  ", fields)).toBe(true);
    expect(matchesQuery("x", [undefined, ""])).toBe(false);
  });
});

describe("normalizeSessionName", () => {
  it("공백을 정리하고, 비면 undefined", () => {
    expect(normalizeSessionName("  인증\n  작업 ")).toBe("인증 작업");
    expect(normalizeSessionName(" \n ")).toBeUndefined();
  });
});
