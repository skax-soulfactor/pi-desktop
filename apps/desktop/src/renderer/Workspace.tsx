import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredSession } from "@pi-desktop/host-protocol/messages";
import type { PendingQueue } from "./chat-state";
import { ChatView } from "./ChatView";
import { ChoiceDialog } from "./ChoiceDialog";
import { PiManager, usePiStatus } from "./PiManager";
import { TerminalDock, type DockTerminal } from "./TerminalDock";
import type { TerminalSpec } from "./TerminalView";
import { updateState } from "./pi-manager-view";
import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./palette";
import { Composer } from "./Composer";
import { modelAcceptsImages, rpcImages, type ImageAttachment } from "./attachments";
import type { ParsedInput, PiCommand } from "./composer-input";
import { baseName, formatRelative } from "./format";
import { tuiCommand } from "./tui-command";
import { useSession } from "./use-session";
import { ExtensionDialog, StatusLine, Toasts, Widgets } from "./ExtensionUi";
import { FolderBrowser } from "./FolderBrowser";
import { SshHostsDialog } from "./SshHostsDialog";
import { restoreQueueToDraft } from "./run-status";
import { QueuePanel, RetryBanner } from "./RunStatus";
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
  /** 보고 있는 세션 (활동 패널에서 이 탭으로 오기 위해) */
  sessionId?: string;
}

interface WorkspaceProps {
  tabId: string;
  /** 지금 보이는 탭인지. 숨긴 탭도 연결과 상태는 유지한다 */
  active: boolean;
  onStatus: (tabId: string, status: WorkspaceStatus) => void;
  /** 명령 팔레트에 넣을 앱 수준 명령 (탭 열기·닫기·이동) */
  appCommands: PaletteCommand[];
}

/**
 * 워크스페이스 하나 = 탭 하나 (설계 §3.3). 호스트와 세션을 탭마다 따로 가진다.
 */
/** 호스트 선택 목록에서 SSH 호스트 관리 창을 여는 항목 */
const SSH_MANAGE = "__ssh-manage__";

