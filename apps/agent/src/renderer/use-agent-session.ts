import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEventNotification, SessionSummary } from "@pi-desktop/host-protocol/messages";
import { STATUS_COMMAND } from "@pi-desktop/agent-kit/constants";
import { addNotice, applyEvent, initialChatState, type ChatState } from "../vendor/renderer/chat-state";
import {
  applyUiEvent,
  dialogResponse,
  dismissToast,
  initialExtensionUiState,
  prunePending,
  resolveDialog,
  type DialogRequest,
  type ExtensionUiState,
} from "../vendor/renderer/extension-ui-state";
import type { ConnectionState } from "../shared/api";

/** agent-kit이 세션에 올라갔는지 (설계 DESIGN-AGENT.md §2.1) */
export type KitState = "checking" | "ready" | "missing";

const api = () => window.piAgent;

/**
 * 에이전트 앱의 세션 하나.
 *
 * Pi Desktop의 use-session을 줄인 것이다. 로컬 호스트 하나, 탭 하나, 새 세션만 다루고
 * 팔로우·여러 앱 입력 권한·신뢰 묻기는 두지 않는다. 이벤트 해석은 Pi Desktop의 리듀서(chat-state,
 * extension-ui-state)를 그대로 쓴다.
 */
export function useAgentSession() {
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting" });
  const [session, setSession] = useState<SessionSummary>();
  const [chat, setChat] = useState<ChatState>(initialChatState);
  const [ui, setUi] = useState<ExtensionUiState>(initialExtensionUiState);
  const [kit, setKit] = useState<KitState>();
  const sessionRef = useRef<SessionSummary>(undefined);
  /** attach 중에 알림으로 온 이벤트. 결과를 적용한 뒤에 순번으로 걸러 적용한다 */
  const attachQueueRef = useRef<SessionEventNotification[]>(undefined);

  const applyNotification = useCallback((n: SessionEventNotification, replay: boolean) => {
    setChat((prev) => applyEvent(prev, n.seq, n.event));
    setUi((prev) => applyUiEvent(prev, n.seq, n.at, n.event, Date.now(), replay));
  }, []);

  const notice = useCallback((level: "info" | "error", text: string) => {
    setChat((prev) => addNotice(prev, level, text));
  }, []);

  useEffect(() => {
    void api().connectionState().then(setConnection);
    const offConnection = api().onConnection(setConnection);
    const offEvent = api().onSessionEvent((n) => {
      if (n.sessionId !== sessionRef.current?.sessionId) return;
      if (attachQueueRef.current) attachQueueRef.current.push(n);
      else applyNotification(n, false);
    });
    const offExit = api().onSessionExit((n) => {
      if (n.sessionId !== sessionRef.current?.sessionId) return;
      const detail = n.stderrTail.trim().split("\n").slice(-5).join("\n");
      notice("error", `Pi 프로세스가 종료되었습니다 (code ${n.exitCode ?? n.signal})${detail ? `\n${detail}` : ""}`);
    });
    const offResolved = api().onUiResolved((n) => {
      if (n.sessionId === sessionRef.current?.sessionId) setUi((prev) => resolveDialog(prev, n.id));
    });
    return () => {
      offConnection();
      offEvent();
      offExit();
      offResolved();
    };
  }, [applyNotification, notice]);

  /** agent-kit 확장 명령이 세션에 있는지 본다. 없으면 기능 없이 Pi만 도는 상태다 */
  const checkKit = useCallback(async (sessionId: string) => {
    setKit("checking");
    const response = await api().sendCommand(sessionId, { type: "get_commands" });
    const commands = (response.data as { commands?: Array<{ name?: string }> } | undefined)?.commands ?? [];
    setKit(commands.some((c) => c.name === STATUS_COMMAND) ? "ready" : "missing");
  }, []);

  /** 새 세션을 열고 처음부터 붙는다 */
  const open = useCallback(
    async (cwd: string) => {
      setChat(initialChatState);
      setUi(initialExtensionUiState);
      setKit(undefined);
      const opened = await api().openSession(cwd);
      // attach 이후의 실시간 이벤트가 걸러지지 않도록 대상 세션을 먼저 지정한다.
      sessionRef.current = opened;
      setSession(opened);
      const queued: SessionEventNotification[] = [];
      attachQueueRef.current = queued;
      try {
        const result = await api().attachSession(opened.sessionId, 0);
        // 재생 이벤트를 먼저, 그 사이 알림으로 온 것을 나중에 적용한다 (리듀서가 순번으로 중복을 거름).
        for (const n of result.events) applyNotification(n, true);
        for (const n of queued) applyNotification(n, false);
        setUi((prev) => prunePending(prev, result.pendingUi ?? []));
        setSession(result.session);
      } finally {
        attachQueueRef.current = undefined;
      }
      await checkKit(opened.sessionId);
    },
    [applyNotification, checkKit],
  );

  /** 프롬프트를 보낸다. 응답 중이면 끝난 뒤에 이어서 처리하도록 follow-up으로 넣는다 */
  const send = useCallback(
    async (message: string) => {
      const current = sessionRef.current;
      if (!current) return;
      const response = await api().sendCommand(current.sessionId, {
        type: "prompt",
        message,
        ...(chat.running ? { streamingBehavior: "followUp" } : {}),
      });
      if (response.success === false) notice("error", String(response.error ?? "보내지 못했습니다"));
    },
    [chat.running, notice],
  );

  const abort = useCallback(async () => {
    const current = sessionRef.current;
    if (current) await api().sendCommand(current.sessionId, { type: "abort" });
  }, []);

  const answer = useCallback(
    async (dialog: DialogRequest, reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const current = sessionRef.current;
      if (!current) return;
      setUi((prev) => resolveDialog(prev, dialog.id));
      await api().sendRecord(current.sessionId, dialogResponse(dialog, reply));
    },
    [],
  );

  const dismiss = useCallback((key: string) => setUi((prev) => dismissToast(prev, key)), []);

  return { connection, session, chat, ui, kit, open, send, abort, answer, dismiss, notice };
}
