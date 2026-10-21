/**
 * 모델 선택기 목록 규칙 (설계 §4.1 상단 바: 프로바이더별 그룹·검색). 화면과 분리한 순수 함수.
 */
import { modelKey } from "./format";
import { matchesQuery } from "./session-search";
import type { ModelInfo } from "./use-session-info";

export type PickerRow = { type: "header"; label: string } | { type: "model"; model: ModelInfo; key: string };

export const RECENT_LIMIT = 5;

/**
 * 선택기에 보여줄 줄을 만든다.
 * - 목록에 없는 현재 모델(예: 확장이 바꾼 모델)도 넣는다
 * - 검색어가 없으면 "최근 사용"을 맨 위에 두고, 이어서 프로바이더별로 묶는다 (최근 모델은 아래에서도 보인다)
 * - 검색어가 있으면 이름·ID·프로바이더로 거르고 최근 사용 묶음은 두지 않는다
 */
export function pickerRows(
  models: readonly ModelInfo[],
  current: ModelInfo | undefined,
  query: string,
  recentKeys: readonly string[],
): PickerRow[] {
  const all = current && !models.some((m) => modelKey(m) === modelKey(current)) ? [current, ...models] : [...models];
  const byKey = new Map(all.map((m) => [modelKey(m), m]));
  const rows: PickerRow[] = [];

  if (!query.trim()) {
    const recent = recentKeys.map((k) => byKey.get(k)).filter((m): m is ModelInfo => m !== undefined);
    if (recent.length > 0) {
      rows.push({ type: "header", label: "최근 사용" });
      for (const model of recent) rows.push({ type: "model", model, key: `recent:${modelKey(model)}` });
    }
  }

  const groups = new Map<string, ModelInfo[]>();
  for (const model of all) {
    if (!matchesQuery(query, [model.name, model.id, model.provider])) continue;
    const list = groups.get(model.provider) ?? [];
    list.push(model);
    groups.set(model.provider, list);
  }
  for (const [provider, list] of groups) {
    rows.push({ type: "header", label: provider });
    for (const model of list) rows.push({ type: "model", model, key: modelKey(model) });
  }
  return rows;
}

/** 키보드로 고를 수 있는 줄(모델)의 위치 목록 */
export function selectableIndexes(rows: readonly PickerRow[]): number[] {
  return rows.flatMap((row, i) => (row.type === "model" ? [i] : []));
}

/** ↑(-1)·↓(+1)로 다음 모델 줄로 옮긴다. 끝에서는 반대쪽으로 넘어간다. 고를 것이 없으면 -1 */
export function moveSelection(rows: readonly PickerRow[], from: number, step: 1 | -1): number {
  const indexes = selectableIndexes(rows);
  if (indexes.length === 0) return -1;
  const at = indexes.indexOf(from);
  if (at === -1) return step > 0 ? indexes[0]! : indexes.at(-1)!;
  return indexes[(at + step + indexes.length) % indexes.length]!;
}

/** 고른 모델을 최근 사용 맨 앞에 넣는다 (중복 제거, 개수 제한) */
export function pushRecent(recent: readonly string[], key: string): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, RECENT_LIMIT);
}
