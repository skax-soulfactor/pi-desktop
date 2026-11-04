import { join } from "node:path";
import { TunableStore } from "@pi-desktop/agent-kit/tunables-store";
import { APP_TUNABLES, APP_TUNABLES_FILE, appDefault } from "../shared/app-tunables";

/**
 * 이 앱(메인 또는 휴대폰 웹 서버)의 수치 저장소 (설계 DESIGN-APPS.md §7).
 * 시작할 때 데이터 폴더로 initAppTunables를 부른다. 부르기 전(테스트 등)에는 기본값을 쓴다.
 */
let store: TunableStore | undefined;

export function initAppTunables(dataDir: string): TunableStore {
  store = new TunableStore(join(dataDir, APP_TUNABLES_FILE), APP_TUNABLES);
  return store;
}

/** 지금 쓰는 수치 (파일이 바뀌면 다음 읽기부터 새 값) */
export function appNum(id: string): number {
  return store ? store.num(id) : appDefault(id);
}
