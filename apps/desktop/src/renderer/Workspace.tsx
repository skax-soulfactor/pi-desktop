import { useEffect, useState, type KeyboardEvent } from "react";
import { ChatView } from "./ChatView";
import { ChoiceDialog } from "./ChoiceDialog";
import { baseName, formatRelative } from "./format";
import { tuiCommand } from "./tui-command";
import { useSession } from "./use-session";
import { ExtensionDialog, StatusLine, Toasts, Widgets } from "./ExtensionUi";
import { SessionBar } from "./SessionBar";
import { Sidebar } from "./Sidebar";
import { TreePanel } from "./TreePanel";
import { useSessionInfo } from "./use-session-info";

/** 탭 표시와 백그라운드 알림에 쓰는 워크스페이스 상태 */
export interface WorkspaceStatus {
  title: string;
  hostId: string;
  /** 호스트 이름 (예: 로컬, WSL: Ubuntu) */
  hostLabel: string;
  running: boolean;
  /** 확장 다이얼로그, 끼어들기 경고, 열기 선택처럼 사용자의 답을 기다림 */
  needsInput: boolean;
  disconnected: boolean;
}

interface WorkspaceProps {
  tabId: string;
  /** 지금 보이는 탭인지. 숨긴 탭도 연결과 상태는 유지한다 */
  active: boolean;
  onStatus: (tabId: string, status: WorkspaceStatus) => void;
}

/**
 * 워크스페이스 하나 = 탭 하나 (설계 §3.3). 호스트와 세션을 탭마다 따로 가진다.
 */
