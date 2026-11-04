import { describeTunables } from "@pi-desktop/agent-kit/tunables-core";
import { TunablesPanel } from "@pi-desktop/tunables-ui";
import { WEB_TUNABLES } from "@pi-desktop/web-shell/tunables";
import { appTunables } from "./app-tunables";

/**
 * Pi 관리 창의 "수치" 탭 (설계 DESIGN-APPS.md §7).
 * 그 호스트 데몬의 수치(데몬 홈), 이 앱의 수치(이 PC, 웹이면 웹 서버), 휴대폰 웹의 수치(읽기 전용)를 한 목록으로 보인다.
 * 데몬 항목은 id가 daemon., 앱 항목은 app.으로 시작해 저장할 곳을 가른다.
 */
export function TunablesTab({ hostId, onError }: { hostId: string; onError: (message: string) => void }) {
  return (
    <TunablesPanel
      load={async () => {
        const [daemon, app] = await Promise.all([
          window.piDesktop.daemonTunablesList(hostId).catch((error: unknown) => {
            onError(`데몬 수치를 읽지 못했습니다 (예전 데몬이면 다시 연결하면 됩니다): ${String(error)}`);
            return [];
          }),
          window.piDesktop.appTunablesList(),
        ]);
        appTunables.apply(app);
        return [...daemon, ...app, ...describeTunables(WEB_TUNABLES, {})];
      }}
      save={async (id, value) => {
        if (id.startsWith("daemon.")) return window.piDesktop.daemonTunableSet(hostId, id, value);
        const item = await window.piDesktop.appTunableSet(id, value);
        // 화면이 쓰는 값은 그 자리에서 바꾼다 (다시 켤 필요가 없다)
        appTunables.apply([item]);
        return item;
      }}
      onError={onError}
      file="데몬 것은 그 호스트의 ~/.pi-desktop/tunables.json, 앱 것은 이 PC 앱 데이터 폴더의 app-tunables.json"
      applyNote="대부분 바로 반영됩니다. 시작할 때 읽는 값(업데이트 확인 간격, 데몬이 꺼지기까지 기다리는 시간)은 항목 설명에 언제 반영되는지 적혀 있습니다."
    />
  );
}
