import { createAppTunables } from "@pi-desktop/tunables-ui/app-tunables";
import { APP_TUNABLES } from "../shared/app-tunables";

/**
 * 화면이 쓰는 앱 수치 (설계 DESIGN-APPS.md §7). 시작할 때 메인(웹이면 웹 서버)에서 바꾼 값을 받아 두고,
 * 설정 화면에서 바꾸면 그 자리에서 고친다. 받기 전(테스트 등)에는 기본값이다.
 */
export const appTunables = createAppTunables(APP_TUNABLES);

/** 지금 쓰는 수치 */
export const rnum = (id: string): number => appTunables.num(id);

/** 시작할 때 한 번 받는다. 못 받으면 기본값으로 계속한다 */
export async function loadAppTunables(): Promise<void> {
  try {
    appTunables.apply(await window.piDesktop.appTunablesList());
  } catch {
    // 예전 메인이거나 연결 전: 기본값
  }
}
