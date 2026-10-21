import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CustomModelForm,
  CustomProviderForm,
  CustomProviderView,
  ModelsFileView,
  ModelsProbeResult,
} from "@pi-desktop/host-protocol";

/**
 * models.json 편집 (설계 §4.7 "models.json은 스키마 기반 폼으로").
 *
 * - 폼이 다루는 필드(name·baseUrl·api·apiKey·models의 id·name·reasoning·input·contextWindow·maxTokens)만 바꾸고,
 *   나머지(compat·headers·modelOverrides·모델별 cost 등)는 그대로 둔다. 손으로 쓴 설정을 지우지 않기 위해서다.
 * - apiKey는 그대로 키 값일 수 있어 앱에 보낼 때 가린다. `$NAME`·`${NAME}`(환경 변수)과 `!명령`은 비밀이 아니므로 보여준다.
 *   폼이 apiKey를 보내지 않으면(undefined) 기존 값을 유지한다.
 * - 쓰기 전에 models.json.bak으로 백업하고, 임시 파일 → 이름 바꾸기로 원자적으로 쓴다. 깨진 파일은 덮어쓰지 않는다.
 */

type Json = Record<string, unknown>;

export function modelsPath(agentDir: string): string {
  return join(agentDir, "models.json");
}

/** apiKey를 앱에 보여줄 형태로: 환경 변수·명령은 그대로, 그대로 키 값이면 가림 */
export function apiKeyView(value: unknown): CustomProviderView["apiKey"] {
  if (typeof value !== "string" || !value) return { kind: "none" };
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value)) return { kind: "env", value };
  if (value.startsWith("!")) return { kind: "command", value };
  return { kind: "literal" };
}

async function readJson(path: string): Promise<{ exists: boolean; data: Json }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { exists: false, data: {} };
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("models.json 최상위가 객체가 아닙니다");
  return { exists: true, data: parsed as Json };
}

function providersOf(data: Json): Record<string, Json> {
  const providers = data.providers;
  return providers && typeof providers === "object" && !Array.isArray(providers) ? (providers as Record<string, Json>) : {};
}

function modelView(raw: Json): CustomModelForm {
  const view: CustomModelForm = { id: String(raw.id ?? "") };
  if (typeof raw.name === "string") view.name = raw.name;
  if (typeof raw.reasoning === "boolean") view.reasoning = raw.reasoning;
  if (Array.isArray(raw.input)) view.image = raw.input.includes("image");
  if (typeof raw.contextWindow === "number") view.contextWindow = raw.contextWindow;
  if (typeof raw.maxTokens === "number") view.maxTokens = raw.maxTokens;
  return view;
}

/** models.json을 폼에 맞게 읽는다. 깨졌으면 error를 담는다 */
export async function readModelsFile(agentDir: string): Promise<ModelsFileView> {
  const path = modelsPath(agentDir);
  let file: { exists: boolean; data: Json };
  try {
    file = await readJson(path);
  } catch (error) {
    return { path, exists: true, providers: [], error: error instanceof Error ? error.message : String(error) };
  }
  const providers = Object.entries(providersOf(file.data)).map(([id, raw]): CustomProviderView => {
    const view: CustomProviderView = {
      id,
      apiKey: apiKeyView(raw.apiKey),
      models: Array.isArray(raw.models) ? (raw.models as Json[]).map(modelView) : [],
      extraFields: Object.keys(raw).filter((k) => !["name", "baseUrl", "api", "apiKey", "models"].includes(k)),
    };
    if (typeof raw.name === "string") view.name = raw.name;
    if (typeof raw.baseUrl === "string") view.baseUrl = raw.baseUrl;
    if (typeof raw.api === "string") view.api = raw.api;
    return view;
  });
  return { path, exists: file.exists, providers };
}

function setOrDelete(target: Json, key: string, value: unknown): void {
  if (value === undefined || value === "" || value === null) delete target[key];
  else target[key] = value;
}

