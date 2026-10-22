import { describe, expect, it } from "vitest";
// 저장소에 설치된 Pi가 함께 배포한 실제 스키마
import schemaText from "../../../../node_modules/@earendil-works/pi-coding-agent/schemas/settings.schema.json?raw";
import { changedEdits, jsonProblem, parseNumberOr, schemaFields, settingsPatch, settingText, valueAt } from "../../src/renderer/settings-form";

const schema = JSON.parse(schemaText) as Record<string, unknown>;

describe("schemaFields (실제 Pi 스키마)", () => {
  const { fields, unsupported } = schemaFields(schema);
  const by = Object.fromEntries(fields.map((f) => [f.key, f]));

  it("종류를 정하고 하위 객체는 한 단계 펼친다", () => {
    expect(by.defaultThinkingLevel).toMatchObject({ kind: "enum", options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"], common: true });
    expect(by.hideThinkingBlock).toMatchObject({ kind: "boolean", default: false });
    expect(by.transport).toMatchObject({ kind: "enum", default: "auto" });
    expect(by.quietStartup).toMatchObject({ kind: "enum", options: [true, false, "header"] });
    expect(by.httpIdleTimeoutMs).toMatchObject({ kind: "numberOr", options: ["disabled"] });
    expect(by["compaction.enabled"]).toMatchObject({ kind: "boolean", path: ["compaction", "enabled"], common: true });
    expect(by.shellPath).toMatchObject({ kind: "string" });
  });

  it("숨길 것은 빼고, 폼으로 다루지 않는 것은 따로 모은다", () => {
    for (const hidden of ["lastChangelogVersion", "deviceId", "packages", "skills", "$schema"]) expect(by[hidden]).toBeUndefined();
    expect(unsupported).toEqual(expect.arrayContaining(["npmCommand", "enabledModels", "modelThinkingLevels", "compaction.modelOverrides"]));
  });
});

describe("settingsPatch·changedEdits", () => {
  const { fields } = schemaFields(schema);
  const values = { theme: "dark", compaction: { enabled: true, reserveTokens: 100 }, retry: { enabled: false } };

  it("하위 필드는 지금 객체에 덮어 최상위로 보내고, 비면 키를 지운다", () => {
    const edits = new Map<string, unknown>([
      ["compaction.enabled", false],
      ["retry.enabled", undefined],
      ["theme", undefined],
      ["defaultThinkingLevel", "high"],
    ]);
    expect(settingsPatch(values, fields, edits)).toEqual({
      set: { compaction: { enabled: false, reserveTokens: 100 }, defaultThinkingLevel: "high" },
      remove: ["retry", "theme"],
    });
  });

  it("지금 값과 같은 것은 미리보기에서 뺀다", () => {
    const edits = new Map<string, unknown>([
      ["compaction.enabled", true],
      ["compaction.reserveTokens", 200],
    ]);
    expect(changedEdits(values, fields, edits)).toEqual([{ key: "compaction.reserveTokens", before: 100, after: 200 }]);
    expect(valueAt(values, ["compaction", "reserveTokens"])).toBe(100);
    expect(valueAt(values, ["theme", "x"])).toBeUndefined();
  });
});

describe("parseNumberOr·settingText", () => {
  it("선택지 글자나 숫자만 받는다", () => {
    expect(parseNumberOr("disabled", { options: ["disabled"] })).toBe("disabled");
    expect(parseNumberOr(" 3000 ", { options: ["disabled"] })).toBe(3000);
    expect(parseNumberOr("1.5", { integer: true })).toBeUndefined();
    expect(parseNumberOr("abc", { options: ["auto"] })).toBeUndefined();
    expect(settingText(undefined)).toBe("기본값");
    expect(settingText(false)).toBe("false");
  });
});

describe("jsonProblem", () => {
  it("최상위가 객체인 JSON만 받는다", () => {
    expect(jsonProblem('{ "theme": "dark" }')).toBeUndefined();
    expect(jsonProblem("[]")).toContain("객체");
    expect(jsonProblem("null")).toContain("객체");
    expect(jsonProblem("{ x")).toContain("올바르지");
  });
});
