import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";
import type { ConnectionState } from "../shared/api";
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

/**
 * Host Agent 연결 상태와 "지금 보고 있는 세션" 하나를 관리한다.
 *
 * 앱을 다시 열거나 연결이 끊겼다 붙으면, 데몬의 저널에서 마지막으로 반영한 seq 다음부터 재생해
 * 이전 작업을 그대로 이어서 보여준다 (설계 §3.4).
 */
export function useSession() {
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting" });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<SessionSummary | undefined>();
  const [chat, dispatch] = useReducer(reducer, initialChatState);

  // 이벤트 콜백 안에서 최신 값을 보기 위한 ref
  const sessionRef = useRef<SessionSummary | undefined>(undefined);
  const lastSeqRef = useRef(0);
  sessionRef.current = session;
  lastSeqRef.current = chat.lastSeq;

  const refreshSessions = useCallback(async () => {
    const list = await api().listSessions();
    setSessions(list);
    return list;
  }, []);

  const attach = useCallback(async (target: SessionSummary, fromSeq: number) => {
    // 데몬은 attach 응답보다 재생 이벤트를 먼저 보낸다. 이벤트가 걸러지지 않도록 대상 세션을 먼저 지정한다.
    sessionRef.current = target;
    setSession(target);
    const result = await api().attachSession(target.sessionId, fromSeq);
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
      const created = await api().openSession({ cwd });
      await refreshSessions();
      await switchTo(created);
    },
    [refreshSessions, switchTo],
  );

  const send = useCallback(async (command: Record<string, unknown>) => {
    const current = sessionRef.current;
    if (!current) return;
    const response = await api().sendCommand(current.sessionId, command);
    if (response.success !== true) {
      dispatch({ type: "notice", level: "error", text: `Pi가 명령을 거부했습니다: ${String(response.error ?? "알 수 없는 오류")}` });
    }
  }, []);

  // 연결 상태 구독. 연결될 때마다 세션 목록을 받고, 보던 세션이 있으면 이어서 재생한다.
  useEffect(() => {
    const onConnected = async () => {
      const list = await refreshSessions();
      const current = sessionRef.current;
      if (current) {
        if (list.some((s) => s.sessionId === current.sessionId)) await attach(current, lastSeqRef.current);
        return;
      }
      // 앱을 새로 열었을 때: 가장 최근에 시작한 세션에 자동으로 다시 붙는다.
      const latest = [...list].sort((a, b) => b.startedAt - a.startedAt)[0];
      if (latest) await switchTo(latest);
    };

    const handle = (state: ConnectionState) => {
      setConnection(state);
      if (state.status === "connected") void onConnected().catch(reportError);
    };
    const reportError = (error: unknown) =>
      dispatch({ type: "notice", level: "error", text: error instanceof Error ? error.message : String(error) });

    const off = api().onConnection(handle);
    void api().getConnection().then(handle);
    return off;
  }, [attach, refreshSessions, switchTo]);

  // 세션 이벤트·종료 구독
  useEffect(() => {
    const offEvent = api().onSessionEvent((n) => {
      if (n.sessionId === sessionRef.current?.sessionId) dispatch({ type: "event", seq: n.seq, event: n.event });
    });
    const offExit = api().onSessionExit((n) => {
      if (n.sessionId !== sessionRef.current?.sessionId) return;
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

  return { connection, sessions, session, chat, openSession, switchTo, send, refreshSessions };
}