/** 폼의 모델을 원래 모델 객체에 덮어쓴다 (같은 id면 나머지 필드를 남긴다) */
export function mergeModel(original: Json | undefined, form: CustomModelForm): Json {
  const model: Json = { ...(original ?? {}), id: form.id };
  setOrDelete(model, "name", form.name?.trim());
  setOrDelete(model, "reasoning", form.reasoning ? true : undefined);
  const otherInputs = Array.isArray(model.input) ? (model.input as unknown[]).filter((x) => x !== "text" && x !== "image") : [];
  model.input = form.image ? ["text", "image", ...otherInputs] : ["text", ...otherInputs];
  if (!form.image && otherInputs.length === 0) delete model.input; // 기본값(텍스트만)이면 적지 않는다
  setOrDelete(model, "contextWindow", form.contextWindow);
  setOrDelete(model, "maxTokens", form.maxTokens);
  return model;
}

/** 폼의 프로바이더를 원래 객체에 덮어쓴다 */
export function mergeProvider(original: Json | undefined, form: CustomProviderForm): Json {
  const provider: Json = { ...(original ?? {}) };
  setOrDelete(provider, "name", form.name?.trim());
  setOrDelete(provider, "baseUrl", form.baseUrl.trim());
  setOrDelete(provider, "api", form.api.trim());
  // apiKey: undefined면 기존 값 유지, 빈 문자열이면 지움, 그 밖에는 새 값
  if (form.apiKey !== undefined) setOrDelete(provider, "apiKey", form.apiKey.trim());
  const originals = new Map(
    (Array.isArray(provider.models) ? (provider.models as Json[]) : []).map((m) => [String(m.id), m] as const),
  );
  provider.models = form.models.filter((m) => m.id.trim()).map((m) => mergeModel(originals.get(m.id.trim()), { ...m, id: m.id.trim() }));
  return provider;
}

async function writeModels(path: string, data: Json, existed: boolean): Promise<void> {
  if (existed) await copyFile(path, `${path}.bak`);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

/** 프로바이더 하나를 저장한다 (없으면 추가). previousId가 다르면 이름을 바꾼다 */
export async function saveProvider(agentDir: string, form: CustomProviderForm, previousId?: string): Promise<void> {
  const path = modelsPath(agentDir);
  const { exists, data } = await readJson(path);
  const providers = { ...providersOf(data) };
  const original = providers[previousId ?? form.id] ?? providers[form.id];
  if (previousId && previousId !== form.id) delete providers[previousId];
  providers[form.id] = mergeProvider(original, form);
  await writeModels(path, { ...data, providers }, exists);
}

export async function removeProvider(agentDir: string, id: string): Promise<boolean> {
  const path = modelsPath(agentDir);
  const { exists, data } = await readJson(path);
  const providers = { ...providersOf(data) };
  if (!(id in providers)) return false;
  delete providers[id];
  await writeModels(path, { ...data, providers }, exists);
  return true;
}

/**
 * OpenAI 호환 엔드포인트의 `{baseUrl}/models`를 불러 연결을 시험하고 모델 ID를 가져온다.
 * 이 호스트에서 부르므로 WSL·원격의 localhost가 맞게 잡힌다. 키는 그대로 값이나 환경 변수만 쓰고, 명령은 실행하지 않는다.
 */
export async function probeEndpoint(
  baseUrl: string,
  apiKey: string | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelsProbeResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const key = resolveKey(apiKey, env);
  try {
    const response = await fetchImpl(url, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, url, status: response.status, models: [], error: `HTTP ${response.status}` };
    const body = (await response.json()) as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown; model?: unknown }> };
    // OpenAI 형식(data[].id), Ollama 고유 형식(models[].name)도 받는다.
    const ids = [
      ...(body.data ?? []).map((m) => m.id),
      ...(body.models ?? []).map((m) => m.model ?? m.name),
    ].filter((id): id is string => typeof id === "string");
    return { ok: true, url, status: response.status, models: [...new Set(ids)].slice(0, 200) };
  } catch (error) {
    return { ok: false, url, models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveKey(apiKey: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (!apiKey) return undefined;
  const envName = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(apiKey)?.[1];
  if (envName) return env[envName];
  if (apiKey.startsWith("!")) return undefined;
  return apiKey;
}

/** 저장된 프로바이더의 apiKey 원문 (연결 시험용, 데몬 안에서만 쓴다) */
export async function storedApiKey(agentDir: string, id: string): Promise<string | undefined> {
  try {
    const { data } = await readJson(modelsPath(agentDir));
    const key = providersOf(data)[id]?.apiKey;
    return typeof key === "string" ? key : undefined;
  } catch {
    return undefined;
  }
}
