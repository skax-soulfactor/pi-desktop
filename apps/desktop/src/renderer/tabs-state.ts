/**
 * 워크스페이스 탭 목록 (설계 §3.3). 순수 함수와 저장만 담당한다.
 */

export interface TabsState {
  ids: string[];
  active: string;
}

/** 탭 표시용 상태 변화로 생기는 알림 */
export type Attention = "done" | "input";

export const TABS_KEY = "pi-desktop.tabs";

export function loadTabs(mainTab: string): TabsState {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TabsState>;
      const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === "string") : [];
      if (ids.length > 0) return { ids, active: ids.includes(String(parsed.active)) ? String(parsed.active) : ids[0]! };
    }
  } catch {
    // 저장값이 깨졌으면 처음 상태로
  }
  return { ids: [mainTab], active: mainTab };
}

export function saveTabs(state: TabsState): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(state));
  } catch {
    // 무시
  }
}

/** 새 탭을 지금 탭 오른쪽에 열고 활성화한다. */
export function addTab(state: TabsState, id: string): TabsState {
  const at = state.ids.indexOf(state.active);
  const ids = [...state.ids];
  ids.splice(at + 1, 0, id);
  return { ids, active: id };
}

/** 탭을 닫는다. 마지막 탭은 닫지 않는다. 활성 탭을 닫으면 오른쪽(없으면 왼쪽) 탭을 연다. */
export function closeTab(state: TabsState, id: string): TabsState {
  if (state.ids.length <= 1 || !state.ids.includes(id)) return state;
  const at = state.ids.indexOf(id);
  const ids = state.ids.filter((t) => t !== id);
  const active = state.active === id ? ids[Math.min(at, ids.length - 1)]! : state.active;
  return { ids, active };
}

/** 다음(+1)·이전(-1) 탭으로. 끝에서는 반대쪽으로 넘어간다. */
export function cycleTab(state: TabsState, step: 1 | -1): TabsState {
  const at = state.ids.indexOf(state.active);
  const next = (at + step + state.ids.length) % state.ids.length;
  return { ...state, active: state.ids[next]! };
}

/**
 * 숨긴 탭의 상태 변화에서 알릴 것을 고른다.
 * - 입력이 필요해졌다 → "input" (작업 완료보다 먼저 알린다)
 * - 실행 중이었다가 끝났다 → "done"
 */
export function attentionFor(
  before: { running: boolean; needsInput: boolean } | undefined,
  after: { running: boolean; needsInput: boolean },
): Attention | undefined {
  if (after.needsInput && !before?.needsInput) return "input";
  if (before?.running && !after.running) return "done";
  return undefined;
}
