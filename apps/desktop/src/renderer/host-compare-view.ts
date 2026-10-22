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

/** 덮어쓰면 대상에서 일어날 파일 변화 */
export interface FileChange {
  path: string;
  /** added: 새로 생김, removed: 대상에만 있어 사라짐, changed: 내용이 바뀜 */
  change: "added" | "removed" | "changed";
  /** 글 파일이면 대상의 지금 내용 */
  before?: string;
  /** 글 파일이면 복사할 내용 */
  after?: string;
}

/** base64를 글로. 0바이트가 있으면 글 파일이 아니라고 보고 undefined */
function textOf(contentBase64: string): string | undefined {
  const binary = atob(contentBase64);
  if (binary.includes("\0")) return undefined;
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/**
 * 복사할 파일들(from)로 대상(to)을 바꾸면 무엇이 달라지는지. 폴더째 바꾸므로 대상에만 있던 파일은 사라진다.
 * 양쪽이 파일 하나씩이면 이름이 달라도(프롬프트 이름, 파일 하나 스킬) 서로 짝짓는다.
 */
export function fileChanges(
  from: ReadonlyArray<{ path: string; contentBase64: string }>,
  to: ReadonlyArray<{ path: string; contentBase64: string }>,
): FileChange[] {
  const pairs: Array<[{ path: string; contentBase64: string } | undefined, { path: string; contentBase64: string } | undefined]> = [];
  if (from.length === 1 && to.length === 1) pairs.push([from[0], to[0]]);
  else {
    const target = new Map(to.map((f) => [f.path, f]));
    for (const f of from) {
      pairs.push([f, target.get(f.path)]);
      target.delete(f.path);
    }
    for (const t of target.values()) pairs.push([undefined, t]);
  }
  const changes: FileChange[] = [];
  for (const [a, b] of pairs) {
    if (a && b && a.contentBase64 === b.contentBase64) continue;
    const change: FileChange = { path: (a ?? b)!.path, change: !b ? "added" : !a ? "removed" : "changed" };
    const before = b ? textOf(b.contentBase64) : undefined;
    const after = a ? textOf(a.contentBase64) : undefined;
    if (before !== undefined) change.before = before;
    if (after !== undefined) change.after = after;
    changes.push(change);
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

/** 여러 줄을 한꺼번에 복사할 때 그 방향으로 옮길 수 있는 줄 (원본 쪽에 있고, 같지 않고, 확인 못함이 아닌 것) */
export function bulkCopyable(rows: readonly CompareRow[], direction: "toB" | "toA"): CompareRow[] {
  return rows.filter((r) => r.state !== "same" && r.state !== "unknown" && (direction === "toB" ? r.a : r.b));
}
