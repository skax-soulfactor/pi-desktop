import { join } from "node:path";
import { TunableStore } from "@pi-desktop/agent-kit/tunables-store";
import { APP_TUNABLES, APP_TUNABLES_FILE, appDefault } from "../shared/app-tunables";

/**
 * 이 앱의 수치 저장소 (userData/app-tunables.json, DESIGN-APPS.md §7).
 * 메인이 시작할 때 initAppTunables를 부른다. 부르기 전(단위 테스트 등)에는 기본값을 쓴다.
 * electron을 import하지 않는다 (이 모듈을 쓰는 순수 함수들을 electron 없이 테스트하도록).
 */
let store: TunableStore | undefined;

export function initAppTunables(userData: string): TunableStore {
  store = new TunableStore(join(userData, APP_TUNABLES_FILE), APP_TUNABLES);
  return store;
}

export function appTunableStore(): TunableStore {
  if (!store) throw new Error("앱 수치 저장소가 아직 준비되지 않았습니다");
  return store;
}

/** 지금 쓰는 수치 (파일이 바뀌면 다음 읽기부터 새 값) */
export function appNum(id: string): number {
  return store ? store.num(id) : appDefault(id);
}
