import { useCallback, useEffect, useState } from "react";
import type { WorkspaceId, WorkspacesState } from "../shared/api";
import { App } from "./App";

/**
 * 창의 뿌리 (설계 DESIGN-ONE-APP.md): 작업 공간 막대 + 작업 공간들.
 * - "pi" 작업 공간은 지금까지의 Pi Desktop 화면(App)이다. 켜고 끄거나 바꿔도 다시 그리지 않도록 늘 같은 자리에 두고 숨기기만 한다.
 * - 켠 플러그인(지금은 Agent·Mate 미리 보기)은 그 앱의 화면을 iframe으로 연다. 한 번 연 프레임은 숨겨도 남아 대화가 이어진다.
 * - 켠 플러그인이 없으면(기본, 웹) 막대 없이 지금과 똑같다.
 */
export function Shell() {
  const [state, setState] = useState<WorkspacesState>();
  const [active, setActive] = useState<WorkspaceId>("pi");
  // 한 번이라도 보인 플러그인만 프레임을 만든다 (켜 두기만 하고 열지 않은 화면은 불러오지 않는다)
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const refresh = useCallback(() => {
    window.piDesktop.workspacesState().then(setState, () => setState(undefined));
  }, []);

  const show = useCallback((id: WorkspaceId) => {
    setActive(id);
    if (id !== "pi") setOpened((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    void window.piDesktop.workspaceShown(id).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    // main이 작업 공간을 바꾸라고 할 때 (알림을 누름·메뉴바·켜고 끄기)
    return window.piDesktop.onShowWorkspace((id) => {
      refresh();
      show(id);
    });
  }, [refresh, show]);

  const plugins = (state?.plugins ?? []).filter((p) => p.enabled && p.url);
  // 꺼진 플러그인을 보고 있었으면 Pi로 돌아간다
  useEffect(() => {
    if (active !== "pi" && state && !plugins.some((p) => p.id === active)) show("pi");
  }, [active, state, plugins, show]);

  return (
    <div className="ws-root">
      {plugins.length > 0 ? (
        <nav className="ws-bar" aria-label="작업 공간">
          <button type="button" className={active === "pi" ? "on" : ""} title="Pi" aria-label="Pi 작업 공간" onClick={() => show("pi")}>
            Pi
          </button>
          {plugins.map((p) => (
            <button key={p.id} type="button" className={active === p.id ? "on" : ""} title={p.name} aria-label={`${p.name} 작업 공간`} onClick={() => show(p.id)}>
              {p.id === "agent" ? "A" : p.id === "mate" ? "M" : String(p.id).slice(0, 1).toUpperCase()}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="ws-pane" hidden={active !== "pi"}>
        <App />
      </div>
      {plugins
        .filter((p) => opened[p.id])
        .map((p) => (
          <div key={p.id} className="ws-pane" hidden={active !== p.id}>
            <iframe
              className="ws-frame"
              title={p.name}
              src={p.url}
              onLoad={() => void window.piDesktop.workspaceReady(p.id).catch(() => undefined)}
            />
          </div>
        ))}
    </div>
  );
}
