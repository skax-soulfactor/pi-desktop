import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SessionEventNotification, SessionSummary, StoredSession, WriterState } from "@pi-desktop/host-protocol/messages";
import type { AttachResult, ConnectionState, HostDescriptor } from "../shared/api";
import { addNotice, applyEvent, initialChatState, snapshotState, type ChatState } from "./chat-state";
import {
  applyUiEvent,
  dialogResponse,
  dismissToast,
  initialExtensionUiState,
  prunePending,
  resolveDialog,
  type DialogRequest,
  type ExtensionUiState,
} from "./extension-ui-state";

type Action =
  | { type: "event"; seq: number; event: unknown }
  | { type: "notice"; level: "info" | "error"; text: string }
  | { type: "snapshot"; state: ChatState }
  | { type: "reset" };

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "event":
      return applyEvent(state, action.seq, action.event);
    case "notice":
      return addNotice(state, action.level, action.text);
    case "snapshot":
      return action.state;
    case "reset":
      return initialChatState;
  }
}

type UiAction =
  | { type: "event"; seq: number; at: number; event: unknown; replay: boolean }
  | { type: "resolve"; id: string }
  | { type: "prune"; ids: string[] }
  | { type: "dismiss"; key: string }
  | { type: "reset" };

function uiReducer(state: ExtensionUiState, action: UiAction): ExtensionUiState {
  switch (action.type) {
    case "event":
      return applyUiEvent(state, action.seq, action.at, action.event, Date.now(), action.replay);
    case "resolve":
      return resolveDialog(state, action.id);
    case "prune":
      return prunePending(state, action.ids);
    case "dismiss":
      return dismissToast(state, action.key);
    case "reset":
      return initialExtensionUiState;
  }
}

const api = () => window.piDesktop;

/** 다시 열 수 있도록 기억해 두는 세션 정보. Pi 세션 파일이 있으면 같은 대화를 이어 열 수 있다. */
export interface RememberedSession {
  sessionId: string;
  cwd: string;
  sessionFile?: string;
}

/** 데몬이 재시작되었거나 Pi가 종료되어 지금은 붙을 수 없는 세션 */
/** 다른 프로그램이 쓰는 세션 파일을 읽기 전용으로 따라가는 중 */
export interface FollowState {
  hostId: string;
  path: string;
  cwd: string;
  title?: string;
}

/** 저장된 세션을 여는 방식 (openStored 참고) */
export type OpenMode = "auto" | "follow" | "fork" | "open";

/**
 * 이 시간 안에 수정된 세션 파일은 다른 곳(TUI 등)에서 쓰는 중일 수 있다고 본다.
 * TUI는 사용자 입력과 응답이 끝날 때 파일에 덧붙이므로, 대화 중이면 보통 몇 분 안에 수정된다.
 */
const RECENTLY_WRITTEN_MS = 2 * 60_000;

export interface LostSession extends RememberedSession {
  reason: "missing" | "exited";
}

// localStorage는 개인 환경 설정만 담는다. 실패해도(사생활 보호 모드 등) 동작에는 지장이 없다.
/**
 * 저장 키는 탭(워크스페이스)마다 따로 둔다. 첫 탭("main")은 탭 기능 이전의 키를 그대로 써서,
 * 업데이트 뒤에도 보던 호스트와 세션이 그대로 열리게 한다.
 */
const hostKey = (tabId: string) => (tabId === MAIN_TAB ? "pi-desktop.hostId" : `pi-desktop.tab.${tabId}.hostId`);
const lastSessionKeyOf = (tabId: string, hostId: string) =>
  tabId === MAIN_TAB ? `pi-desktop.lastSession.${hostId}` : `pi-desktop.tab.${tabId}.lastSession.${hostId}`;

/** 첫 탭의 id */
export const MAIN_TAB = "main";

/** 새 탭이 처음 연결할 호스트를 정해 둔다 (지금 보던 탭과 같은 호스트로 시작하게). */
export function setTabHost(tabId: string, hostId: string): void {
  writeStorage(hostKey(tabId), hostId);
}

/** 새 탭이 처음 연결하면 이 세션을 보여주게 정해 둔다 (활동 패널에서 연 세션). */
export function setTabSession(tabId: string, hostId: string, session: SessionSummary): void {
  writeStorage(lastSessionKeyOf(tabId, hostId), remember(session));
}