export function Workspace({ tabId, active, onStatus }: WorkspaceProps) {
  const {
    hosts,
    host,
    hostId,
    selectHost,
    connection,
    sessions,
    session,
    lost,
    chat,
    ui,
    openSession,
    reopenLost,
    switchTo,
    send,
    respondDialog,
    openStored,
    branchSession,
    follow,
    pendingOpen,
    cancelPendingOpen,
    stopFollow,
    handOffToTui,
    continueFollowedAsFork,
    ignoreExternalWrite,
    dismissToast,
  } = useSession(tabId);
  const isLocal = host?.kind !== "wsl";
  const [cwd, setCwd] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [treeOpen, setTreeOpen] = useState(false);
  const [handoffAsk, setHandoffAsk] = useState(false);
  const [handoffCommand, setHandoffCommand] = useState<string | undefined>();

  const connected = connection.status === "connected";
  const sessionInfo = useSessionInfo(hostId, session, connected && !lost);
  // 이 앱의 Pi가 쓰는 세션 파일에 다른 프로그램이 썼다 (TUI 등). 같은 파일에 함께 쓰면 기록이 꼬이므로 입력을 잠근다.
  const externalWrite = session?.externalWriteAt !== undefined && !lost;

  // 확장이 setTitle로 바꾼 제목을 창 제목에 반영한다 (보이는 탭만).
  useEffect(() => {
    if (active) document.title = ui.title ? `${ui.title} — Pi Desktop` : "Pi Desktop";
  }, [ui.title, active]);

  // 탭 표시와 백그라운드 알림을 위해 상태를 알린다.
  const statusTitle = ui.title ?? follow?.title ?? (session ? baseName(session.cwd) : follow ? baseName(follow.cwd) : "새 탭");
  const needsInput = ui.dialogs.length > 0 || externalWrite || Boolean(pendingOpen);
  const disconnected = connection.status === "disconnected";
  const hostLabel = host?.label ?? hostId;
  useEffect(() => {
    onStatus(tabId, { title: statusTitle, hostId, hostLabel, running: chat.running, needsInput, disconnected });
  }, [onStatus, tabId, statusTitle, hostId, hostLabel, chat.running, needsInput, disconnected]);

  // 확장이 set_editor_text로 넣어 달라고 한 글을 입력창에 채운다.
  // 요청(seq)마다 한 번만 적용해, 사용자가 이어서 고친 내용을 다시 덮어쓰지 않는다.
  const editorText = ui.editorText;
  useEffect(() => {
    if (editorText) setDraft(editorText.text);
  }, [editorText?.seq]);

  /**
   * 다이얼로그 응답처럼 다른 작업을 막지 않아야 하는 동작용. 실패만 배너로 보여준다.
   * (확장 명령을 보낸 prompt는 다이얼로그에 답할 때까지 끝나지 않아 busy 상태이므로 guard를 쓰면 안 된다)
   */
  async function guardQuiet(task: () => Promise<void>) {
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function guard(task: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 팔로우가 끝나면 터미널 안내도 지운다.
  useEffect(() => {
    if (!follow) setHandoffCommand(undefined);
  }, [follow]);

  /** 지금 세션을 터미널 pi로 넘긴다: GUI 쪽 Pi를 닫고 명령을 복사한 뒤 읽기 전용으로 따라 보여준다. */
  async function handOff() {
    setHandoffAsk(false);
    await guard(async () => {
      const target = await handOffToTui();
      if (!target) return;
      const posix = host?.kind === "wsl" || connection.status !== "connected" || connection.host.platform !== "win32";
      const command = tuiCommand(posix ? "posix" : "windows", target.cwd, target.sessionFile);
      setHandoffCommand(command);
      try {
        await navigator.clipboard.writeText(command);
      } catch {
        // 복사에 실패해도 배너에 명령이 보이므로 직접 복사할 수 있다.
      }
    });
  }

  /** 트리에서 고른 질문 직전에서 분기한다. Pi가 돌려준 질문 원문을 입력창에 채워 고쳐 보낼 수 있게 한다. */
  function forkAt(entryId: string) {
    void guard(async () => {
      const data = await branchSession({ type: "fork", entryId });
      if (typeof data?.text === "string") setDraft(data.text);
    });
  }

  /** 실행 중이면 Pi 규칙대로 steer/followUp 중 하나를 지정해야 한다. */
  function submit(behavior?: "steer" | "followUp") {
    const message = draft.trim();
    if (!message || !session) return;
    setDraft("");
    void guard(() =>
      send(behavior ? { type: "prompt", message, streamingBehavior: behavior } : { type: "prompt", message }),
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(chat.running ? "followUp" : undefined);
    }
  }

  return (
    <div className="app" hidden={!active}>
      <header className="topbar">
        <div className="brand">Pi Desktop</div>
        <select
          className="host-select"
          aria-label="호스트"
          value={hostId}
          onChange={(e) => {
            setCwd("");
            selectHost(e.target.value);
          }}
        >
          {hosts.length === 0 && <option value={hostId}>{hostId}</option>}
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
        <ConnectionBadge connection={connection} />
        <div className="spacer" />
        {session && (
          <div className="session-meta" title={session.sessionFile}>
            Pi {session.piVersion} · {session.cwd}
          </div>
        )}
        {session?.sessionFile && !lost && (
          <button type="button" onClick={() => setHandoffAsk(true)} title="이 세션을 터미널의 pi로 이어서 엽니다">
            TUI에서 열기
          </button>
        )}
      </header>

      <section className="toolbar">
        <input
          className="cwd"
          placeholder={isLocal ? "작업 폴더 경로" : "WSL 안의 작업 폴더 경로 (예: /home/me/project)"}
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          disabled={!connected || busy}
        />
        {/* 폴더 선택 대화상자는 Windows 파일 시스템만 보여주므로 로컬 호스트에서만 쓴다. WSL 탐색은 M1 후반. */}
        {isLocal && (
          <button
            type="button"
            disabled={!connected || busy}
            onClick={() =>
              void guard(async () => {
                const picked = await window.piDesktop.pickDirectory();
                if (picked) setCwd(picked);
              })
            }
          >
            폴더 선택
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={!connected || busy || !cwd.trim()}
          onClick={() => void guard(() => openSession(cwd.trim()))}
        >
          새 세션
        </button>
      </section>

      <div className="workspace">
        <Sidebar
          hostId={hostId}
          connected={connected}
          sessions={sessions}
          current={session}
          disabled={!connected || busy}
          onSelect={(target) => void guard(() => switchTo(target))}
          onOpenStored={(stored) => void guard(() => openStored(stored))}
        />
        <div className="main">

      {connection.status === "disconnected" && (
        <div className="banner error">
          {host?.label ?? hostId}에 연결하지 못했습니다. 자동으로 다시 시도합니다.
          {"\n"}
          {connection.reason}
        </div>
      )}
      {lost && connected && (
        <div className="banner warn">
          <span>
            {lost.reason === "missing"
              ? "Host Agent가 재시작되어 이 세션의 Pi 프로세스가 없습니다."
              : "이 세션의 Pi 프로세스가 종료되었습니다."}
            {lost.sessionFile
              ? " 같은 세션 파일로 다시 열면 대화를 이어 갈 수 있습니다."
              : " 세션 파일이 없어 새 세션으로 열립니다."}
          </span>
          <button type="button" className="primary" disabled={busy} onClick={() => void guard(reopenLost)}>
            다시 열기
          </button>
        </div>
      )}
      {externalWrite && (
        <div className="banner warn">
          <span>
            다른 프로그램(터미널의 pi 등)이 이 세션 파일에 쓰고 있습니다. 같은 파일에 함께 쓰면 기록이 꼬일 수 있어 입력을
            잠갔습니다.
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void guard(async () => void (await handOffToTui()))}
            title="이 앱의 Pi를 닫고, 다른 프로그램이 쓰는 내용을 읽기 전용으로 따라갑니다"
          >
            닫고 따라가기
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void guard(async () => void (await branchSession({ type: "clone" })))}
            title="지금까지의 이 앱 쪽 대화를 새 파일로 복제해 따로 이어 갑니다"
          >
            복제해서 계속
          </button>
          <button type="button" disabled={busy} onClick={() => void guard(ignoreExternalWrite)} title="기록이 섞일 수 있습니다">
            무시하고 계속
          </button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {follow && (
        <div className="banner follow">
          <span>
            읽기 전용으로 따라가는 중입니다{follow.title ? `: ${follow.title}` : ""}. 다른 프로그램이 이 세션 파일에 쓰는 내용이
            그대로 보입니다.
            {handoffCommand && (
              <>
                {"\n"}터미널에서 실행하세요 (클립보드에 복사됨): <code>{handoffCommand}</code>
              </>
            )}
          </span>
          <button type="button" className="primary" disabled={busy} onClick={() => void guard(continueFollowedAsFork)}>
            분기해서 이어 쓰기
          </button>
          <button type="button" onClick={() => stopFollow()}>
            그만 보기
          </button>
        </div>
      )}

      {session && (
        <SessionBar
          info={sessionInfo.info}
          running={chat.running}
          disabled={!connected || Boolean(lost) || busy}
          onModel={(provider, id) => void guard(() => sessionInfo.setModel(provider, id))}
          onThinking={(level) => void guard(() => sessionInfo.setThinkingLevel(level))}
          onCompact={() => void guard(sessionInfo.compact)}
          treeOpen={treeOpen}
          onToggleTree={() => setTreeOpen((open) => !open)}
        />
      )}

      <ChatView items={chat.items} running={chat.running} />

      <Widgets ui={ui} placement="aboveEditor" />
      <footer className="composer">
        <textarea
          placeholder={session ? "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)" : "먼저 세션을 여세요"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!session || !connected || Boolean(lost) || Boolean(follow) || Boolean(externalWrite)}
          rows={3}
        />
        <div className="actions">
          {chat.running ? (
            <>
              <button type="button" disabled={!draft.trim()} onClick={() => submit("steer")} title="현재 턴이 끝나면 바로 끼워 넣기">
                Steer
              </button>
              <button type="button" disabled={!draft.trim()} onClick={() => submit("followUp")} title="작업이 모두 끝난 뒤 보내기">
                Follow-up
              </button>
              <button type="button" className="danger" onClick={() => void guard(() => send({ type: "abort" }))}>
                중단
              </button>
            </>
          ) : (
            <button type="button" className="primary" disabled={!session || !draft.trim()} onClick={() => submit()}>
              보내기
            </button>
          )}
        </div>
      </footer>
      <Widgets ui={ui} placement="belowEditor" />
      <StatusLine ui={ui} />
        </div>
        {session && treeOpen && (
          <TreePanel
            hostId={hostId}
            session={session}
            disabled={!connected || Boolean(lost) || busy || chat.running}
            onFork={forkAt}
            onClone={() => void guard(async () => void (await branchSession({ type: "clone" })))}
            onClose={() => setTreeOpen(false)}
          />
        )}
      </div>
      {/* 다이얼로그와 토스트는 보이는 탭에서만 띄운다. 숨긴 탭의 요청은 남아 있다가 탭을 열면 뜬다. */}
      {active && ui.dialogs[0] && (
        <ExtensionDialog
          dialog={ui.dialogs[0]}
          onAnswer={(answer) => void guardQuiet(() => respondDialog(ui.dialogs[0]!, answer))}
        />
      )}
      {pendingOpen && (
        <ChoiceDialog
          title="다른 곳에서 쓰고 있을 수 있는 세션입니다"
          onCancel={cancelPendingOpen}
          choices={[
            { label: "읽기 전용으로 따라가기", kind: "primary", onSelect: () => void guard(() => openStored(pendingOpen, "follow")) },
            { label: "분기해서 새 세션으로 이어 쓰기", onSelect: () => void guard(() => openStored(pendingOpen, "fork")) },
            { label: "그래도 이 파일로 열기", kind: "danger", onSelect: () => void guard(() => openStored(pendingOpen, "open")) },
          ]}
        >
          이 세션 파일은 {formatRelative(pendingOpen.modified)} 수정되었고, 이 앱이 쓰고 있는 파일이 아닙니다. 터미널의 Pi(TUI)
          등에서 열려 있다면 같은 파일에 함께 쓸 때 기록이 꼬일 수 있습니다.
        </ChoiceDialog>
      )}
      {handoffAsk && session && (
        <ChoiceDialog
          title="터미널 Pi(TUI)로 넘기기"
          onCancel={() => setHandoffAsk(false)}
          choices={[{ label: "GUI 세션을 닫고 명령 복사", kind: "primary", onSelect: () => void handOff() }]}
        >
          같은 파일에 GUI와 TUI가 함께 쓰지 않도록 GUI 쪽 Pi를 먼저 닫습니다. 그 뒤 터미널에서 실행할 명령을 복사하고, 이
          창에서는 읽기 전용으로 계속 따라 보여줍니다.
        </ChoiceDialog>
      )}
      {active && <Toasts toasts={ui.toasts} onDismiss={dismissToast} />}
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ReturnType<typeof useSession>["connection"] }) {
  switch (connection.status) {
    case "connected": {
      const { host } = connection;
      return (
        <span className="badge ok" title={`데몬 pid ${host.pid} · ${host.platform} · Node ${host.nodeVersion}`}>
          연결됨 · agent {host.agentVersion}
        </span>
      );
    }
    case "connecting":
      return <span className="badge">연결 중…</span>;
    case "idle":
      return <span className="badge">대기</span>;
    case "disconnected":
      return (
        <span className="badge bad" title={connection.reason}>
          연결 끊김 · 재시도 중
        </span>
      );
  }
}
