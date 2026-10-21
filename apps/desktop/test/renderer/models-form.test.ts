import { describe, expect, it } from "vitest";
import {
  addDiscovered,
  draftFromPreset,
  draftFromView,
  draftProblems,
  draftToForm,
  emptyRow,
  PRESETS,
  type ProviderDraft,
} from "../../src/renderer/models-form";

const base = (): ProviderDraft => ({ ...draftFromPreset(PRESETS[0]!), models: [emptyRow("qwen2.5-coder:7b")] });

describe("draftToForm", () => {
  it("프리셋(Ollama)을 저장 요청으로 바꾼다 (더미 키 포함)", () => {
    expect(draftToForm(base())).toEqual({
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      models: [{ id: "qwen2.5-coder:7b" }],
    });
  });

  it("키 입력 방식: 유지는 보내지 않고, 없음은 빈 값, 환경 변수는 $, 명령은 !", () => {
    expect(draftToForm({ ...base(), keyMode: "keep" }).apiKey).toBeUndefined();
    expect(draftToForm({ ...base(), keyMode: "none" }).apiKey).toBe("");
    expect(draftToForm({ ...base(), keyMode: "env", keyValue: "${MY_KEY}" }).apiKey).toBe("$MY_KEY");
    expect(draftToForm({ ...base(), keyMode: "command", keyValue: "!pass show x" }).apiKey).toBe("!pass show x");
  });

  it("모델의 빈 줄은 빼고 숫자는 양의 정수만 넣는다", () => {
    const form = draftToForm({
      ...base(),
      models: [
        { id: " a ", name: "A", reasoning: true, image: true, contextWindow: "128000", maxTokens: "abc" },
        emptyRow(""),
      ],
    });
    expect(form.models).toEqual([{ id: "a", name: "A", reasoning: true, image: true, contextWindow: 128000 }]);
  });
});

describe("draftFromView", () => {
  it("가려진 키는 유지 모드로, 환경 변수·명령은 값만 꺼낸다", () => {
    const view = { id: "p", baseUrl: "http://x", api: "openai-completions", models: [{ id: "m", contextWindow: 8000 }], extraFields: ["compat"] };
    expect(draftFromView({ ...view, apiKey: { kind: "literal" } })).toMatchObject({ originalId: "p", keyMode: "keep", keyValue: "" });
    expect(draftFromView({ ...view, apiKey: { kind: "env", value: "${K}" } })).toMatchObject({ keyMode: "env", keyValue: "K" });
    expect(draftFromView({ ...view, apiKey: { kind: "command", value: "!cmd x" } })).toMatchObject({ keyMode: "command", keyValue: "cmd x" });
    expect(draftFromView({ ...view, apiKey: { kind: "none" } }).models[0]).toMatchObject({ id: "m", contextWindow: "8000" });
  });
});

describe("draftProblems", () => {
  it("올바른 프리셋은 문제 없음", () => {
    expect(draftProblems(base(), [])).toEqual([]);
  });

  it("ID 형식·중복, URL, 키, 모델 없음·중복, 숫자를 확인한다", () => {
    const problems = draftProblems(
      {
        ...base(),
        id: "bad id",
        baseUrl: "localhost:1234",
        keyMode: "env",
        keyValue: "1BAD",
        models: [emptyRow("m"), emptyRow("m"), { ...emptyRow("n"), contextWindow: "-5" }],
      },
      [],
    );
    expect(problems).toHaveLength(5);
    expect(draftProblems({ ...base() }, ["ollama"])).toEqual(['ID "ollama"인 프로바이더가 이미 있습니다']);
    expect(draftProblems({ ...base(), models: [] }, [])).toEqual(["모델을 하나 이상 넣으세요"]);
  });
});

describe("addDiscovered", () => {
  it("없는 모델만 덧붙이고 빈 줄은 정리한다", () => {
    expect(addDiscovered([emptyRow("a"), emptyRow("")], ["a", "b"]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
