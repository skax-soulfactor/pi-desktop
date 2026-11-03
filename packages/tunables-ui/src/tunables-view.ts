import { checkTunable, type TunableItem } from "@pi-desktop/agent-kit/tunables-core";

export type { TunableItem } from "@pi-desktop/agent-kit/tunables-core";

/** 목록 거르기: 전부 / 바꾼 것 / 바꿀 수 있는 것 / 읽기 전용 */
export type TunableFilter = "all" | "changed" | "editable" | "locked";

export const FILTER_LABEL: Record<TunableFilter, string> = {
  all: "전부",
  changed: "바꾼 것",
  editable: "바꿀 수 있는 것",
  locked: "읽기 전용",
};

export interface TunableGroup {
  name: string;
  items: TunableItem[];
}

/** 찾는 말(이름·용도·id·값)과 거르기로 고른 뒤, 정의 순서대로 묶는다 */
export function groupTunables(items: readonly TunableItem[], query: string, filter: TunableFilter): TunableGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups: TunableGroup[] = [];
  for (const item of items) {
    if (filter === "changed" && !item.overridden) continue;
    if (filter === "editable" && item.locked) continue;
    if (filter === "locked" && !item.locked) continue;
    const haystack = `${item.label} ${item.purpose} ${item.id} ${item.group} ${String(item.value)}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    let group = groups.find((g) => g.name === item.group);
    if (!group) groups.push((group = { name: item.group, items: [] }));
    group.items.push(item);
  }
  return groups;
}

/** 수치를 단위와 함께 (예: "20,000글자", "0.2") */
export function formatValue(item: Pick<TunableItem, "kind" | "unit">, value: number | string): string {
  if (item.kind === "text") return String(value);
  const n = typeof value === "number" ? value.toLocaleString("ko-KR") : value;
  return item.unit ? `${n}${item.unit === "ms" || item.unit === "KB" || item.unit === "MB" ? " " : ""}${item.unit}` : String(n);
}

/** 범위 안내 (예: "1 ~ 8개, 정수") */
export function rangeText(item: TunableItem): string | undefined {
  if (item.kind !== "number" || item.locked) return undefined;
  const parts: string[] = [];
  if (item.min !== undefined && item.max !== undefined) parts.push(`${formatValue(item, item.min)} ~ ${formatValue(item, item.max)}`);
  if (item.integer) parts.push("정수");
  return parts.join(", ") || undefined;
}

/** 저장하기 전에 화면에서 먼저 본다 (실행기·데몬이 다시 본다). 문제가 없으면 undefined */
export function draftProblem(item: TunableItem, draft: string): string | undefined {
  const checked = checkTunable(item, draft);
  return checked.ok ? undefined : checked.problem;
}

/** 글 항목에서 자리표시가 빠졌는지 (빠져도 저장은 되지만, 그 값이 프롬프트에 들어가지 않는다) */
export function missingPlaceholders(item: TunableItem, draft: string): string[] {
  return Object.keys(item.placeholders ?? {}).filter((name) => !draft.includes(`{{${name}}}`));
}

/** 글 미리보기: 첫 줄 몇 글자 */
export function preview(text: string, max = 120): string {
  const first = text.trim().split("\n")[0] ?? "";
  return first.length > max ? `${first.slice(0, max)}…` : first;
}
