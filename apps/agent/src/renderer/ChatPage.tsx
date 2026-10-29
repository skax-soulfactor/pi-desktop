import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChatView } from "../vendor/renderer/ChatView";
import { StatusLine, Widgets } from "../vendor/renderer/ExtensionUi";
import { withAttachments } from "./attachments";
import { EXAMPLES } from "./examples";
import type { useAgentSession } from "./use-agent-session";

type Session = ReturnType<typeof useAgentSession>;

/**
 * 대화 화면. 세션이 없으면 할 수 있는 일을 보여 주고, 예시를 누르면 대화를 열어 입력창에 채운다.
 * 머리에는 작업 폴더·모델(이 세션만 바꿈)·agent-kit 상태를 보인다.
 */
export function ChatPage({
  agent,
  connected,
  onNewChat,
  guard,
}: {
  agent: Session;
  connected: boolean;
  /** 새 대화를 연다. folder가 없으면 마지막 폴더 */
  onNewChat: (folder?: string) => Promise<void>;
  guard: (action: () => Promise<void>) => void;
}) {
  const { session, chat, ui, kit, model, models } = agent;
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // 대화가 열리면 바로 입력할 수 있게 한다
  useEffect(() => {
    if (session) input.current?.focus();
  }, [session?.sessionId]);

  const submit = () => {
    const message = draft.trim();
    if (!message || !session) return;
    setDraft("");
    guard(() => agent.send(message));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const useExample = (prompt: string) =>
    guard(async () => {
      if (!session) await onNewChat();
      setDraft(prompt);
      input.current?.focus();
    });

  const modelKey = model ? `${model.provider}/${model.id}` : "";
  const empty = chat.items.length === 0;

  return (
    <div className="page chat-page">
      <header className="page-head">
        {session ? (
          <>
            <span className="chat-folder" title={session.cwd}>
              📁 {session.cwd}
            </span>
            <span className="spacer" />
            <select
              className="model-select"
              value={modelKey}
              title="이 대화의 모델 (기본 모델·프로바이더 설정은 Pi Desktop에서)"
              onChange={(e) => {
                const picked = models.find((m) => `${m.provider}/${m.id}` === e.target.value);
                if (picked) guard(() => agent.changeModel(picked.provider, picked.id));
              }}
            >
              {!model && <option value="">모델 없음</option>}
              {model && !models.some((m) => `${m.provider}/${m.id}` === modelKey) && <option value={modelKey}>{modelKey}</option>}
              {models.map((m) => (
                <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                  {m.provider}/{m.name ?? m.id}
                </option>
              ))}
            </select>
            {kit === "missing" && <span className="badge bad">agent-kit 없음</span>}
            <button className="small" onClick={() => guard(agent.close)} title="이 대화의 Pi를 끝냅니다 (기록은 Pi 세션 폴더에 남음)">
              대화 닫기
            </button>
          </>
        ) : (
          <span className="muted">대화를 열면 Pi와 agent-kit 기능을 쓸 수 있습니다</span>
        )}
      </header>

      {empty ? (
        <div className="welcome">
          <h2>{session ? "무엇을 도와드릴까요?" : "새 대화를 시작하세요"}</h2>
          {!session && (
            <div className="row">
              <button className="primary" disabled={!connected} onClick={() => guard(() => onNewChat())}>
                새 대화
              </button>
              <button
                disabled={!connected}
                onClick={() =>
                  guard(async () => {
                    const folder = await window.piAgent.pickDirectory();
                    if (folder) await onNewChat(folder);
                  })
                }
              >
                폴더를 골라 새 대화
              </button>
            </div>
          )}
          <p className="muted">이런 일을 할 수 있습니다. 누르면 입력창에 채워집니다.</p>
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example.title} className="example" disabled={!connected} onClick={() => useExample(example.prompt)}>
                <strong>{example.title}</strong>
                <span>{example.detail}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ChatView items={chat.items} running={chat.running} onResend={setDraft} actions={{}} />
      )}

      <Widgets ui={ui} placement="aboveEditor" />
      <div className="composer">
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!session || !connected}
          placeholder={session ? "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)" : "먼저 새 대화를 여세요"}
        />
        <div className="actions">
          {chat.running && <button onClick={() => guard(agent.abort)}>중지</button>}
          <button
            disabled={!session}
            onClick={() =>
              guard(async () => {
                const paths = await window.piAgent.pickFiles();
                setDraft((prev) => withAttachments(prev, paths));
              })
            }
          >
            파일 첨부
          </button>
          <button className="primary" disabled={!session || !draft.trim()} onClick={submit}>
            보내기
          </button>
        </div>
      </div>
      <Widgets ui={ui} placement="belowEditor" />
      <StatusLine ui={ui} />
    </div>
  );
}
