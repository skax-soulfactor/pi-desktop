import { describe, expect, it } from "vitest";
import { definitionProblems } from "@pi-desktop/agent-kit/tunables-core";
import { APP_TUNABLES } from "../src/shared/app-tunables";

describe("Agent 앱 수치", () => {
  it("정의가 스스로 맞다", () => {
    expect(definitionProblems(APP_TUNABLES)).toEqual([]);
    expect(APP_TUNABLES.every((d) => d.id.startsWith("app."))).toBe(true);
  });
});
