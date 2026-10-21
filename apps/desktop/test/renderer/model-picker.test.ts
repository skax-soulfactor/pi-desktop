import { describe, expect, it } from "vitest";
import { moveSelection, pickerRows, pushRecent, RECENT_LIMIT, type PickerRow } from "../../src/renderer/model-picker";

const models = [
  { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
  { provider: "anthropic", id: "claude-haiku", name: "Claude Haiku" },
  { provider: "openrouter", id: "meta/llama-3", name: "Llama 3" },
];
const labels = (rows: PickerRow[]) => rows.map((r) => (r.type === "header" ? `# ${r.label}` : r.key));

describe("pickerRows", () => {
  it("검색어가 없으면 최근 사용을 맨 위에, 이어서 프로바이더별로", () => {
    expect(labels(pickerRows(models, models[0], "", ["openrouter/meta/llama-3", "없는/모델"]))).toEqual([
      "# 최근 사용",
      "recent:openrouter/meta/llama-3",
      "# anthropic",
      "anthropic/claude-sonnet",
      "anthropic/claude-haiku",
      "# openrouter",
      "openrouter/meta/llama-3",
    ]);
  });

  it("검색어가 있으면 이름·ID·프로바이더로 거르고 최근 사용은 두지 않는다", () => {
    expect(labels(pickerRows(models, undefined, "haiku", ["anthropic/claude-haiku"]))).toEqual([
      "# anthropic",
      "anthropic/claude-haiku",
    ]);
    expect(labels(pickerRows(models, undefined, "openrouter llama", []))).toEqual(["# openrouter", "openrouter/meta/llama-3"]);
    expect(pickerRows(models, undefined, "gpt", [])).toEqual([]);
  });

  it("목록에 없는 현재 모델도 넣는다", () => {
    const current = { provider: "custom", id: "x" };
    expect(labels(pickerRows(models, current, "", []))[0]).toBe("# custom");
  });
});

describe("moveSelection", () => {
  const rows = pickerRows(models, undefined, "", []);
  // [#anthropic, sonnet(1), haiku(2), #openrouter, llama(4)]

  it("머리글을 건너뛰고 끝에서는 반대쪽으로", () => {
    expect(moveSelection(rows, 2, 1)).toBe(4);
    expect(moveSelection(rows, 4, 1)).toBe(1);
    expect(moveSelection(rows, 1, -1)).toBe(4);
  });

  it("고른 것이 없으면 처음(↓)이나 끝(↑), 고를 것이 없으면 -1", () => {
    expect(moveSelection(rows, -1, 1)).toBe(1);
    expect(moveSelection(rows, -1, -1)).toBe(4);
    expect(moveSelection([], -1, 1)).toBe(-1);
  });
});

describe("pushRecent", () => {
  it("맨 앞에 넣고 중복을 지우며 개수를 제한한다", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    const many = Array.from({ length: RECENT_LIMIT }, (_, i) => String(i));
    expect(pushRecent(many, "new")).toHaveLength(RECENT_LIMIT);
  });
});
