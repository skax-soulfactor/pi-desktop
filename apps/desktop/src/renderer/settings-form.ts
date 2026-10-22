/**
 * settings.json 폼의 순수 함수들 (설계 §4.8 "스키마 기반 폼").
 * 그 호스트에 설치된 Pi의 settings.schema.json으로 필드를 만든다. 앱에 항목을 적어 두지 않으므로
 * Pi가 항목을 늘리면 폼도 따라 늘어난다. 폼으로 다루기 어려운 것(배열, 패턴 객체, 깊은 객체)은 따로 알린다.
 */

type Json = Record<string, unknown>;

export type FieldKind = "boolean" | "number" | "string" | "enum" | "numberOr";

export interface SettingsField {
  /** 점으로 이은 경로 (compaction.enabled) */
  key: string;
  path: string[];
  kind: FieldKind;
  /** enum의 선택지, numberOr의 숫자 아닌 값 */
  options?: Array<string | number | boolean>;
  integer?: boolean;
  default?: unknown;
  description?: string;
  /** "자주 쓰는 설정"에 먼저 보일지 */
  common: boolean;
}

/** Pi가 스스로 쓰는 값과 다른 화면에서 다루는 목록. 폼에 보이지 않는다 */
const HIDDEN = new Set(["$schema", "lastChangelogVersion", "deviceId", "trackingId", "packages", "extensions", "skills", "prompts", "themes"]);

/** 먼저 보일 설정 (최상위 키) */
const COMMON = new Set([
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "defaultProjectTrust",
  "steeringMode",
  "followUpMode",
  "compaction",
  "retry",
  "enableSkillCommands",
  "hideThinkingBlock",
  "shellPath",
  "httpProxy",
]);

function resolveRef(node: Json, schema: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) return node;
  const defs = (schema.$defs ?? {}) as Record<string, Json>;
  return { ...(defs[ref.slice("#/$defs/".length)] ?? {}), ...Object.fromEntries(Object.entries(node).filter(([k]) => k !== "$ref")) };
}

/** 노드 하나를 필드 종류로. 다룰 수 없으면 undefined */
function fieldOf(raw: Json, schema: Json): Pick<SettingsField, "kind" | "options" | "integer"> | undefined {
  const node = resolveRef(raw, schema);
  if (Array.isArray(node.enum)) return { kind: "enum", options: node.enum as Array<string | number | boolean> };
  if (Array.isArray(node.anyOf)) {
    const parts = (node.anyOf as Json[]).map((p) => resolveRef(p, schema));
    const consts = parts.filter((p) => "const" in p).map((p) => p.const as string | number | boolean);
    const rest = parts.filter((p) => !("const" in p));
    if (rest.length === 0) return { kind: "enum", options: consts };
    if (rest.length === 1 && rest[0]!.type === "boolean") return { kind: "enum", options: [true, false, ...consts] };
    if (rest.length === 1 && (rest[0]!.type === "number" || rest[0]!.type === "integer")) {
      return { kind: "numberOr", options: consts, integer: rest[0]!.type === "integer" };
    }
    return undefined;
  }
  if (node.type === "boolean") return { kind: "boolean" };
  if (node.type === "number" || node.type === "integer") return { kind: "number", integer: node.type === "integer" };
  if (node.type === "string") return { kind: "string" };
  return undefined;
}

/** 스키마의 필드들과, 폼으로 다루지 않는 키(배열·패턴 객체·깊은 객체) */
export function schemaFields(schema: Json): { fields: SettingsField[]; unsupported: string[] } {
  const fields: SettingsField[] = [];
  const unsupported: string[] = [];
  const properties = (schema.properties ?? {}) as Record<string, Json>;
  for (const [key, raw] of Object.entries(properties)) {
    if (HIDDEN.has(key)) continue;
    const node = resolveRef(raw, schema);
    const common = COMMON.has(key);
    if (node.type === "object" && node.properties && !node.patternProperties) {
      for (const [sub, subRaw] of Object.entries(node.properties as Record<string, Json>)) {
        const shape = fieldOf(subRaw, schema);
        if (!shape) {
          unsupported.push(`${key}.${sub}`);
          continue;
        }
        const subNode = resolveRef(subRaw, schema);
        fields.push({ key: `${key}.${sub}`, path: [key, sub], ...shape, ...describe(subNode), common });
      }
      continue;
    }
    const shape = fieldOf(raw, schema);
    if (!shape) {
      unsupported.push(key);
      continue;
    }
    fields.push({ key, path: [key], ...shape, ...describe(node), common });
  }
  return { fields, unsupported };
}

function describe(node: Json): Pick<SettingsField, "default" | "description"> {
  return {
    ...(node.default !== undefined ? { default: node.default } : {}),
    ...(typeof node.description === "string" ? { description: node.description } : {}),
  };
}

/** 경로의 지금 값 */
export function valueAt(values: Json, path: readonly string[]): unknown {
  let node: unknown = values;
  for (const part of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Json)[part];
  }
  return node;
}

/**
 * 고친 것(키 → 새 값, undefined는 지워 기본값으로)을 settings.merge에 줄 최상위 값과 지울 키로.
 * 하위 필드를 고치면 지금 객체에 덮어 그 최상위 키 전체를 보낸다. 객체가 비면 키를 지운다.
 */
export function settingsPatch(
  values: Json,
  fields: readonly SettingsField[],
  edits: ReadonlyMap<string, unknown>,
): { set: Json; remove: string[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const next = new Map<string, unknown>();
  for (const [key, value] of edits) {
    const field = byKey.get(key);
    if (!field) continue;
    const [top, sub] = field.path as [string, string | undefined];
    if (sub === undefined) {
      next.set(top, value);
      continue;
    }
    const base = next.has(top) ? next.get(top) : values[top];
    const obj: Json = base && typeof base === "object" && !Array.isArray(base) ? { ...(base as Json) } : {};
    if (value === undefined) delete obj[sub];
    else obj[sub] = value;
    next.set(top, Object.keys(obj).length > 0 ? obj : undefined);
  }
  const set: Json = {};
  const remove: string[] = [];
  for (const [top, value] of next) {
    if (value === undefined) {
      if (top in values) remove.push(top);
    } else set[top] = value;
  }
  return { set, remove };
}

/** 고친 것 중 지금 값과 실제로 다른 것만 (미리보기용) */
export function changedEdits(
  values: Json,
  fields: readonly SettingsField[],
  edits: ReadonlyMap<string, unknown>,
): Array<{ key: string; before: unknown; after: unknown }> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const [key, after] of edits) {
    const field = byKey.get(key);
    if (!field) continue;
    const before = valueAt(values, field.path);
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ key, before, after });
  }
  return out;
}

/** numberOr 입력: 선택지 글자면 그 값, 숫자면 숫자. 아니면 undefined */
export function parseNumberOr(text: string, field: Pick<SettingsField, "options" | "integer">): number | string | boolean | undefined {
  const trimmed = text.trim();
  const option = field.options?.find((o) => String(o) === trimmed);
  if (option !== undefined) return option;
  if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return field.integer && !Number.isInteger(n) ? undefined : n;
}

/** 값을 보일 글자 (없으면 "기본값") */
export function settingText(value: unknown): string {
  if (value === undefined) return "기본값";
  return typeof value === "string" ? value : JSON.stringify(value);
}
