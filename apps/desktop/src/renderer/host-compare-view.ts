import type { CopyKind, HostInventory, InventoryItem } from "../shared/api";

/**
 * 호스트 비교 화면의 순수 함수들 (설계 §5.9 "호스트 비교 화면").
 * 두 호스트의 사용자 범위 리소스를 종류·이름으로 맞추고, 한쪽에만 있는 것과 내용이 다른 것을 가린다.
 */

export type CompareState = "onlyA" | "onlyB" | "same" | "different" | "unknown";

export interface CompareRow {
  key: string;
  kind: CopyKind;
  name: string;
  a?: InventoryItem;
  b?: InventoryItem;
  state: CompareState;
}

const KIND_ORDER: CopyKind[] = ["context", "skill", "prompt", "extension"];

export const KIND_TEXT: Record<CopyKind, string> = { context: "컨텍스트", skill: "스킬", prompt: "프롬프트", extension: "확장" };

function stateOf(a: InventoryItem | undefined, b: InventoryItem | undefined): CompareState {
  if (a && !b) return "onlyA";
  if (b && !a) return "onlyB";
  if (!a?.digest || !b?.digest) return "unknown";
  return a.digest === b.digest ? "same" : "different";
}

/** 두 호스트의 목록을 종류·이름으로 맞춘 줄. 종류 순서(컨텍스트·스킬·프롬프트·확장), 같은 종류 안에서는 이름 순 */
export function compareRows(a: HostInventory, b: HostInventory): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  const put = (side: "a" | "b", item: InventoryItem) => {
    const key = `${item.kind}:${item.name}`;
    const row = rows.get(key) ?? { key, kind: item.kind, name: item.name, state: "unknown" as CompareState };
    row[side] = item;
    rows.set(key, row);
  };
  for (const item of a.items) put("a", item);
  for (const item of b.items) put("b", item);
  return [...rows.values()]
    .map((row) => ({ ...row, state: stateOf(row.a, row.b) }))
    .sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.name.localeCompare(y.name));
}

/** 줄의 상태를 사람이 읽을 글로 */
export function stateText(state: CompareState, aLabel: string, bLabel: string): string {
  switch (state) {
    case "onlyA":
      return `${aLabel}에만`;
    case "onlyB":
      return `${bLabel}에만`;
    case "same":
      return "같음";
    case "different":
      return "내용 다름";
    case "unknown":
      return "확인 못함";
  }
}

/** 상태별 개수 (머리글 요약) */
export function compareSummary(rows: readonly CompareRow[]): Record<CompareState, number> {
  const summary: Record<CompareState, number> = { onlyA: 0, onlyB: 0, same: 0, different: 0, unknown: 0 };
  for (const row of rows) summary[row.state] += 1;
  return summary;
}
