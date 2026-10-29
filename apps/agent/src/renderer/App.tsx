import { useEffect, useState, type KeyboardEvent } from "react";
import { ChatView } from "../vendor/renderer/ChatView";
import { ExtensionDialog, StatusLine, Toasts, Widgets } from "../vendor/renderer/ExtensionUi";
import { connectionLabel } from "./connection-label";
import { useAgentSession, type KitState } from "./use-agent-session";

const KIT_LABEL: Record<KitState, { text: string; tone: "ok" | "bad" | "" }> = {
  checking: { text: "agent-kit 확인 중…", tone: "" },
  ready: { text: "agent-kit", tone: "ok" },
  missing: { text: "agent-kit 없음", tone: "bad" },
};

export function App() {
  const { connection, session, chat, ui, kit, open, send, abort, answer, dismiss, notice } = useAgentSession();
  const [cwd, setCwd] = useState("");
  const [draft, setDraft] = useState("");
  const connected = connection.status === "connected";

  useEffect(() => {
    void window.piAgent.defaultCwd().then((dir) => setCwd((prev) => prev || dir));
  }, []);

  /** 실패를 대화에 알림으로 남긴다. 이 화면에는 따로 오류 영역이 없다 */
  const guard = (action: () => Promise<void>) => {
    action().catch((error: unknown) => notice("error", error instanceof Error ? error.message : String(error)));
  };

  const submit = () => {
    const message = draft.trim();
    if (!message || !session) return;
    setDraft("");
    guard(() => send(message));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const label = connectionLabel(connection);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Pi Desktop Agent</span>
        {session && <span className="session-meta">{session.cwd}</span>}
        <span className="spacer" />
        {kit && <span className={`badge ${KIT_LABEL[kit].tone}`}>{KIT_LABEL[kit].text}</span>}
        <span className={`badge ${label.tone}`}>{label.text}</span>
      </header>
      <div className="toolbar">
        <input className="cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="작업 폴더" />
        <button onClick={() => guard(async () => setCwd((await window.piAgent.pickDirectory()) ?? cwd))}>폴더 선택</button>
        <button className="primary" disabled={!connected || !cwd.trim()} onClick={() => guard(() => open(cwd.trim()))}>
          새 세션
        </button>
      </div>

      <ChatView items={chat.items} running={chat.running} onResend={setDraft} actions={{}} />

      <Widgets ui={ui} placement="aboveEditor" />
      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!session || !connected}
          placeholder={session ? "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈, /agent:status 확인)" : "먼저 새 세션을 여세요"}
        />
        <div className="actions">
          {chat.running && <button onClick={() => guard(abort)}>중지</button>}
          <button className="primary" disabled={!session || !draft.trim()} onClick={submit}>
            보내기
          </button>
        </div>
      </div>
      <Widgets ui={ui} placement="belowEditor" />
      <StatusLine ui={ui} />

      {ui.dialogs[0] && <ExtensionDialog dialog={ui.dialogs[0]} onAnswer={(reply) => guard(() => answer(ui.dialogs[0]!, reply))} />}
      <Toasts toasts={ui.toasts} onDismiss={dismiss} />
    </div>
  );
}
