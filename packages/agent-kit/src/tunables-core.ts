/**
 * 설정으로 꺼낸 프롬프트와 수치 (설계 DESIGN-APPS.md §7).
 *
 * 코드에 박아 두던 프롬프트·수치를 항목 목록(정의)으로 모아, 사용자가 화면에서 용도를 보고 값을 바꿀 수 있게 한다.
 * - 정의마다 기본값·범위·용도를 둔다. 바꾸면 안 되는 항목은 `locked`에 까닭을 적고 읽기 전용으로 보여 준다.
 * - 저장 파일에는 **사용자가 바꾼 값만** 둔다. 그래서 앱이 업데이트로 기본값을 고치면 바꾸지 않은 항목은 새 기본값을 따른다.
 * - 저장된 값이 범위를 벗어나거나 형식이 틀리면 기본값을 쓰고 화면에 문제를 보여 준다 (실행이 깨지지 않게).
 *
 * 이 파일은 화면(브라우저)에서도 쓰므로 node 모듈을 import하지 않는다. 파일 읽기·쓰기는 tunables-store.ts.
 */

export type TunableKind = "number" | "text";

export interface TunableDef {
  /** 저장 파일의 키. 바꾸면 사용자가 바꾼 값이 사라지므로 바꾸지 않는다 */
  id: string;
  /** 화면에서 묶어 보이는 이름 (예: "지식베이스") */
  group: string;
  /** 한 줄 이름 */
  label: string;
  /** 어디에 어떻게 쓰이는지, 바꾸면 무엇이 달라지는지 */
  purpose: string;
  kind: TunableKind;
  default: number | string;
  /** 수치의 단위 (화면 표시용, 예: "초", "글자") */
  unit?: string;
  min?: number;
  max?: number;
  /** 정수만 받는다 */
  integer?: boolean;
  /** 바꿀 수 없는 항목이면 그 까닭. 있으면 읽기 전용으로 보여 주고 저장된 값도 쓰지 않는다 */
  locked?: string;
  /** 글에 넣을 수 있는 자리표시 `{{이름}}`과 그 뜻. 실행할 때 실제 값으로 바뀐다 */
  placeholders?: Record<string, string>;
  /** 정의된 코드 위치 (저장소 기준 경로). 화면에서 출처로 보여 준다 */
  source: string;
}

/** 화면에 보이는 한 항목: 정의 + 지금 쓰는 값 */
export interface TunableItem extends TunableDef {
  /** 지금 실행에 쓰는 값 (바꾼 값이 문제없으면 그 값, 아니면 기본값) */
  value: number | string;
  /** 사용자가 바꾼 값이 저장되어 있는지 */
  overridden: boolean;
  /** 저장된 값에 문제가 있어 기본값을 쓰고 있으면 그 까닭 */
  problem?: string;
}

/** 저장 파일의 모양: 바꾼 항목만 */
export type TunableOverrides = Record<string, number | string>;

export type CheckResult = { ok: true; value: number | string } | { ok: false; problem: string };

/** 값 하나를 정의에 맞는지 본다. 수치는 숫자로 바꿀 수 있는 글자도 받는다 */
export function checkTunable(def: TunableDef, raw: unknown): CheckResult {
  if (def.locked) return { ok: false, problem: `바꿀 수 없는 항목입니다: ${def.locked}` };
  if (def.kind === "number") {
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, problem: "숫자가 아닙니다" };
    if (def.integer && !Number.isInteger(value)) return { ok: false, problem: "정수만 넣을 수 있습니다" };
    if (def.min !== undefined && value < def.min) return { ok: false, problem: `${def.min}${def.unit ?? ""} 이상이어야 합니다` };
    if (def.max !== undefined && value > def.max) return { ok: false, problem: `${def.max}${def.unit ?? ""} 이하여야 합니다` };
    return { ok: true, value };
  }
  if (typeof raw !== "string") return { ok: false, problem: "글이 아닙니다" };
  if (raw.trim() === "") return { ok: false, problem: "비어 있습니다. 기본값으로 되돌리려면 되돌리기를 누르세요" };
  return { ok: true, value: raw };
}

/** 정의 목록과 저장된 값으로 화면에 보일 항목을 만든다 */
export function describeTunables(defs: readonly TunableDef[], overrides: TunableOverrides): TunableItem[] {
  return defs.map((def) => {
    if (!(def.id in overrides)) return { ...def, value: def.default, overridden: false };
    const checked = checkTunable(def, overrides[def.id]);
    if (checked.ok) return { ...def, value: checked.value, overridden: true };
    return { ...def, value: def.default, overridden: true, problem: `${checked.problem}. 기본값을 씁니다` };
  });
}

/** 지금 쓰는 값 하나 (describeTunables의 value와 같다) */
export function resolveTunable(def: TunableDef, overrides: TunableOverrides): number | string {
  if (def.locked || !(def.id in overrides)) return def.default;
  const checked = checkTunable(def, overrides[def.id]);
  return checked.ok ? checked.value : def.default;
}

/** `{{이름}}`을 값으로 바꾼다. 모르는 이름은 그대로 둔다 */
export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** 정의 목록이 스스로 맞는지 (테스트에서 쓴다): id 중복, 기본값이 범위 안인지, 용도·출처가 있는지 */
export function definitionProblems(defs: readonly TunableDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) problems.push(`${def.id}: id가 겹칩니다`);
    seen.add(def.id);
    if (!def.purpose.trim()) problems.push(`${def.id}: 용도가 없습니다`);
    if (!def.source.trim()) problems.push(`${def.id}: 출처가 없습니다`);
    if (typeof def.default !== (def.kind === "number" ? "number" : "string")) problems.push(`${def.id}: 기본값 형식이 kind와 다릅니다`);
    if (!def.locked) {
      const checked = checkTunable(def, def.default);
      if (!checked.ok) problems.push(`${def.id}: 기본값이 정의에 맞지 않습니다 (${checked.problem})`);
    }
    if (def.kind === "number" && !def.locked && (def.min === undefined || def.max === undefined)) {
      problems.push(`${def.id}: 바꿀 수 있는 수치에는 최소·최대가 있어야 합니다`);
    }
    for (const name of Object.keys(def.placeholders ?? {})) {
      if (typeof def.default === "string" && !def.default.includes(`{{${name}}}`)) problems.push(`${def.id}: 기본값에 {{${name}}}가 없습니다`);
    }
  }
  return problems;
}
