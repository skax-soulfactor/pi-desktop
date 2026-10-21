import { describe, expect, it } from "vitest";
import { cycleIndex, filterPalette, type PaletteCommand } from "../../src/renderer/palette";

const cmd = (id: string, group: string, title: string, extra: Partial<PaletteCommand> = {}): PaletteCommand => ({
  id,
  group,
  title,
  run: () => {},
  ...extra,
});

const commands = [
  cmd("tab-new", "탭", "새 탭", { hint: "Ctrl+T" }),
  cmd("compact", "세션", "대화 요약 (Compact)", { keywords: "compaction" }),
  cmd("abort", "세션", "중단", { disabled: true }),
  cmd("model-a", "모델", "Claude Sonnet", { hint: "anthropic" }),
  cmd("session-new", "세션", "새 세션 (같은 폴더)"),
];

describe("filterPalette", () => {
  it("검색어가 없으면 쓸 수 있는 명령을 원래 순서로", () => {
    expect(filterPalette(commands, "").map((c) => c.id)).toEqual(["tab-new", "compact", "model-a", "session-new"]);
  });

  it("제목·묶음·설명·키워드로 거르고, 제목이 첫 낱말로 시작하면 앞에", () => {
    expect(filterPalette(commands, "새").map((c) => c.id)).toEqual(["tab-new", "session-new"]);
    expect(filterPalette(commands, "compaction").map((c) => c.id)).toEqual(["compact"]);
    expect(filterPalette(commands, "anthropic").map((c) => c.id)).toEqual(["model-a"]);
    expect(filterPalette(commands, "세션 새").map((c) => c.id)).toEqual(["session-new"]);
    expect(filterPalette(commands, "중단")).toEqual([]);
  });
});

describe("cycleIndex", () => {
  it("끝에서는 반대쪽으로, 비면 -1", () => {
    expect(cycleIndex(3, 2, 1)).toBe(0);
    expect(cycleIndex(3, 0, -1)).toBe(2);
    expect(cycleIndex(0, 0, 1)).toBe(-1);
  });
});
