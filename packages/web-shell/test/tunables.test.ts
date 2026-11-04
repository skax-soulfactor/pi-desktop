import { describe, expect, it } from "vitest";
import { definitionProblems } from "@pi-desktop/agent-kit/tunables-core";
import { WEB_TUNABLES } from "../src/tunables-defs";

describe("휴대폰 웹 정의", () => {
  it("정의가 스스로 맞고, 모두 까닭이 있는 읽기 전용이다", () => {
    expect(definitionProblems(WEB_TUNABLES)).toEqual([]);
    for (const def of WEB_TUNABLES) expect(def.locked?.length ?? 0).toBeGreaterThan(10);
  });
});
