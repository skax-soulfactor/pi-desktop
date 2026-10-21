/**
 * models.json 편집 폼 규칙 (설계 §4.7). 화면과 분리한 순수 함수.
 */
import type { CustomModelForm, CustomProviderForm, CustomProviderView } from "@pi-desktop/host-protocol/messages";

/** Pi(pi-ai 1.3.0)가 아는 api 종류 */
export const API_OPTIONS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "google-vertex",
] as const;

export interface ProviderPreset {
  label: string;
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  /** 로컬 서버는 키를 무시하지만 Pi가 모델을 쓸 수 있게 더미 키를 둔다 (Pi 문서 권장) */
  apiKey?: string;
}

export const PRESETS: ProviderPreset[] = [
  { label: "Ollama", id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", api: "openai-completions", apiKey: "ollama" },
  { label: "LM Studio", id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", api: "openai-completions", apiKey: "lm-studio" },
  { label: "vLLM", id: "vllm", name: "vLLM", baseUrl: "http://localhost:8000/v1", api: "openai-completions", apiKey: "vllm" },
  { label: "llama.cpp 서버", id: "llamacpp", name: "llama.cpp", baseUrl: "http://localhost:8080/v1", api: "openai-completions", apiKey: "llamacpp" },
  { label: "OpenAI 호환 (직접 입력)", id: "my-endpoint", name: "", baseUrl: "https://", api: "openai-completions" },
];

/** API 키 입력 방식. keep: 저장된 값 유지 (값은 가려져 있어 다시 입력하지 않는 한 바꾸지 않는다) */
export type KeyMode = "keep" | "none" | "literal" | "env" | "command";

export interface ModelRow {
  id: string;
  name: string;
  reasoning: boolean;
  image: boolean;
  contextWindow: string;
  maxTokens: string;
}

export interface ProviderDraft {
  /** 저장된 프로바이더를 고쳐 쓰는 중이면 원래 ID */
  originalId?: string;
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  keyMode: KeyMode;
  /** keyMode에 따라: 키 값 / 환경 변수 이름 / 명령 */
  keyValue: string;
  models: ModelRow[];
  /** 폼이 다루지 않아 그대로 남는 필드 (안내용) */
  extraFields: string[];
}

export const emptyRow = (id = ""): ModelRow => ({ id, name: "", reasoning: false, image: false, contextWindow: "", maxTokens: "" });

export function draftFromPreset(preset: ProviderPreset): ProviderDraft {
  return {
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    api: preset.api,
    keyMode: preset.apiKey ? "literal" : "none",
    keyValue: preset.apiKey ?? "",
    models: [],
    extraFields: [],
  };
}

export function draftFromView(view: CustomProviderView): ProviderDraft {
  const k = view.apiKey;
  return {
    originalId: view.id,
    id: view.id,
    name: view.name ?? "",
    baseUrl: view.baseUrl ?? "",
    api: view.api ?? "openai-completions",
    keyMode: k.kind === "literal" ? "keep" : k.kind,
    keyValue:
      k.kind === "env" ? (k.value ?? "").replace(/^\$\{?|\}$/g, "") : k.kind === "command" ? (k.value ?? "").replace(/^!/, "") : "",
    models: view.models.map((m) => ({
      id: m.id,
      name: m.name ?? "",
      reasoning: m.reasoning ?? false,
      image: m.image ?? false,
      contextWindow: m.contextWindow ? String(m.contextWindow) : "",
      maxTokens: m.maxTokens ? String(m.maxTokens) : "",
    })),
    extraFields: view.extraFields,
  };
}

/** 폼 → 저장 요청. keep이면 apiKey를 보내지 않아 데몬이 기존 값을 유지한다 */
export function draftToForm(draft: ProviderDraft): CustomProviderForm {
  const form: CustomProviderForm = {
    id: draft.id.trim(),
    baseUrl: draft.baseUrl.trim(),
    api: draft.api.trim(),
    models: draft.models
      .filter((m) => m.id.trim())
      .map((m) => {
        const model: CustomModelForm = { id: m.id.trim() };
        if (m.name.trim()) model.name = m.name.trim();
        if (m.reasoning) model.reasoning = true;
        if (m.image) model.image = true;
        const cw = positive(m.contextWindow);
        if (cw) model.contextWindow = cw;
        const mt = positive(m.maxTokens);
        if (mt) model.maxTokens = mt;
        return model;
      }),
  };
  if (draft.name.trim()) form.name = draft.name.trim();
  const v = draft.keyValue.trim();
  switch (draft.keyMode) {
    case "none":
      form.apiKey = "";
      break;
    case "literal":
      form.apiKey = v;
      break;
    case "env":
      form.apiKey = v ? `$${v.replace(/^\$\{?|\}$/g, "")}` : "";
      break;
    case "command":
      form.apiKey = v ? `!${v.replace(/^!/, "")}` : "";
      break;
    case "keep":
      break;
  }
  return form;
}

function positive(text: string): number | undefined {
  const n = Number(text.trim());
  return text.trim() && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** 저장 전 확인. 문제가 있으면 이유 목록 */
export function draftProblems(draft: ProviderDraft, otherIds: readonly string[]): string[] {
  const problems: string[] = [];
  const id = draft.id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) problems.push("ID는 영문·숫자로 시작하고 영문·숫자·. _ -만 쓸 수 있습니다");
  if (otherIds.includes(id)) problems.push(`ID "${id}"인 프로바이더가 이미 있습니다`);
  if (!/^https?:\/\/[^/\s]+/.test(draft.baseUrl.trim())) problems.push("Base URL은 http:// 또는 https://로 시작해야 합니다");
  if (!draft.api.trim()) problems.push("API 종류를 고르세요");
  if (draft.keyMode === "env" && !/^\$?\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(draft.keyValue.trim())) {
    problems.push("환경 변수 이름이 올바르지 않습니다");
  }
  if ((draft.keyMode === "literal" || draft.keyMode === "command") && !draft.keyValue.trim()) problems.push("키 값을 입력하세요");
  const ids = draft.models.map((m) => m.id.trim()).filter(Boolean);
  if (ids.length === 0) problems.push("모델을 하나 이상 넣으세요");
  const dup = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dup) problems.push(`모델 ID "${dup}"가 겹칩니다`);
  for (const m of draft.models) {
    for (const [label, value] of [
      ["컨텍스트", m.contextWindow],
      ["최대 출력", m.maxTokens],
    ] as const) {
      if (value.trim() && positive(value) === undefined) problems.push(`${m.id || "모델"}: ${label}는 양수여야 합니다`);
    }
  }
  return problems;
}

/** 엔드포인트에서 가져온 모델 ID 중 아직 없는 것을 덧붙인다 */
export function addDiscovered(rows: readonly ModelRow[], ids: readonly string[]): ModelRow[] {
  const have = new Set(rows.map((r) => r.id.trim()));
  return [...rows.filter((r) => r.id.trim()), ...ids.filter((id) => !have.has(id)).map((id) => emptyRow(id))];
}
