import { useCallback, useEffect, useRef, useState } from "react";
import { Toasts } from "../vendor/renderer/ExtensionUi";
import type { ChatSummary, PiSetupView, StoredChat, UpdateState } from "../shared/api";
import { ChatPage } from "./ChatPage";
import { connectionLabel } from "./connection-label";
import { groupByFolder } from "./chat-groups";
import { DialogHost } from "./dialog-host";
import { FolderMenu } from "./FolderMenu";
import { MemoryPage } from "./MemoryPage";
import { PiSetupBanner } from "./PiSetupBanner";
import { RulesPage } from "./RulesPage";
import { UsagePage } from "./UsagePage";
import { HistoryPage } from "./HistoryPage";
import { McpPage } from "./McpPage";
import { NetworkPage } from "./NetworkPage";
import { SettingsPage } from "./SettingsPage";
import { TasksPanel } from "./TasksPanel";
import { folderName, lastFolder, recentFolders, rememberFolder } from "./recent-folders";
import { useAgentSession } from "./use-agent-session";

/** 화면. 대화 말고는 메뉴바(보기)에서 연다 (main/app-menu.ts) */
type Page = "chat" | "tasks" | "memory" | "rules" | "usage" | "history" | "mcp" | "network" | "settings";

/** 사이드바·대화 머리에 보일 이름: Pi 세션 이름, 없으면 폴더 이름 */
export function chatTitle(chat: Pick<ChatSummary, "name" | "cwd">): string {
  return chat.name?.trim() || folderName(chat.cwd);
}

