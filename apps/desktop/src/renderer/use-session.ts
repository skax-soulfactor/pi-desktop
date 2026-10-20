import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";
import type { ConnectionState, HostDescriptor } from "../shared/api";
import { addNotice, applyEvent, initialChatState, snapshotState, type ChatState } from "./chat-state";

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

const api = () => window.piDesktop;

/** 다시 열 수 있도록 기억해 두는 세션 정보. Pi 세션 파일이 있으면 같은 대화를 이어 열 수 있다. */
export interface RememberedSession {
  sessionId: string;
  cwd: string;
  sessionFile?: string;
}

/** 데몬이 재시작되었거나 Pi가 종료되어 지금은 붙을 수 없는 세션 */
export interface LostSession extends RememberedSession {
  reason: "missing" | "exited";
}

// localStorage는 개인 환경 설정만 담는다. 실패해도(사생활 보호 모드 등) 동작에는 지장이 없다.
const HOST_STORAGE_KEY = "pi-desktop.hostId";
const lastSessionKey = (hostId: string) => `pi-desktop.lastSession.${hostId}`;

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
export function useSession() {
  const [hosts, setHosts] = useState<HostDescriptor[]>([]);
  const [hostId, setHostId] = useState<string>(() => readStorage<string>(HOST_STORAGE_KEY) ?? "local");
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<SessionSummary | undefined>();
  const [lost, setLost] = useState<LostSession | undefined>();
  const [chat, dispatch] = useReducer(reducer, initialChatState);

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
      // 데몬은 attach 응답보다 재생 이벤트를 먼저 보낸다. 이벤트가 걸러지지 않도록 대상 세션을 먼저 지정한다.
      sessionRef.current = target;
      setSession(target);
      setLost(undefined);
      const result = await api().attachSession(hostRef.current, target.sessionId, fromSeq);
      setSession(result.session);
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

  /** 다른 세션으로 전환: 화면을 비우고 처음(seq 0)부터 재생한다. snapshot이면 대화 기록을 스냅샷으로 채운다. */
  const switchTo = useCallback(
    async (target: SessionSummary, options: { snapshot?: boolean } = {}) => {
      dispatch({ type: "reset" });
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

  /** 호스트 전환: 보던 세션을 놓고 새 호스트에 연결한다. */
  const selectHost = useCallback((next: string) => {
    if (next === hostRef.current) return;
    writeStorage(HOST_STORAGE_KEY, next);
    hostRef.current = next;
    sessionRef.current = undefined;
    setHostId(next);
    setSession(undefined);
    setSessions([]);
    setLost(undefined);
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => {
    void api().listHosts().then(setHosts, reportError);
  }, [reportError]);

  // 선택된 호스트의 연결 상태 구독. 연결될 때마다 세션 목록을 받고 보던 세션을 이어서 보여준다.
  useEffect(() => {
    const onConnected = async () => {
      const list = await refreshSessions();
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
      const target =
        list.find((s) => s.sessionId === remembered?.sessionId) ?? [...list].sort((a, b) => b.startedAt - a.startedAt)[0];
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
  }, [hostId, attach, refreshSessions, switchTo, reportError]);

  // 세션 이벤트·종료 구독 (선택된 호스트의 보고 있는 세션만)
  useEffect(() => {
    const isCurrent = (id: string, sessionId: string) =>
      id === hostRef.current && sessionId === sessionRef.current?.sessionId;
    const offEvent = api().onSessionEvent((id, n) => {
      if (isCurrent(id, n.sessionId)) dispatch({ type: "event", seq: n.seq, event: n.event });
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
    return () => {
      offEvent();
      offExit();
    };
  }, [refreshSessions]);

  const host = hosts.find((h) => h.id === hostId);
  return {
    hosts,
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
    send,
    refreshSessions,
  };
}
