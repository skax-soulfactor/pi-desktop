import { useEffect, useState } from "react";
import type { WorkspacesState } from "../shared/api";

/**
 * Pi 관리 → "작업 공간" (설계 DESIGN-ONE-APP.md §7 공통): Agent·Mate 작업 공간을 켜고 끈다.
 * 메뉴바 "작업 공간"과 같은 일을 한다. 각 작업 공간의 설정(프롬프트와 수치, 모델 등)은 그 작업 공간의 설정 화면에 그대로 있다.
 */
export function WorkspacesTab({ onError }: { onError: (message: string) => void }) {
  const [state, setState] = useState<WorkspacesState>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    window.piDesktop.workspacesState().then(setState, (e: unknown) => onError(String(e)));
  }, [onError]);

  const toggle = async (id: WorkspacesState["plugins"][number]["id"], on: boolean) => {
    setBusy(id);
    try {
      setState(await window.piDesktop.setWorkspaceEnabled(id, on));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="card">
      <h3>작업 공간</h3>
      <p className="muted">
        Agent와 Mate를 이 창 안의 작업 공간으로 씁니다. 켜면 창 왼쪽 막대에 나타나고, 끄면 막대에서 사라지고 그 백그라운드(Agent 데몬 연결·Mate 실행기 연결)도 띄우지
        않습니다. 각 작업 공간의 데이터(<code>~/.pi-desktop-agent</code>, <code>~/.pi-desktop-mate</code>)는 그대로이고, 그 작업 공간의 설정은 작업 공간 안의 설정 화면에 있습니다.
      </p>
      {!state && <p className="muted">읽는 중…</p>}
      {state?.plugins.map((p) => (
        <label key={p.id} className="radio">
          <input type="checkbox" checked={p.enabled} disabled={busy === p.id} onChange={() => void toggle(p.id, !p.enabled)} />
          <strong>{p.name}</strong>
          <span className="muted">{p.reason ?? (p.enabled ? "켜져 있습니다. 막대에서 고르면 엽니다" : "꺼져 있습니다")}</span>
        </label>
      ))}
    </section>
  );
}