export function Workspace({ tabId, active, onStatus, appCommands }: WorkspaceProps) {
  const {
    hosts,
    host,
    hostId,
    selectHost,
    reloadHosts,
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
  const isLocal = host?.kind === "local";
  const [cwd, setCwd] = useState("");
  const [draft, setDraftState] = useState("");
  const [commands, setCommands] = useState<PiCommand[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /** 오류가 아닌 알림 (예: HTML로 내보낸 위치) */
  const [info, setInfo] = useState<string | undefined>();
  /** 값이 바뀌면 사이드바가 기록을 다시 읽는다 */
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [treeOpen, setTreeOpen] = useState(false);
  const [piManagerOpen, setPiManagerOpen] = useState(false);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [agentReplaceAsk, setAgentReplaceAsk] = useState(false);
  const [sshHostsOpen, setSshHostsOpen] = useState(false);
  /** 아래 도크의 내장 터미널들 (설계 §4.12) */
  const [dockTerminals, setDockTerminals] = useState<DockTerminal[]>([]);
  const [activeTerminal, setActiveTerminal] = useState<string | undefined>();
  /** title을 주면 그 제목을 유지하고, 없으면 열린 뒤 실행 정보(예: "셸 (WSL: Ubuntu)")로 채운다 */
  const openTerminal = (spec: TerminalSpec, title?: string) => {
    const key = crypto.randomUUID();
    setDockTerminals((prev) => [...prev, { key, spec, title: title ?? "터미널", fixedTitle: title !== undefined }]);
    setActiveTerminal(key);
  };
  const closeTerminal = (key: string) => {
    setDockTerminals((prev) => {
      const next = prev.filter((t) => t.key !== key);
      setActiveTerminal((current) => (current === key ? next.at(-1)?.key : current));
      return next;
    });
  };
  /** 명령 팔레트가 열려 있으면 그때 읽은 최근 기록 */
  const [palette, setPalette] = useState<{ history: StoredSession[] } | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const [handoffAsk, setHandoffAsk] = useState(false);
  const [handoffCommand, setHandoffCommand] = useState<string | undefined>();

  const connected = connection.status === "connected";
  const sessionInfo = useSessionInfo(hostId, session, connected && !lost);
  // 상단 바의 Pi 버전·업데이트 표시 (연결되면 한 번 읽는다. 최신 버전은 데몬이 캐시)
  const piState = usePiStatus(hostId, connected);
  const piUpdate = updateState(piState.status?.pi?.version, piState.latest);
  // 이 앱의 Pi가 쓰는 세션 파일에 다른 프로그램이 썼다 (TUI 등). 같은 파일에 함께 쓰면 기록이 꼬이므로 입력을 잠근다.
  const externalWrite = session?.externalWriteAt !== undefined && !lost;

  // 입력 중인 초안을 세션 파일별로 저장해 두었다가 그 세션을 다시 열면 되살린다.
  const draftKey = session ? `pi-desktop.draft.${hostId}.${session.sessionFile ?? session.sessionId}` : undefined;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  /** 세션을 바꾸면서 넣을 글 (분기 직후 원래 질문). 새 세션의 저장된 초안보다 우선한다 */
  const pendingDraft = useRef<string | undefined>(undefined);
  const setDraft = useCallback((text: string) => {
    setDraftState(text);
    saveDraft(draftKeyRef.current, text);
  }, []);
  useEffect(() => {
    const text = pendingDraft.current ?? loadDraft(draftKey);
    pendingDraft.current = undefined;
    setDraftState(text);
    saveDraft(draftKey, text);
  }, [draftKey]);

  // `/` 자동완성용 명령 목록은 세션마다 다르므로(프로젝트 프롬프트·스킬) 세션이 바뀌면 다시 읽는다.
  const sessionId = session?.sessionId;
  useEffect(() => setCommands(undefined), [sessionId]);
  const loadCommands = useCallback(() => {
    if (!sessionId) return;
    setCommands([]);
    void window.piDesktop
      .sendCommand(hostId, sessionId, { type: "get_commands" })
      .then((response) => {
        const list = (response.data as { commands?: PiCommand[] } | undefined)?.commands;
        setCommands(Array.isArray(list) ? list : []);
      })
      // 실패하면 빈 목록으로 두어 계속 다시 요청하지 않는다. 세션이 바뀌면 다시 읽는다.
      .catch(() => setCommands([]));
  }, [hostId, sessionId]);

  // 입력창 @ 파일 피커: 데몬이 세션 작업 폴더에서 찾는다 (WSL이면 WSL 안의 파일).
  const sessionCwd = session?.cwd;
  const searchFiles = useCallback(
    async (query: string) => {
      if (!sessionCwd) return [];
      return (await window.piDesktop.searchFiles(hostId, sessionCwd, query)).files;
    },
    [hostId, sessionCwd],
  );

  // 확장이 setTitle로 바꾼 제목을 창 제목에 반영한다 (보이는 탭만).
  useEffect(() => {
    if (active) document.title = ui.title ? `${ui.title} — Pi Desktop` : "Pi Desktop";
  }, [ui.title, active]);

  // 탭 표시와 백그라운드 알림을 위해 상태를 알린다.
  const statusTitle = ui.title ?? sessionInfo.info.sessionName ?? session?.title ?? follow?.title ?? (session ? baseName(session.cwd) : follow ? baseName(follow.cwd) : "새 탭");
  const needsInput = ui.dialogs.length > 0 || externalWrite || Boolean(pendingOpen);
  const disconnected = connection.status === "disconnected";
  const hostLabel = host?.label ?? hostId;
  useEffect(() => {
    const sessionId = session?.sessionId;
    onStatus(tabId, {
      title: statusTitle,
      hostId,
      hostLabel,
      running: chat.running,
      needsInput,
      disconnected,
      ...(sessionId ? { sessionId } : {}),
    });
  }, [onStatus, tabId, statusTitle, hostId, hostLabel, chat.running, needsInput, disconnected, session?.sessionId]);

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
      if (typeof data?.text === "string") {
        pendingDraft.current = data.text;
        setDraft(data.text);
      }
    });
  }

  /**
   * 세션을 HTML로 내보낸다. 사용자 저장소에 파일이 생기지 않도록 세션 파일 옆에 만든다.
   * 로컬·WSL이면 탐색기에서 보여주고, 어느 경우든 경로를 알림으로 남긴다.
   */
  async function exportHtml() {
    if (!session) return;
    const path = await sessionInfo.exportHtml(session.sessionFile);
    if (!path) throw new Error("HTML 내보내기 결과에 파일 경로가 없습니다");
    const revealed = await window.piDesktop.revealFile(hostId, session.cwd, path);
    setInfo(revealed ? `HTML로 내보냈습니다 (탐색기에서 열림): ${path}` : `HTML로 내보냈습니다: ${path}`);
  }

  /** 대기 중인 Steer·Follow-up을 취소하고 그 글을 입력창으로 되돌린다 (TUI의 Esc). */
  async function clearQueue() {
    if (!session) return;
    const response = await window.piDesktop.sendCommand(hostId, session.sessionId, { type: "clear_queue" });
    if (response.success !== true) throw new Error(String(response.error ?? "clear_queue 실패"));
    setDraft(restoreQueueToDraft(response.data as Partial<PendingQueue> | undefined, draft));
  }

  /**
   * 중단. Pi는 abort만 하면 큐에 남은 메시지를 이어서 처리하므로, 큐를 먼저 입력창으로 꺼낸 뒤 멈춘다
   * (Pi rpc-commands.md clear_queue 안내와 같은 순서).
   */
  /** 명령 팔레트를 연다. 최근 기록과 Pi 명령 목록을 함께 읽는다 */
  async function openPalette() {
    setPalette({ history: [] });
    if (session && !commands) loadCommands();
    if (!connected) return;
    const history = await window.piDesktop.listHistory(hostId, undefined).catch(() => []);
    setPalette((prev) => (prev ? { history: history.slice(0, 15) } : prev));
  }

  // 팔레트가 닫혀 화면에서 빠진 다음에 포커스를 준다 (같은 순간에 주면 사라지는 입력칸에 밀린다).
  const focusComposer = () =>
    setTimeout(() => root.current?.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 30);

  /** 지금 상태에서 쓸 수 있는 명령. 쓸 수 없는 것은 disabled로 빠진다 */
  function paletteCommands(history: StoredSession[]): PaletteCommand[] {
    const ready = Boolean(session) && connected && !lost;
    const idle = ready && !chat.running;
    const list: PaletteCommand[] = [...appCommands];
    if (session) {
      list.push({
        id: "session-new-here",
        group: "세션",
        title: "같은 폴더에서 새 세션",
        hint: baseName(session.cwd),
        disabled: !connected,
        run: () => void guard(() => openSession(session.cwd)),
      });
    }
    for (const s of sessions) {
      if (s.sessionId === session?.sessionId || s.state !== "running") continue;
      list.push({
        id: `session-${s.sessionId}`,
        group: "실행 중",
        title: s.title ?? baseName(s.cwd),
        hint: baseName(s.cwd),
        run: () => void guard(() => switchTo(s)),
      });
    }
    // 실행 중인 세션은 위 "실행 중"에 있으므로 기록에서는 뺀다.
    const liveFiles = new Set(sessions.filter((s) => s.state === "running").map((s) => s.sessionFile));
    for (const h of history) {
      if (h.path === session?.sessionFile || liveFiles.has(h.path)) continue;
      list.push({
        id: `history-${h.path}`,
        group: "기록",
        title: h.name ?? (h.firstMessage || "(빈 세션)"),
        hint: `${formatRelative(h.modified)} · ${baseName(h.cwd)}`,
        run: () => void guard(() => openStored(h)),
      });
    }
    list.push(
      {
        id: "terminal-pi",
        group: "터미널",
        title: "터미널: pi 열기 (이 폴더)",
        keywords: "terminal tui pi 터미널",
        disabled: !connected,
        run: () => openTerminal({ hostId, kind: "pi", ...(session ? { cwd: session.cwd } : {}) }),
      },
      {
        id: "terminal-shell",
        group: "터미널",
        title: "터미널: 셸 열기",
        keywords: "terminal shell powershell bash 터미널",
        disabled: !connected,
        run: () => openTerminal({ hostId, kind: "shell", ...(session ? { cwd: session.cwd } : {}) }),
      },
    );
    list.push({
      id: "pi-manager",
      group: "Pi",
      title: "Pi 관리 (설치 상태·버전)",
      keywords: "pi manager install update version 업데이트 설치",
      run: () => setPiManagerOpen(true),
    });
    list.push(
      { id: "abort", group: "실행", title: "중단", disabled: !ready || !chat.running, run: () => void guard(abortRun) },
      {
        id: "clear-queue",
        group: "실행",
        title: "대기 중인 메시지를 입력창으로",
        disabled: !ready || chat.queue.steering.length + chat.queue.followUp.length === 0,
        run: () => void guardQuiet(clearQueue),
      },
      {
        id: "compact",
        group: "세션",
        title: "대화 요약 (Compact)",
        keywords: "compaction",
        disabled: !idle,
        run: () => void guard(sessionInfo.compact),
      },
      {
        id: "auto-compact",
        group: "세션",
        title: sessionInfo.info.autoCompaction ? "자동 컴팩션 끄기" : "자동 컴팩션 켜기",
        keywords: "auto compaction 자동 요약",
        disabled: !ready || sessionInfo.info.autoCompaction === undefined,
        run: () => void guard(() => sessionInfo.setAutoCompaction(!sessionInfo.info.autoCompaction)),
      },
      {
        id: "tree",
        group: "세션",
        title: treeOpen ? "트리 닫기" : "트리 열기",
        keywords: "tree fork 분기",
        disabled: !session,
        run: () => setTreeOpen((v) => !v),
      },
      { id: "export", group: "세션", title: "HTML로 내보내기", keywords: "export html", disabled: !ready, run: () => void guard(exportHtml) },
      {
        id: "tui",
        group: "세션",
        title: "터미널 pi(TUI)에서 열기",
        keywords: "tui handoff terminal",
        disabled: !ready || !session?.sessionFile,
        run: () => setHandoffAsk(true),
      },
    );
    for (const level of sessionInfo.info.thinkingLevels) {
      list.push({
        id: `thinking-${level}`,
        group: "Thinking",
        title: `Thinking: ${level}`,
        disabled: !idle || level === sessionInfo.info.thinkingLevel,
        run: () => void guard(() => sessionInfo.setThinkingLevel(level)),
      });
    }
    const current = sessionInfo.info.model;
    for (const model of sessionInfo.info.models) {
      list.push({
        id: `model-${model.provider}/${model.id}`,
        group: "모델",
        title: model.name ?? model.id,
        hint: model.provider,
        keywords: model.id,
        disabled: !idle || (current?.provider === model.provider && current.id === model.id),
        run: () => void guard(() => sessionInfo.setModel(model.provider, model.id)),
      });
    }
    for (const c of commands ?? []) {
      list.push({
        id: `pi-${c.name}`,
        group: "Pi 명령",
        title: `/${c.name}`,
        ...(c.description ? { hint: c.description } : {}),
        disabled: !ready,
        run: () => {
          setDraft(`/${c.name} `);
          focusComposer();
        },
      });
    }
    return list;
  }

  // Ctrl+K: 명령 팔레트 (보이는 탭만)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        void openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function abortRun() {
    if (chat.queue.steering.length + chat.queue.followUp.length > 0) await clearQueue();
    await send({ type: "abort" });
  }

  /** 실행 중이면 Pi 규칙대로 steer/followUp 중 하나를 지정해야 한다. */
  function submit(
    input: Exclude<ParsedInput, { kind: "empty" }>,
    behavior: "steer" | "followUp" | undefined,
    attachments: ImageAttachment[],
  ) {
    if (!session) return;
    setDraft("");
    if (input.kind === "bash") {
      // 셸 명령은 끝나야 응답이 오므로 다른 조작을 막지 않는다. 진행은 셸 카드로 보인다.
      void guardQuiet(() => send({ type: "bash", command: input.command, excludeFromContext: input.excludeFromContext }));
      return;
    }
    const { message } = input;
    const images = rpcImages(attachments);
    void guard(() =>
      send({
        type: "prompt",
        message,
        ...(behavior ? { streamingBehavior: behavior } : {}),
        ...(images ? { images } : {}),
      }),
    );
  }

  return (
    <div className="app" hidden={!active} ref={root}>
      <header className="topbar">
        <div className="brand">Pi Desktop</div>
        <select
          className="host-select"
          aria-label="호스트"
          value={hostId}
          onFocus={reloadHosts}
          onChange={(e) => {
            if (e.target.value === SSH_MANAGE) {
              setSshHostsOpen(true);
              return;
            }
            setCwd("");
            selectHost(e.target.value);
          }}
        >
          {!hosts.some((h) => h.id === hostId) && <option value={hostId}>{hostId}</option>}
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
          <option value={SSH_MANAGE}>SSH 호스트 관리…</option>
        </select>
        <ConnectionBadge connection={connection} />
        {connection.status === "connected" && connection.agentUpdate && (
          <button
            type="button"
            className="badge warn"
            onClick={() => setAgentReplaceAsk(true)}
            title="떠 있는 Host Agent가 이 앱보다 예전 것입니다. 실행 중인 세션이 모두 끝나면 자동으로 바꿉니다."
          >
            Agent 업데이트 대기
          </button>
        )}
        {connected && (
          <button
            type="button"
            className={`pi-version${piUpdate === "available" ? " update" : ""}${piState.status && !piState.status.pi ? " missing" : ""}`}
            onClick={() => setPiManagerOpen(true)}
            title={piUpdate === "available" ? `Pi ${piState.latest?.version}로 업데이트할 수 있습니다` : "Pi 설치 상태"}
          >
            {piState.status?.pi ? `Pi ${piState.status.pi.version}` : piState.status ? "Pi 없음" : "Pi"}
            {piUpdate === "available" && <span className="pi-update-dot">↑ 새 버전</span>}
          </button>
        )}
        <div className="spacer" />
        {session && (
          <div className="session-meta" title={session.sessionFile}>
            Pi {session.piVersion} · {session.cwd}
          </div>
        )}
        {session && !lost && (
          <button
            type="button"
            disabled={!connected || busy}
            onClick={() => void guard(exportHtml)}
            title="이 세션을 HTML 파일로 내보내고 탐색기에서 보여줍니다"
          >
            HTML 내보내기
          </button>
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
          placeholder={
            isLocal
              ? "작업 폴더 경로"
              : host?.kind === "ssh"
                ? "서버의 작업 폴더 경로 (예: /home/me/project)"
                : "WSL 안의 작업 폴더 경로 (예: /home/me/project)"
          }
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          disabled={!connected || busy}
        />
        {/* Windows 폴더 선택 대화상자는 Windows 파일 시스템만 보여준다. WSL 같은 다른 호스트는 데몬으로 훑는 탐색 창을 쓴다. */}
        <button
          type="button"
          disabled={!connected || busy}
          onClick={() =>
            isLocal
              ? void guard(async () => {
                  const picked = await window.piDesktop.pickDirectory();
                  if (picked) setCwd(picked);
                })
              : setFolderBrowserOpen(true)
          }
        >
          폴더 선택
        </button>
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
          {...(sessionInfo.info.sessionName ? { currentName: sessionInfo.info.sessionName } : {})}
          {...(session && !lost && connected
            ? {
                onRename: (name: string) =>
                  guard(async () => {
                    await sessionInfo.rename(name);
                    setHistoryRefresh((n) => n + 1);
                  }),
              }
            : {})}
          refreshKey={historyRefresh}
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
      {info && (
        <div className="banner info">
          <span>{info}</span>
          <button type="button" className="small" onClick={() => setInfo(undefined)} aria-label="알림 닫기">
            닫기
          </button>
        </div>
      )}
      {chat.retry && <RetryBanner retry={chat.retry} onCancel={() => void guardQuiet(() => send({ type: "abort_retry" }))} />}
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
          onAutoCompaction={(enabled) => void guard(() => sessionInfo.setAutoCompaction(enabled))}
          treeOpen={treeOpen}
          onToggleTree={() => setTreeOpen((open) => !open)}
        />
      )}

      <ChatView
        items={chat.items}
        running={chat.running}
        onResend={(text) => setDraft(text)}
        actions={{
          onAbortBash: () => void guardQuiet(() => send({ type: "abort_bash" })),
          // 탐색기에서 볼 수 있는 호스트(로컬, WSL)만
          ...(session && (host?.kind === "local" || host?.kind === "wsl")
            ? {
                onReveal: (path: string) =>
                  void guardQuiet(async () => {
                    await window.piDesktop.revealFile(hostId, session.cwd, path);
                  }),
              }
            : {}),
        }}
      />

      <Widgets ui={ui} placement="aboveEditor" />
      <QueuePanel queue={chat.queue} onClear={() => void guardQuiet(clearQueue)} />
      <Composer
        value={draft}
        onChange={setDraft}
        disabled={!session || !connected || Boolean(lost) || Boolean(follow) || Boolean(externalWrite)}
        placeholder={
          session
            ? "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈, ↑ 이전 입력, / 명령, @ 파일, 이미지 붙여넣기, !셸 명령, !!컨텍스트 제외)"
            : "먼저 세션을 여세요"
        }
        running={chat.running}
        commands={commands}
        onNeedCommands={loadCommands}
        onSearchFiles={searchFiles}
        acceptsImages={modelAcceptsImages(sessionInfo.info.model)}
        onSubmit={submit}
        onAbort={() => void guard(abortRun)}
      />
      <Widgets ui={ui} placement="belowEditor" />
      <StatusLine ui={ui} />
      <TerminalDock
        terminals={dockTerminals}
        active={activeTerminal}
        onActivate={setActiveTerminal}
        onClose={closeTerminal}
        onUpdate={(key, fields) => setDockTerminals((prev) => prev.map((t) => (t.key === key ? { ...t, ...fields } : t)))}
      />
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
      {agentReplaceAsk && connection.status === "connected" && connection.agentUpdate && (
        <ChoiceDialog
          title="Host Agent 업데이트 대기"
          onCancel={() => setAgentReplaceAsk(false)}
          choices={[
            { label: "세션이 끝나면 바꾸기", kind: "primary", onSelect: () => setAgentReplaceAsk(false) },
            {
              label: "지금 바꾸기",
              kind: "danger",
              onSelect: () => {
                setAgentReplaceAsk(false);
                void guard(() => window.piDesktop.replaceAgent(hostId));
              },
            },
          ]}
        >
          {hostLabel}에 떠 있는 Host Agent가 이 앱보다 예전 것입니다. 실행 중인 Pi 세션이 {connection.agentUpdate.liveSessions}개
          있어 바꾸지 않았습니다. 세션이 모두 끝나면 앱이 알아서 바꿉니다. 지금 바꾸면 실행 중인 세션이 끝나며, 대화는 세션
          파일에 남아 "다시 열기"로 이어 갈 수 있습니다. 진행 중인 응답은 이어지지 않습니다.
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
      {active && sshHostsOpen && (
        <SshHostsDialog
          onClose={(changed) => {
            setSshHostsOpen(false);
            if (changed) reloadHosts();
          }}
        />
      )}
      {active && folderBrowserOpen && (
        <FolderBrowser
          hostId={hostId}
          hostLabel={hostLabel}
          initialPath={cwd}
          onPick={(path) => {
            setCwd(path);
            setFolderBrowserOpen(false);
          }}
          onClose={() => setFolderBrowserOpen(false)}
        />
      )}
      {active && piManagerOpen && (
        <PiManager
          hosts={hosts}
          initialHostId={hostId}
          onClose={() => setPiManagerOpen(false)}
          onChanged={() => void piState.reload(true)}
          onRunInTerminal={(targetHost, command, title) => {
            setPiManagerOpen(false);
            openTerminal({ hostId: targetHost, kind: "shell", initialInput: `${command}\r` }, title);
          }}
          onOAuthLogin={(targetHost, provider) => {
            setPiManagerOpen(false);
            openTerminal({ hostId: targetHost, kind: "pi", initialInput: `/login ${provider}\r` }, `pi 로그인 (${provider})`);
          }}
        />
      )}
      {active && palette && (
        <CommandPalette
          commands={paletteCommands(palette.history)}
          onClose={() => {
            setPalette(undefined);
            focusComposer();
          }}
        />
      )}
    </div>
  );
}

function loadDraft(key: string | undefined): string {
  if (!key) return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(key: string | undefined, text: string): void {
  if (!key) return;
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // 저장하지 못해도 입력은 계속된다.
  }
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
