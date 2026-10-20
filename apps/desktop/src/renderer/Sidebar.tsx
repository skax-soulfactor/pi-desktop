import { useCallback, useEffect, useState } from "react";
import type { SessionSummary, StoredSession } from "@pi-desktop/host-protocol/messages";
import { baseName, formatRelative } from "./format";

type Scope = "folder" | "all";
const SCOPE_KEY = "pi-desktop.historyScope";

interface Props {
  hostId: string;
  connected: boolean;
  /** 데몬에서 실행 중인(또는 종료된 채 남은) 세션 */
  sessions: SessionSummary[];
  current?: SessionSummary;
  disabled: boolean;
  onSelect: (session: SessionSummary) => void;
  onOpenStored: (stored: StoredSession) => void;
}

/**
 * 세션 사이드바 (설계 §4.1).
 * - 실행 중: 데몬이 가진 세션. 확장 다이얼로그가 답을 기다리면 "입력 필요" 표시
 * - 기록: Pi가 디스크에 저장한 세션 (데몬이 Pi SDK로 읽음). 이 폴더 / 전체 범위 전환
 */
export function Sidebar({ hostId, connected, sessions, current, disabled, onSelect, onOpenStored }: Props) {
  const [scope, setScope] = useState<Scope>(() => {
    try {
      return localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "folder";
    } catch {
      return "folder";
    }
  });
  const [history, setHistory] = useState<StoredSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // 보던 세션이 없으면 폴더를 알 수 없으므로 전체를 보여준다.
  const folder = scope === "folder" ? current?.cwd : undefined;

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      setHistory(await window.piDesktop.listHistory(hostId, folder));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connected, hostId, folder]);

  useEffect(() => {
    setHistory([]);
    void load();
  }, [load, current?.sessionFile]);

  // 실행이 끝나면 기록(메시지 수·수정 시각)이 바뀌므로 잠시 모았다가 다시 읽는다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.piDesktop.onSessionEvent((id, n) => {
      if (id !== hostId || (n.event as { type?: string } | null)?.type !== "agent_settled") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 800);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [hostId, load]);

  const changeScope = (next: Scope) => {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // 무시
    }
  };

  const liveFiles = new Set(sessions.filter((s) => s.state === "running").map((s) => s.sessionFile));
  // 실행 중 세션은 폴더 이름만으로는 구별이 안 되므로, 같은 세션 파일의 기록에서 이름이나 첫 메시지를 가져온다.
  const storedByPath = new Map(history.map((h) => [h.path, h]));
  const liveTitle = (s: SessionSummary) => {
    const stored = s.sessionFile ? storedByPath.get(s.sessionFile) : undefined;
    return stored?.name ?? (stored?.firstMessage || baseName(s.cwd));
  };
  const ordered = [...sessions].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <aside className="sidebar">
      <section>
        <h3 className="sidebar-title">실행 중</h3>
        {ordered.length === 0 && <p className="sidebar-empty">실행 중인 세션이 없습니다.</p>}
        {ordered.map((s) => (
          <button
            key={s.sessionId}
            type="button"
            className={`session-item${s.sessionId === current?.sessionId ? " current" : ""}`}
            disabled={disabled}
            onClick={() => onSelect(s)}
            title={s.sessionFile ?? s.cwd}
          >
            <span className={`dot ${s.state}`} />
            <span className="session-name">{liveTitle(s)}</span>
            <span className="session-meta-line">
              {baseName(s.cwd)} · {formatRelative(s.startedAt)}
              {s.state === "exited" && " · 종료됨"}
            </span>
            {s.pendingUi > 0 && <span className="needs-input">입력 필요</span>}
          </button>
        ))}
      </section>

      <section className="history">
        <div className="sidebar-title-row">
          <h3 className="sidebar-title">기록</h3>
          <div className="segmented" role="tablist">
            <button
              type="button"
              className={scope === "folder" ? "on" : ""}
              disabled={!current}
              title={current ? current.cwd : "세션을 열면 그 폴더의 기록을 볼 수 있습니다"}
              onClick={() => changeScope("folder")}
            >
              이 폴더
            </button>
            <button type="button" className={scope === "all" || !current ? "on" : ""} onClick={() => changeScope("all")}>
              전체
            </button>
          </div>
        </div>
        {error && <p className="sidebar-error">{error}</p>}
        {!error && !loading && history.length === 0 && <p className="sidebar-empty">저장된 세션이 없습니다.</p>}
        {history.map((h) => {
          const open = liveFiles.has(h.path);
          return (
            <button
              key={h.path}
              type="button"
              className={`session-item${h.path === current?.sessionFile ? " current" : ""}`}
              disabled={disabled}
              onClick={() => onOpenStored(h)}
              title={h.path}
            >
              <span className="session-name">{h.name ?? (h.firstMessage || "(빈 세션)")}</span>
              <span className="session-meta-line">
                {formatRelative(h.modified)} · 메시지 {h.messageCount}
                {!folder && ` · ${baseName(h.cwd)}`}
                {h.parentSessionPath && " · 분기"}
                {open && " · 열려 있음"}
              </span>
            </button>
          );
        })}
      </section>
    </aside>
  );
}
