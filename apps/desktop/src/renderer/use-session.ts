import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";
import type { ConnectionState, HostDescriptor } from "../shared/api";
import { addNotice, applyEvent, initialChatState, type ChatState } from "./chat-state";

type Action =
  | { type: "event"; seq: number; event: unknown }
  | { type: "notice"; level: "info" | "error"; text: string }
  | { type: "reset" };

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "event":
      return applyEvent(state, action.seq, action.event);
    case "notice":
      return addNotice(state, action.level, action.text);
    case "reset":
      return initialChatState;
  }
}

const api = () => window.piDesktop;

/** 마지막으로 고른 호스트를 기억한다. 앱을 다시 열면 그 호스트의 최근 세션으로 돌아간다. */
const HOST_STORAGE_KEY = "pi-desktop.hostId";

function loadHostId(): string {
  try {
    return localStorage.getItem(HOST_STORAGE_KEY) ?? "local";
  } catch {
    return "local";
  }
}

function saveHostId(hostId: string): void {
  try {
    localStorage.setItem(HOST_STORAGE_KEY, hostId);
  } catch {
    // 저장소를 못 써도 동작에는 지장이 없다.
  }
}

/**
 * 선택된 호스트의 연결 상태와 "지금 보고 있는 세션" 하나를 관리한다.
 *
 * 앱을 다시 열거나 연결이 끊겼다 붙으면, 데몬의 저널에서 마지막으로 반영한 seq 다음부터 재생해
 * 이전 작업을 그대로 이어서 보여준다 (설계 §3.4).
 */
export function useSession() {
  const [hosts, setHosts] = useState<HostDescriptor[]>([]);
  const [hostId, setHostId] = useState<string>(loadHostId);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<SessionSummary | undefined>();
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

  const attach = useCallback(async (target: SessionSummary, fromSeq: number) => {
    // 데몬은 attach 응답보다 재생 이벤트를 먼저 보낸다. 이벤트가 걸러지지 않도록 대상 세션을 먼저 지정한다.
    sessionRef.current = target;
    setSession(target);
    const result = await api().attachSession(hostRef.current, target.sessionId, fromSeq);
    setSession(result.session);
    if (result.truncated) {
      dispatch({
        type: "notice",
        level: "info",
        text: "오래된 이벤트 일부는 저널에서 지워져 표시하지 못했습니다. (전체 기록 복구는 M1에서 지원)",
      });
    }
  }, []);

  /** 다른 세션으로 전환: 화면을 비우고 처음(seq 0)부터 재생한다. */
  const switchTo = useCallback(
    async (target: SessionSummary) => {
      dispatch({ type: "reset" });
      lastSeqRef.current = 0;
      await attach(target, 0);
    },
    [attach],
  );

  const openSession = useCallback(
    async (cwd: string) => {
      const created = await api().openSession(hostRef.current, { cwd });
      await refreshSessions();
      await switchTo(created);
    },
    [refreshSessions, switchTo],
  );

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
    saveHostId(next);
    hostRef.current = next;
    sessionRef.current = undefined;
    setHostId(next);
    setSession(undefined);
    setSessions([]);
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => {
    void api().listHosts().then(setHosts, reportError);
  }, [reportError]);

  // 선택된 호스트의 연결 상태 구독. 연결될 때마다 세션 목록을 받고, 보던 세션이 있으면 이어서 재생한다.
  useEffect(() => {
    const onConnected = async () => {
      const list = await refreshSessions();
      const current = sessionRef.current;
      if (current) {
        if (list.some((s) => s.sessionId === current.sessionId)) await attach(current, lastSeqRef.current);
        return;
      }
      // 앱을 새로 열었거나 호스트를 바꿨을 때: 가장 최근에 시작한 세션에 자동으로 붙는다.
      const latest = [...list].sort((a, b) => b.startedAt - a.startedAt)[0];
      if (latest) await switchTo(latest);
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
      void refreshSessions();
    });
    return () => {
      offEvent();
      offExit();
    };
  }, [refreshSessions]);

  const host = hosts.find((h) => h.id === hostId);
  return { hosts, host, hostId, selectHost, connection, sessions, session, chat, openSession, switchTo, send, refreshSessions };
}
