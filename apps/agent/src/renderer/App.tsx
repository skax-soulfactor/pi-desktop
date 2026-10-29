import { useCallback, useEffect, useState } from "react";
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";
import { Toasts } from "../vendor/renderer/ExtensionUi";
import type { PiSetupView } from "../shared/api";
import { ChatPage } from "./ChatPage";
import { connectionLabel } from "./connection-label";
import { DialogHost } from "./dialog-host";
import { MemoryPage } from "./MemoryPage";
import { PiSetupBanner } from "./PiSetupBanner";
import { RulesPage } from "./RulesPage";
import { SettingsPage } from "./SettingsPage";
import { TasksPanel } from "./TasksPanel";
import { useAgentSession } from "./use-agent-session";

type Page = "chat" | "tasks" | "memory" | "rules" | "settings";

const PAGES: Array<{ id: Page; label: string; hint: string }> = [
  { id: "chat", label: "대화", hint: "에이전트와 대화" },
  { id: "tasks", label: "작업·예약", hint: "맡긴 작업과 예약 실행 결과" },
  { id: "memory", label: "기억", hint: "선호·사실·교훈" },
  { id: "rules", label: "승인", hint: "항상 허용 규칙과 최근 판단" },
  { id: "settings", label: "설정", hint: "Pi 상태·Pi Desktop·API 키" },
];

const LAST_CWD = "agent.lastCwd";

function readLastCwd(): string | undefined {
  try {
    return localStorage.getItem(LAST_CWD) ?? undefined;
  } catch {
    return undefined;
  }
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function App() {
  const agent = useAgentSession();
  const { connection, session, ui } = agent;
  const [page, setPage] = useState<Page>("chat");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [setup, setSetup] = useState<PiSetupView>();
  const [error, setError] = useState<string>();
  const connected = connection.status === "connected";

  /** 실패는 어느 화면에서든 보이도록 위쪽 띠로 알린다 */
  const onError = useCallback((message: string) => setError(message), []);
  const guard = useCallback(
    (action: () => Promise<void>) => {
      action().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    },
    [onError],
  );

  const refreshSessions = useCallback(async () => setSessions(await window.piAgent.listSessions()), []);
  const refreshSetup = useCallback(async () => setSetup(await window.piAgent.piSetup()), []);

  // 데몬에 붙으면 Pi 상태와 돌고 있는 대화를 읽는다
  useEffect(() => {
    if (!connected) return;
    refreshSetup().catch(() => undefined);
    refreshSessions().catch(() => undefined);
  }, [connected, refreshSetup, refreshSessions]);

  useEffect(() => {
    if (connected) refreshSessions().catch(() => undefined);
  }, [session?.sessionId, connected, refreshSessions]);

  const newChat = async (folder?: string) => {
    const cwd = folder ?? readLastCwd() ?? (await window.piAgent.defaultCwd());
    try {
      localStorage.setItem(LAST_CWD, cwd);
    } catch {
      // 기억하지 못해도 대화는 연다
    }
    setPage("chat");
    await agent.open(cwd);
  };

  const label = connectionLabel(connection);
  return (
    <div className="agent-shell">
      <nav className="nav">
        <div className="nav-brand">Pi Desktop Agent</div>
        {PAGES.map((p) => (
          <button key={p.id} className={`nav-item ${page === p.id ? "active" : ""}`} title={p.hint} onClick={() => setPage(p.id)}>
            {p.label}
          </button>
        ))}

        <div className="nav-section">
          <span>대화</span>
          <button className="small" disabled={!connected} onClick={() => guard(() => newChat())} title="마지막으로 쓴 폴더에서 새 대화">
            + 새 대화
          </button>
        </div>
        <ul className="nav-sessions">
          {sessions.length === 0 && <li className="muted small-text">열린 대화가 없습니다</li>}
          {sessions.map((s) => (
            <li key={s.sessionId} className={s.sessionId === session?.sessionId ? "active" : ""}>
              <button
                className="nav-session"
                title={s.cwd}
                onClick={() =>
                  guard(async () => {
                    setPage("chat");
                    if (s.sessionId !== session?.sessionId) await agent.attachTo(s);
                  })
                }
              >
                <span>{folderName(s.cwd)}</span>
                <span className="muted small-text">{new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                {s.pendingUi > 0 && <span className="badge warn">입력 필요</span>}
              </button>
              <button
                className="nav-close"
                title="이 대화 닫기"
                onClick={() =>
                  guard(async () => {
                    if (s.sessionId === session?.sessionId) await agent.close();
                    else await window.piAgent.closeSession(s.sessionId);
                    await refreshSessions();
                  })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="nav-foot">
          <span className={`badge ${label.tone}`}>{label.text}</span>
          {setup?.piVersion && <span className="muted small-text">Pi {setup.piVersion}</span>}
        </div>
      </nav>

      <main className="main">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="small" onClick={() => setError(undefined)}>
              닫기
            </button>
          </div>
        )}
        {setup && page !== "settings" && <PiSetupBanner setup={setup} onRefresh={() => guard(refreshSetup)} onError={onError} />}
        {page === "chat" && <ChatPage agent={agent} connected={connected} onNewChat={newChat} guard={guard} />}
        {page === "tasks" && (
          <div className="page">
            <header className="page-head">
              <h2>작업·예약</h2>
              <span className="muted">대화에서 "백그라운드로 …", "매일 9시에 …"처럼 부탁하면 여기에 나타납니다. 예약은 앱을 닫아도 돕니다.</span>
            </header>
            <div className="page-body">
              <TasksPanel onError={onError} />
            </div>
          </div>
        )}
        {page === "memory" && <MemoryPage onError={onError} />}
        {page === "rules" && <RulesPage onError={onError} />}
        {page === "settings" && <SettingsPage setup={setup} onRefresh={() => guard(refreshSetup)} onError={onError} />}
      </main>

      {ui.dialogs[0] && <DialogHost dialog={ui.dialogs[0]} onAnswer={(reply) => guard(() => agent.answer(ui.dialogs[0]!, reply))} />}
      <Toasts toasts={ui.toasts} onDismiss={agent.dismiss} />
    </div>
  );
}
