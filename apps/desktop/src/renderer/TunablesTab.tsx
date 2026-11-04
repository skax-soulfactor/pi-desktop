import { describeTunables, type TunableItem } from "@pi-desktop/agent-kit/tunables-core";
import { TunablesPanel } from "@pi-desktop/tunables-ui";
import { WEB_TUNABLES } from "@pi-desktop/web-shell/tunables";
import type { PluginWorkspaceId, WorkspaceTunableKind } from "../shared/api";
import { appTunables } from "./app-tunables";
import { isWebClient } from "./clipboard-images";

/** 작업 공간마다 모을 수치 (Agent: 확장·데몬·앱, Mate: 실행기·앱) */
const WORKSPACE_SOURCES: Array<{ id: PluginWorkspaceId; label: string; kinds: WorkspaceTunableKind[] }> = [
  { id: "agent", label: "Agent", kinds: ["kit", "daemon", "app"] },
  { id: "mate", label: "Mate", kinds: ["kit", "app"] },
];

/** 작업 공간 항목의 id: "<작업 공간>:<종류>:<원래 id>" (저장할 곳을 가르고 Pi 항목과 겹치지 않게) */
const wrap = (ws: PluginWorkspaceId, label: string, kind: WorkspaceTunableKind, item: TunableItem): TunableItem => ({
  ...item,
  id: `${ws}:${kind}:${item.id}`,
  group: `${label} · ${item.group}`,
});

/** 켜 둔 Agent·Mate 작업 공간의 항목 (PC 앱만. 휴대폰 웹은 작업 공간마다 따로 연다) */
async function workspaceItems(onError: (message: string) => void): Promise<TunableItem[]> {
  if (isWebClient()) return [];
  const state = await window.piDesktop.workspacesState().catch(() => undefined);
  const enabled = new Set(state?.plugins.filter((p) => p.enabled).map((p) => p.id) ?? []);
  const lists = await Promise.all(
    WORKSPACE_SOURCES.filter((s) => enabled.has(s.id)).flatMap((source) =>
      source.kinds.map((kind) =>
        window.piDesktop.workspaceTunablesList(source.id, kind).then(
          (items) => items.map((item) => wrap(source.id, source.label, kind, item)),
          (error: unknown) => {
            onError(`${source.label} 수치를 읽지 못했습니다 (작업 공간이 아직 연결 중이면 잠시 뒤 다시 여세요): ${String(error)}`);
            return [];
          },
        ),
      ),
    ),
  );
  return lists.flat();
}

/**
 * Pi 관리 창의 "수치" 탭 (설계 DESIGN-APPS.md §7, DESIGN-ONE-APP.md §7 "한 목록").
 * 그 호스트 데몬의 수치(데몬 홈), 이 앱의 수치(이 PC, 웹이면 웹 서버), 켜 둔 Agent·Mate 작업 공간의 수치,
 * 휴대폰 웹의 수치(읽기 전용)를 한 목록으로 보이고 "작업 공간"으로 거른다.
 * Pi 데몬 항목은 id가 daemon., 앱 항목은 app.으로, 작업 공간 항목은 agent:·mate:로 시작해 저장할 곳을 가른다.
 */
export function TunablesTab({ hostId, onError }: { hostId: string; onError: (message: string) => void }) {
  return (
    <TunablesPanel
      load={async () => {
        const [daemon, app, workspaces] = await Promise.all([
          window.piDesktop.daemonTunablesList(hostId).catch((error: unknown) => {
            onError(`데몬 수치를 읽지 못했습니다 (예전 데몬이면 다시 연결하면 됩니다): ${String(error)}`);
            return [];
          }),
          window.piDesktop.appTunablesList(),
          workspaceItems(onError),
        ]);
        appTunables.apply(app);
        return [...daemon, ...app, ...workspaces, ...describeTunables(WEB_TUNABLES, {})];
      }}
      save={async (id, value) => {
        const ws = /^(agent|mate):(kit|daemon|app):(.+)$/.exec(id);
        if (ws) {
          const source = WORKSPACE_SOURCES.find((s) => s.id === ws[1])!;
          const kind = ws[2] as WorkspaceTunableKind;
          return wrap(source.id, source.label, kind, await window.piDesktop.workspaceTunableSet(source.id, kind, ws[3]!, value));
        }
        if (id.startsWith("daemon.")) return window.piDesktop.daemonTunableSet(hostId, id, value);
        const item = await window.piDesktop.appTunableSet(id, value);
        // 화면이 쓰는 값은 그 자리에서 바꾼다 (다시 켤 필요가 없다)
        appTunables.apply([item]);
        return item;
      }}
      onError={onError}
      scopes={isWebClient() ? undefined : { defaultScope: "Pi", prefixes: { "agent:": "Agent", "mate:": "Mate" } }}
      file="Pi 데몬 것은 그 호스트의 ~/.pi-desktop/tunables.json, Pi 앱 것은 이 PC 앱 데이터 폴더의 app-tunables.json. Agent·Mate 것은 각 작업 공간 홈(~/.pi-desktop-agent, ~/.pi-desktop-mate)과 앱 데이터 폴더의 agent/·mate/"
      applyNote="대부분 바로 반영됩니다. 시작할 때 읽는 값(업데이트 확인 간격, 데몬이 꺼지기까지 기다리는 시간)은 항목 설명에 언제 반영되는지 적혀 있습니다. Agent·Mate 항목은 그 작업 공간 설정 화면에도 같은 값이 보입니다."
    />
  );
}
