import { describeTunables, resolveTunable, type TunableDef, type TunableItem, type TunableOverrides } from "@pi-desktop/agent-kit/tunables-core";

/**
 * 앱 화면(렌더러)에서 쓰는 앱 수치 (설계 DESIGN-APPS.md §7).
 *
 * 화면 코드는 값을 그때그때 읽어야 하지만 파일을 직접 읽을 수 없다. 그래서 시작할 때 메인(또는 웹 서버)에서
 * 바꾼 값을 한 번 받아 두고(load), 설정 화면에서 바꾸면 그 자리에서 고친다(apply). 받기 전이나 받지 못하면 기본값이다.
 * 메인 프로세스는 이것을 쓰지 않고 agent-kit의 TunableStore로 파일을 직접 읽는다.
 */
export interface AppTunables {
  readonly defs: readonly TunableDef[];
  /** 지금 쓰는 수치 */
  num(id: string): number;
  /** 바꾼 값을 받아 둔다 (설정 화면 목록 또는 메인이 돌려준 항목들) */
  apply(items: readonly Pick<TunableItem, "id" | "value" | "overridden">[]): void;
  /** 화면에 보일 항목 (받아 둔 값 기준) */
  items(): TunableItem[];
}

export function createAppTunables(defs: readonly TunableDef[]): AppTunables {
  const byId = new Map(defs.map((d) => [d.id, d]));
  let overrides: TunableOverrides = {};
  return {
    defs,
    num(id) {
      const def = byId.get(id);
      if (!def || def.kind !== "number") throw new Error(`정의되지 않은 수치입니다: ${id}`);
      return resolveTunable(def, overrides) as number;
    },
    apply(items) {
      const next = { ...overrides };
      for (const item of items) {
        if (!byId.has(item.id)) continue;
        if (item.overridden) next[item.id] = item.value;
        else delete next[item.id];
      }
      overrides = next;
    },
    items: () => describeTunables(defs, overrides),
  };
}
