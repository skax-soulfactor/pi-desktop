import { describe, expect, it } from "vitest";
import type { TunableItem } from "@pi-desktop/agent-kit/tunables-core";
import { draftProblem, formatValue, groupTunables, missingPlaceholders, preview, rangeText } from "../src/tunables-view";

const item = (over: Partial<TunableItem>): TunableItem => ({
  id: "a.b",
  group: "웹",
  label: "기다리는 시간",
  purpose: "응답을 기다린다",
  kind: "number",
  default: 20,
  value: 20,
  unit: "초",
  min: 3,
  max: 300,
  integer: true,
  overridden: false,
  source: "x.ts",
  ...over,
});

describe("tunables-view", () => {
  it("찾기·거르기 뒤 정의 순서대로 묶는다", () => {
    const items = [
      item({ id: "1", group: "웹" }),
      item({ id: "2", group: "예약", label: "확인 간격", overridden: true, value: 60 }),
      item({ id: "3", group: "웹", locked: "보안 한도", label: "크기" }),
    ];
    expect(groupTunables(items, "", "all").map((g) => [g.name, g.items.map((i) => i.id)])).toEqual([
      ["웹", ["1", "3"]],
      ["예약", ["2"]],
    ]);
    expect(groupTunables(items, "", "changed").flatMap((g) => g.items.map((i) => i.id))).toEqual(["2"]);
    expect(groupTunables(items, "", "locked").flatMap((g) => g.items.map((i) => i.id))).toEqual(["3"]);
    expect(groupTunables(items, "", "editable").flatMap((g) => g.items.map((i) => i.id))).toEqual(["1", "2"]);
    expect(groupTunables(items, "확인 간격", "all").flatMap((g) => g.items.map((i) => i.id))).toEqual(["2"]);
  });

  it("값과 범위를 단위와 함께 보인다", () => {
    expect(formatValue(item({}), 20_000)).toBe("20,000초");
    expect(formatValue(item({ unit: "ms" }), 1500)).toBe("1,500 ms");
    expect(rangeText(item({}))).toBe("3초 ~ 300초, 정수");
    expect(rangeText(item({ locked: "x" }))).toBeUndefined();
  });

  it("저장 전에 문제와 빠진 자리표시를 알려 준다", () => {
    expect(draftProblem(item({}), "2")).toContain("이상");
    expect(draftProblem(item({}), "30")).toBeUndefined();
    const text = item({ kind: "text", default: "{{dutyName}} 임무", value: "{{dutyName}} 임무", placeholders: { dutyName: "임무 이름" } });
    expect(missingPlaceholders(text, "임무")).toEqual(["dutyName"]);
    expect(draftProblem(text, "  ")).toContain("비어");
    expect(preview("첫 줄\n둘째 줄")).toBe("첫 줄");
  });
});