/** 탭을 닫을 때 그 탭의 저장값을 지운다. */
export function forgetTab(tabId: string): void {
  if (tabId === MAIN_TAB) return;
  try {
    const prefix = `pi-desktop.tab.${tabId}.`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // 무시
  }
}

function readStorage<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 무시
  }
}

function remember(session: SessionSummary): RememberedSession {
  const value: RememberedSession = { sessionId: session.sessionId, cwd: session.cwd };
  if (session.sessionFile) value.sessionFile = session.sessionFile;
  return value;
}

/**
 * 선택된 호스트의 연결 상태와 "지금 보고 있는 세션" 하나를 관리한다.
 *
 * - 앱을 다시 열거나 연결이 끊겼다 붙으면 마지막으로 반영한 seq 다음부터 저널을 재생해 이어서 보여준다.
 * - 저널 앞부분이 잘렸으면 get_messages 스냅샷으로 화면을 다시 만든다.
 * - 데몬이 재시작되어 세션이 사라졌거나 Pi가 종료되면 "다시 열기"를 제안하고,
 *   같은 Pi 세션 파일로 열어 대화를 이어 간다 (설계 §3.4).
 */
export function useSession(tabId: string = MAIN_TAB) {
  const HOST_STORAGE_KEY = hostKey(tabId);
  const lastSessionKey = (host: string) => lastSessionKeyOf(tabId, host);
  const [hosts, setHosts] = useState<HostDescriptor[]>([]);
  const [hostId, setHostId] = useState<string>(() => readStorage<string>(HOST_STORAGE_KEY) ?? "local");
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<SessionSummary | undefined>();
  const [lost, setLost] = useState<LostSession | undefined>();
  const [follow, setFollow] = useState<FollowState | undefined>();
  const [pendingOpen, setPendingOpen] = useState<StoredSession | undefined>();
  /** 보고 있는 세션의 입력 권한 (설계 §3.4). other면 다른 앱이 입력 중이라 읽기 전용 */
  const [writer, setWriter] = useState<WriterState>("you");
  const followRef = useRef<FollowState | undefined>(undefined);
  /** attach 진행 중이면 그 사이 알림으로 온 이벤트를 모으는 곳 */
  const attachQueueRef = useRef<SessionEventNotification[] | undefined>(undefined);
  const [chat, dispatch] = useReducer(reducer, initialChatState);
  const [ui, dispatchUi] = useReducer(uiReducer, initialExtensionUiState);

  // 이벤트 콜백 안에서 최신 값을 보기 위한 ref
  const hostRef = useRef(hostId);
  const sessionRef = useRef<SessionSummary | undefined>(undefined);
  const lastSeqRef = useRef(0);
  hostRef.current = hostId;
  sessionRef.current = session;
  lastSeqRef.current = chat.lastSeq;

  const reportError = useCallback(
    (error: unknown) =>
      dispatch({ type: "notice", level: "error", text: error instanceof Error ? error.message : String(error) }),
    [],
  );

  const refreshSessions = useCallback(async () => {
    const list = await api().listSessions(hostRef.current);
    setSessions(list);
    return list;
  }, []);

  /**
   * get_messages로 확정된 대화 전체를 받아 화면을 다시 만든다.
   * 그 사이에 도착한 실시간 이벤트는 get_messages에 이미 반영되어 있으므로, 응답을 받은 시점의 seq를 기준으로 삼는다.
   */
  const restoreSnapshot = useCallback(async (target: SessionSummary) => {
    const [messages, state] = await Promise.all([
      api().sendCommand(hostRef.current, target.sessionId, { type: "get_messages" }),
      api().sendCommand(hostRef.current, target.sessionId, { type: "get_state" }),
    ]);
    if (messages.success !== true) throw new Error(`대화 기록을 받지 못했습니다: ${String(messages.error)}`);
    const list = ((messages.data as { messages?: unknown[] } | undefined)?.messages ?? []) as unknown[];
    const running = (state.data as { isStreaming?: boolean } | undefined)?.isStreaming === true;
    dispatch({ type: "snapshot", state: snapshotState(list, lastSeqRef.current, running) });
  }, []);

  const attach = useCallback(
    async (target: SessionSummary, fromSeq: number) => {
      // attach 이후의 실시간 이벤트가 걸러지지 않도록 대상 세션을 먼저 지정한다.
      sessionRef.current = target;
      setSession(target);
      setLost(undefined);
      // attach 중에 알림으로 오는 이벤트는 결과보다 먼저 도착할 수 있으므로 모아 두었다가 결과 뒤에 적용한다.
      const queued: SessionEventNotification[] = [];
      attachQueueRef.current = queued;
      let result: AttachResult;
      try {
        result = await api().attachSession(hostRef.current, target.sessionId, fromSeq);
      } finally {
        if (attachQueueRef.current === queued) attachQueueRef.current = undefined;
      }
      // 재생 이벤트는 결과에 함께 온다. 먼저 모두 적용한 뒤 대기 목록으로 다이얼로그를 거른다
      // (순서가 바뀌면 이미 답한 다이얼로그가 다시 뜬다).
      for (const n of result.events) {
        dispatch({ type: "event", seq: n.seq, event: n.event });
        dispatchUi({ type: "event", seq: n.seq, at: n.at, event: n.event, replay: true });
      }
      // 그 사이 알림으로 온 것 중 결과에 없던 것만 실시간 이벤트로 적용된다 (리듀서가 순번으로 중복을 거름).
      for (const n of queued) {
        dispatch({ type: "event", seq: n.seq, event: n.event });
        dispatchUi({ type: "event", seq: n.seq, at: n.at, event: n.event, replay: false });
      }
      const replayedTo = Math.max(result.events.at(-1)?.seq ?? 0, queued.at(-1)?.seq ?? 0) || undefined;
      if (replayedTo !== undefined) lastSeqRef.current = Math.max(lastSeqRef.current, replayedTo);
      dispatchUi({ type: "prune", ids: result.pendingUi ?? [] });
      setSession(result.session);
      setWriter(result.writer ?? "you");
      writeStorage(lastSessionKey(hostRef.current), remember(result.session));
      if (result.session.state === "exited") {
        // Pi 프로세스가 없어 명령을 보낼 수 없다. 저널에 남은 기록만 보여주고 다시 열기를 제안한다.
        setLost({ ...remember(result.session), reason: "exited" });
        return;
      }
      if (result.truncated) await restoreSnapshot(result.session);
    },
    [restoreSnapshot],
  );

  /** 팔로우 모드를 끝낸다 (파일 감시 해제). ref만 쓰므로 어느 동작에서든 부를 수 있다. */
  const leaveFollow = () => {
    const current = followRef.current;
    if (!current) return;
    followRef.current = undefined;
    setFollow(undefined);
    void api().unwatchStored(current.hostId, current.path).catch(() => {});
  };

  /** 다른 세션으로 전환: 화면을 비우고 처음(seq 0)부터 재생한다. snapshot이면 대화 기록을 스냅샷으로 채운다. */
  const switchTo = useCallback(
    async (target: SessionSummary, options: { snapshot?: boolean } = {}) => {
      leaveFollow();
      dispatch({ type: "reset" });
      dispatchUi({ type: "reset" });
      lastSeqRef.current = 0;
      await attach(target, 0);
      if (options.snapshot) await restoreSnapshot(target);
    },
    [attach, restoreSnapshot],
  );

  const openSession = useCallback(
    async (cwd: string) => {
      const created = await api().openSession(hostRef.current, { cwd });
      await refreshSessions();
      await switchTo(created);
    },
    [refreshSessions, switchTo],
  );

  /** 사라진 세션을 같은 Pi 세션 파일로 다시 열어 대화를 이어 간다. */
  const reopenLost = useCallback(async () => {
    const target = lost;
    if (!target) return;
    const request = target.sessionFile ? { cwd: target.cwd, sessionFile: target.sessionFile } : { cwd: target.cwd };
    const created = await api().openSession(hostRef.current, request);
    await refreshSessions();
    // 새로 띄운 Pi의 저널에는 이전 대화가 없으므로 스냅샷으로 채운다.
    await switchTo(created, { snapshot: true });
  }, [lost, refreshSessions, switchTo]);

  const send = useCallback(async (command: Record<string, unknown>) => {
    const current = sessionRef.current;
    if (!current) return;
    const response = await api().sendCommand(hostRef.current, current.sessionId, command);
    if (response.success !== true) {
      dispatch({ type: "notice", level: "error", text: `Pi가 명령을 거부했습니다: ${String(response.error ?? "알 수 없는 오류")}` });
    }
  }, []);

  const stopFollow = useCallback(() => leaveFollow(), []);

  /** 팔로우 중인 파일을 다시 읽어 화면을 그린다. */
  const reloadFollow = useCallback(async () => {
    const current = followRef.current;
    if (!current) return;
    const read = await api().readStored(current.hostId, current.path);
    if (followRef.current?.path !== current.path) return;
    dispatch({ type: "snapshot", state: snapshotState(read.messages, 0, false) });
  }, []);

  /**
   * 팔로우 모드: 다른 프로그램(TUI 등)이 쓰는 세션 파일을 읽기 전용으로 따라가며 보여준다 (설계 §5.4).
   * Pi를 띄우지 않고 파일만 읽으므로 그 파일에 쓰지 않는다. 파일이 바뀔 때마다 다시 읽는다.
   */
  const startFollow = useCallback(
    async (target: { path: string; cwd: string; title?: string }) => {
      stopFollow();
      sessionRef.current = undefined;
      setSession(undefined);
      setLost(undefined);
      dispatch({ type: "reset" });
      dispatchUi({ type: "reset" });
      const next: FollowState = { ...target, hostId: hostRef.current };
      followRef.current = next;
      setFollow(next);
      await reloadFollow();
      await api().watchStored(next.hostId, next.path);
    },
    [stopFollow, reloadFollow],
  );

  /**
   * Pi가 저장한 세션을 연다 (설계 §5.4).
   * - 같은 파일로 이 데몬에서 실행 중인 세션이 있으면 거기로 전환
   * - "auto"인데 파일이 최근에 수정됐고 이 데몬이 쓰는 파일이 아니면, 다른 곳(TUI 등)에서 쓰는 중일 수 있으므로
   *   바로 열지 않고 선택을 요청한다(pendingOpen). 같은 파일에 두 Pi가 함께 쓰면 기록이 꼬일 수 있다.
   * - "follow": 읽기 전용으로 따라가기, "fork": 그 파일에서 분기한 새 세션으로 열기, "open": 그래도 같은 파일로 열기
   */
  const openStored = useCallback(
    async (stored: StoredSession, mode: OpenMode = "auto") => {
      setPendingOpen(undefined);
      const live = (await refreshSessions()).find((s) => s.state === "running" && s.sessionFile === stored.path);
      if (live && mode !== "fork") {
        stopFollow();
        await switchTo(live);
        return;
      }
      if (mode === "auto") {
        const info = await api().inspectStored(hostRef.current, stored.path);
        if (!info.ownedBy && Date.now() - info.modified < RECENTLY_WRITTEN_MS) {
          setPendingOpen(stored);
          return;
        }
      }
      if (mode === "follow") {
        await startFollow({ path: stored.path, cwd: stored.cwd, title: stored.name ?? stored.firstMessage });
        return;
      }
      stopFollow();
      const request = mode === "fork" ? { cwd: stored.cwd, forkFrom: stored.path } : { cwd: stored.cwd, sessionFile: stored.path };
      const created = await api().openSession(hostRef.current, request);
      await refreshSessions();
      await switchTo(created, { snapshot: true });
    },
    [refreshSessions, switchTo, startFollow, stopFollow],
  );

  /** 다른 앱이 가지고 있던 입력 권한을 가져온다. 그 앱은 읽기 전용이 된다. */
  const claimWriter = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    await api().claimWriter(hostRef.current, current.sessionId);
    setWriter("you");
  }, []);

  /** 다른 프로그램의 끼어들기를 무시하고 이 파일에 계속 쓴다 (기록이 섞일 수 있음을 사용자가 감수). */
  const ignoreExternalWrite = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    await api().clearExternalWrite(hostRef.current, current.sessionId);
    setSession((prev) => {
      if (!prev) return prev;
      const { externalWriteAt: _cleared, ...rest } = prev;
      return rest;
    });
  }, []);

  /** 팔로우 중인 세션을 같은 파일에 쓰지 않고, 분기한 새 세션으로 이어 쓴다. */
  const continueFollowedAsFork = useCallback(async () => {
    const current = followRef.current;
    if (!current) return;
    const created = await api().openSession(hostRef.current, { cwd: current.cwd, forkFrom: current.path });
    await refreshSessions();
    await switchTo(created, { snapshot: true });
  }, [refreshSessions, switchTo]);

  /**
   * 지금 세션을 터미널 Pi(TUI)로 넘긴다. 같은 파일에 GUI와 TUI가 함께 쓰지 않도록 GUI 쪽 Pi를 먼저 닫고,
   * 그 파일을 팔로우 모드로 계속 보여준다. 터미널에서 실행할 명령은 화면이 만든다.
   */
  const handOffToTui = useCallback(async (): Promise<{ cwd: string; sessionFile: string } | undefined> => {
    const current = sessionRef.current;
    if (!current?.sessionFile) return undefined;
    await api().closeSession(hostRef.current, current.sessionId);
    await refreshSessions();
    await startFollow({ path: current.sessionFile, cwd: current.cwd });
    return { cwd: current.cwd, sessionFile: current.sessionFile };
  }, [refreshSessions, startFollow]);

  /**
   * fork·clone처럼 같은 Pi 프로세스가 새 세션 파일로 옮겨 가는 명령을 보낸다.
   * 성공하면 세션 요약(파일 경로)을 다시 읽고 대화 화면을 스냅샷으로 다시 그린다.
   * @returns Pi 응답의 data (fork는 분기한 메시지 원문 text를 준다). 확장이 취소했으면 undefined
   */
  const branchSession = useCallback(
    async (command: Record<string, unknown>): Promise<Record<string, unknown> | undefined> => {
      const current = sessionRef.current;
      if (!current) return undefined;
      const response = await api().sendCommand(hostRef.current, current.sessionId, command);
      if (response.success !== true) throw new Error(String(response.error ?? `${String(command.type)} 실패`));
      const data = response.data as Record<string, unknown> | undefined;
      if (data?.cancelled === true) {
        dispatch({ type: "notice", level: "info", text: "확장이 분기를 취소했습니다." });
        return undefined;
      }
      const updated = (await refreshSessions()).find((s) => s.sessionId === current.sessionId);
      if (updated) {
        sessionRef.current = updated;
        setSession(updated);
        writeStorage(lastSessionKey(hostRef.current), remember(updated));
      }
      await restoreSnapshot(updated ?? current);
      return data;
    },
    [refreshSessions, restoreSnapshot],
  );

  /** 확장 다이얼로그에 답한다. 화면에서는 바로 닫고, 데몬이 다른 창에도 처리됨을 알린다. */
  const respondDialog = useCallback(
    async (dialog: DialogRequest, answer: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const current = sessionRef.current;
      if (!current) return;
      dispatchUi({ type: "resolve", id: dialog.id });
      await api().sendRecord(hostRef.current, current.sessionId, dialogResponse(dialog, answer));
    },
    [],
  );

  /** 호스트 전환: 보던 세션을 놓고 새 호스트에 연결한다. */
  const selectHost = useCallback((next: string) => {
    if (next === hostRef.current) return;
    writeStorage(HOST_STORAGE_KEY, next);
    hostRef.current = next;
    sessionRef.current = undefined;
    setHostId(next);
    setSession(undefined);
    setSessions([]);
    leaveFollow();
    setLost(undefined);
    dispatch({ type: "reset" });
    dispatchUi({ type: "reset" });
  }, []);

  /** 호스트 목록을 다시 읽는다 (SSH 호스트를 추가·삭제한 뒤) */
  const reloadHosts = useCallback(() => {
    void api().listHosts().then(setHosts, reportError);
  }, [reportError]);

  useEffect(() => {
    reloadHosts();
  }, [reloadHosts]);

  // 선택된 호스트의 연결 상태 구독. 연결될 때마다 세션 목록을 받고 보던 세션을 이어서 보여준다.
  useEffect(() => {
    const onConnected = async () => {
      const list = await refreshSessions();
      // 팔로우 중이면 데몬이 재시작됐을 수 있으므로 감시를 다시 걸고 다시 읽는다.
      const following = followRef.current;
      if (following && following.hostId === hostRef.current) {
        await api().watchStored(following.hostId, following.path);
        await reloadFollow();
        return;
      }
      const current = sessionRef.current;
      if (current) {
        const alive = list.find((s) => s.sessionId === current.sessionId);
        if (alive) await attach(alive, lastSeqRef.current);
        // 데몬이 재시작되어 세션이 사라짐: 화면의 대화는 그대로 두고 다시 열기를 제안한다.
        else setLost({ ...remember(current), reason: "missing" });
        return;
      }
      // 앱을 새로 열었거나 호스트를 바꿨을 때: 지난번에 보던 세션이 살아 있으면 그것, 아니면 가장 최근 세션.
      const remembered = readStorage<RememberedSession>(lastSessionKey(hostRef.current));
      // 새로 만든 탭은 빈 화면으로 시작하고, 가장 최근 세션에 자동으로 붙는 것은 첫 탭만 한다.
      const latest = tabId === MAIN_TAB ? [...list].sort((a, b) => b.startedAt - a.startedAt)[0] : undefined;
      const target = list.find((s) => s.sessionId === remembered?.sessionId) ?? latest;
      if (target) await switchTo(target);
      else if (remembered) setLost({ ...remembered, reason: "missing" });
    };

    const handle = (state: ConnectionState) => {
      setConnection(state);
      if (state.status === "connected") void onConnected().catch(reportError);
    };

    const off = api().onConnection((id, state) => {
      if (id === hostId) handle(state);
    });
    setConnection({ status: "connecting" });
    void api().connectHost(hostId).then(handle, reportError);
    return off;
  }, [hostId, attach, refreshSessions, switchTo, reportError, reloadFollow]);

  // 세션 이벤트·종료 구독 (선택된 호스트의 보고 있는 세션만)
  useEffect(() => {
    const isCurrent = (id: string, sessionId: string) =>
      id === hostRef.current && sessionId === sessionRef.current?.sessionId;
    const offEvent = api().onSessionEvent((id, n) => {
      if (!isCurrent(id, n.sessionId)) return;
      if (attachQueueRef.current) {
        attachQueueRef.current.push(n);
        return;
      }
      dispatch({ type: "event", seq: n.seq, event: n.event });
      dispatchUi({ type: "event", seq: n.seq, at: n.at, event: n.event, replay: false });
    });
    const offExit = api().onSessionExit((id, n) => {
      if (!isCurrent(id, n.sessionId)) return;
      const detail = n.stderrTail.trim().split("\n").slice(-5).join("\n");
      dispatch({
        type: "notice",
        level: "error",
        text: `Pi 프로세스가 종료되었습니다 (code ${n.exitCode ?? n.signal})${detail ? `\n${detail}` : ""}`,
      });
      const current = sessionRef.current;
      if (current) setLost({ ...remember(current), reason: "exited" });
      void refreshSessions();
    });
    // 다른 창에서 답했거나 제한 시간이 지나 처리된 다이얼로그를 닫는다.
    const offResolved = api().onUiResolved((id, n) => {
      if (isCurrent(id, n.sessionId)) dispatchUi({ type: "resolve", id: n.id });
    });
    // 이 앱의 Pi가 쓰는 세션 파일에 다른 프로그램이 썼다: 세션 요약에 표시해 화면이 입력을 잠그게 한다.
    const offExternal = api().onExternalWrite((id, n) => {
      if (!isCurrent(id, n.sessionId)) return;
      setSession((prev) => (prev && prev.sessionId === n.sessionId ? { ...prev, externalWriteAt: n.at } : prev));
    });
    // 다른 앱이 제어를 가져갔거나, 가지고 있던 앱이 끊겼다.
    const offWriter = api().onWriterChanged((id, n) => {
      if (isCurrent(id, n.sessionId)) setWriter(n.writer);
    });
    // 팔로우 중인 파일이 바뀌면 잠시 모았다가 다시 읽는다 (상대가 여러 줄을 연달아 쓰므로).
    let followTimer: ReturnType<typeof setTimeout> | undefined;
    const offStored = api().onStoredChanged((id, n) => {
      const following = followRef.current;
      if (!following || id !== following.hostId || n.path !== following.path) return;
      if (followTimer) clearTimeout(followTimer);
      followTimer = setTimeout(() => void reloadFollow().catch(reportError), 300);
    });
    return () => {
      offEvent();
      offExit();
      offResolved();
      offStored();
      offExternal();
      offWriter();
      if (followTimer) clearTimeout(followTimer);
    };
  }, [refreshSessions, reloadFollow, reportError]);

  const host = hosts.find((h) => h.id === hostId);
  return {
    hosts,
    reloadHosts,
    host,
    hostId,
    selectHost,
    connection,
    sessions,
    session,
    lost,
    chat,
    openSession,
    reopenLost,
    switchTo,
    ui,
    respondDialog,
    openStored,
    branchSession,
    follow,
    pendingOpen,
    cancelPendingOpen: () => setPendingOpen(undefined),
    stopFollow,
    handOffToTui,
    continueFollowedAsFork,
    ignoreExternalWrite,
    writer,
    claimWriter,
    dismissToast: (key: string) => dispatchUi({ type: "dismiss", key }),
    send,
    refreshSessions,
  };
}
