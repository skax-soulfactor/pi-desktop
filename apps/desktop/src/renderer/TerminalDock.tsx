import { useState } from "react";
import { TerminalView, type TerminalSpec } from "./TerminalView";

export interface DockTerminal {
  key: string;
  spec: TerminalSpec;
  title: string;
  /** 연 쪽이 정한 제목 (설치·로그인). 있으면 실행 정보로 덮어쓰지 않는다 */
  fixedTitle?: boolean;
  exited?: number;
}

/**
 * 작업 영역 아래의 터미널 도크 (설계 §4.12). 여러 터미널을 탭으로 담고, 접어 둘 수 있다.
 * 접거나 다른 탭을 보는 동안에도 터미널 프로세스는 계속 돈다.
 */
export function TerminalDock({
  terminals,
  active,
  onActivate,
  onClose,
  onUpdate,
}: {
  terminals: DockTerminal[];
  active: string | undefined;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onUpdate: (key: string, fields: Partial<DockTerminal>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (terminals.length === 0) return null;
  return (
    <section className={`terminal-dock${collapsed ? " collapsed" : ""}`} aria-label="터미널">
      <header className="terminal-tabs">
        {terminals.map((t) => (
          <div key={t.key} className={`terminal-tab${t.key === active ? " active" : ""}`}>
            <button
              type="button"
              className="terminal-tab-title"
              onClick={() => {
                onActivate(t.key);
                setCollapsed(false);
              }}
            >
              {t.title}
              {t.exited !== undefined && <span className="muted"> · 종료됨</span>}
            </button>
            <button type="button" className="terminal-tab-close" aria-label="터미널 닫기" title="터미널 닫기 (프로세스를 끝냅니다)" onClick={() => onClose(t.key)}>
              ×
            </button>
          </div>
        ))}
        <div className="spacer" />
        <button type="button" className="small" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "펼치기" : "접기 (터미널은 계속 돕니다)"}>
          {collapsed ? "▴" : "▾"}
        </button>
      </header>
      <div className="terminal-body" hidden={collapsed}>
        {terminals.map((t) => (
          <TerminalView
            key={t.key}
            spec={t.spec}
            visible={!collapsed && t.key === active}
            onOpened={(title) => {
              if (!t.fixedTitle) onUpdate(t.key, { title });
            }}
            onExit={(exitCode) => onUpdate(t.key, { exited: exitCode })}
          />
        ))}
      </div>
    </section>
  );
}