export function App() {
  const agent = useAgentSession();
  const { connection, session, ui } = agent;
  const [page, setPage] = useState<Page>("chat");
  const [sessions, setSessions] = useState<ChatSummary[]>([]);
  const [setup, setSetup] = useState<PiSetupView>();
  const [update, setUpdate] = useState<UpdateState>();
  const [error, setError] = useState<string>();
  /** 대화 이름 바꾸기를 연다 (메뉴 F2·머리의 ✎). 값이 바뀔 때마다 ChatPage가 입력칸을 연다 */
  const [renameTick, setRenameTick] = useState(0);
  /** 최근 작업 폴더와 홈 (새 대화·폴더 옮기기에서 고른다) */
  const [recent, setRecent] = useState<string[]>(() => recentFolders());
  const [home, setHome] = useState<string>();
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

  useEffect(() => {
    void window.piAgent.defaultCwd().then(setHome);
  }, []);

  useEffect(() => {
    void window.piAgent.updateState().then(setUpdate);
    return window.piAgent.onUpdateState(setUpdate);
  }, []);

  const noteFolder = (folder: string) => {
    rememberFolder(folder);
    setRecent(recentFolders());
  };

  /** 새 대화. 폴더를 주지 않으면 마지막으로 쓴 폴더(없으면 홈) */
  const newChat = async (folder?: string) => {
    const cwd = folder ?? lastFolder() ?? (await window.piAgent.defaultCwd());
    noteFolder(cwd);
    setPage("chat");
    await agent.open(cwd);
  };

  /** 지금 대화를 다른 폴더로 옮겨 이어 간다 (분기, 원래 대화는 남음) */
  const moveTo = async (folder: string) => {
    noteFolder(folder);
    await agent.moveTo(folder);
    await refreshSessions();
  };

  /** 지난 대화를 연다. 이미 열려 있으면 그 대화로 가고, 아니면 세션 파일을 이어서 연다 */
  const reopen = async (chat: StoredChat) => {
    const running = sessions.find((s) => s.sessionFile === chat.path);
    setPage("chat");
    if (running) {
      if (running.sessionId !== session?.sessionId) await agent.attachTo(running);
      return;
    }
    noteFolder(chat.cwd);
    await agent.open(chat.cwd, { sessionFile: chat.path });
    await refreshSessions();
  };

  const moveToPicked = async () => {
    const folder = await window.piAgent.pickDirectory();
    if (folder) await moveTo(folder);
  };

  const newChatInFolder = async () => {
    const folder = await window.piAgent.pickDirectory();
    if (folder) await newChat(folder);
  };

  // 메뉴바 명령. 최신 상태를 쓰도록 ref로 넘긴다
  const menu = useRef<(id: string) => void>(() => {});
  menu.current = (id: string) => {
    if (id.startsWith("page:")) setPage(id.slice(5) as Page);
    else if (id === "new-chat") guard(() => newChat());
    else if (id === "new-chat-folder") guard(newChatInFolder);
    else if (id === "rename-chat" && session) {
      setPage("chat");
      setRenameTick((n) => n + 1);
    } else if (id === "close-chat" && session) guard(async () => (await agent.close(), await refreshSessions()));
  };
  useEffect(() => window.piAgent.onMenuCommand((id) => menu.current(id)), []);

  const current = sessions.find((s) => s.sessionId === session?.sessionId);
  const label = connectionLabel(connection);
  return (
    <div className="agent-shell">
      <nav className="nav">
        <div className="nav-brand">Pi Desktop Agent</div>
        <div className="row">
          <button
            className="primary grow"
            disabled={!connected}
            onClick={() => guard(() => newChat())}
            title={`마지막으로 쓴 폴더에서 새 대화 (Ctrl+N)\n${recent[0] ?? home ?? ""}`}
          >
            + 새 대화
          </button>
          <FolderMenu
            label="📁 ▾"
            title="폴더를 골라 새 대화 (Ctrl+O)"
            disabled={!connected}
            heading="이 폴더에서 새 대화"
            recent={recent}
            home={home}
            onPick={(folder) => guard(() => newChat(folder))}
            onBrowse={() => guard(newChatInFolder)}
          />
        </div>

        <div className="nav-section">
          <span>대화</span>
        </div>
        <ul className="nav-sessions">
          {sessions.length === 0 && <li className="muted small-text">열린 대화가 없습니다</li>}
          {groupByFolder(sessions).map((group) => (
            <li key={group.folder} className="nav-group">
              <div className="nav-group-head" title={group.folder}>
                📁 {group.name}
              </div>
              <ul>
                {group.chats.map((s) => (
                  <li key={s.sessionId} className={s.sessionId === session?.sessionId ? "active" : ""}>
                    <button
                      className="nav-session"
                      title={`${chatTitle(s)}\n${s.cwd}\n두 번 누르면 이름 바꾸기`}
                      onClick={() =>
                        guard(async () => {
                          setPage("chat");
                          if (s.sessionId !== session?.sessionId) await agent.attachTo(s);
                        })
                      }
                      onDoubleClick={() => {
                        if (s.sessionId === session?.sessionId) setRenameTick((n) => n + 1);
                      }}
                    >
                      <span className={s.name ? "" : "muted"}>{s.name?.trim() || "이름 없는 대화"}</span>
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
            </li>
          ))}
        </ul>
        <button className="link-button muted small-text nav-history" onClick={() => setPage("history")} title="지난 대화 찾기·다시 열기 (Ctrl+Shift+O)">
          지난 대화…
        </button>

        <div className="nav-foot">
          {update && (update.status === "available" || update.status === "downloaded") && (
            <button className="small primary" onClick={() => guard(() => window.piAgent.confirmUpdate())}>
              {update.status === "downloaded" ? `${update.version} 설치하려면 다시 시작` : `새 버전 ${update.version} 업데이트…`}
            </button>
          )}
          {update?.status === "downloading" && <span className="muted small-text">업데이트 내려받는 중 {update.percent ?? 0}%</span>}
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
        {page !== "chat" && (
          <div className="back-bar">
            <button className="small" onClick={() => setPage("chat")}>
              ← 대화로
            </button>
            <span className="muted small-text">기능 화면(작업·기억·승인·사용량·지난 대화·웹 검색·네트워크·설정)은 메뉴바의 "보기"에서 엽니다</span>
          </div>
        )}
        {page === "chat" && (
          <ChatPage
            agent={agent}
            connected={connected}
            title={current ? chatTitle(current) : session ? folderName(session.cwd) : undefined}
            renameTick={renameTick}
            onRenamed={() => guard(refreshSessions)}
            onNewChat={newChat}
            onNewChatInFolder={newChatInFolder}
            recent={recent}
            home={home}
            onMoveTo={(folder) => guard(() => moveTo(folder))}
            onMoveToPicked={() => guard(moveToPicked)}
            guard={guard}
          />
        )}
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
        {page === "usage" && <UsagePage onError={onError} />}
        {page === "mcp" && <McpPage onError={onError} />}
        {page === "network" && <NetworkPage onError={onError} />}
        {page === "history" && (
          <HistoryPage
            openFiles={new Set(sessions.flatMap((s) => (s.sessionFile ? [s.sessionFile] : [])))}
            onOpen={(chat) => guard(() => reopen(chat))}
            onError={onError}
          />
        )}
        {page === "settings" && <SettingsPage setup={setup} update={update} onRefresh={() => guard(refreshSetup)} onError={onError} />}
      </main>

      {ui.dialogs[0] && <DialogHost dialog={ui.dialogs[0]} onAnswer={(reply) => guard(() => agent.answer(ui.dialogs[0]!, reply))} />}
      <Toasts toasts={ui.toasts} onDismiss={agent.dismiss} />
    </div>
  );
}
