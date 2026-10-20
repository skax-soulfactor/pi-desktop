import { useState, type KeyboardEvent } from "react";
import { ChatView } from "./ChatView";
import { useSession } from "./use-session";

export function App() {
  const { connection, sessions, session, chat, openSession, switchTo, send } = useSession();
  const [cwd, setCwd] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const connected = connection.status === "connected";

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
    <div className="app">
      <header className="topbar">
        <div className="brand">Pi Desktop</div>
        <ConnectionBadge connection={connection} />
        <div className="spacer" />
        {session && (
          <div className="session-meta" title={session.sessionFile}>
            Pi {session.piVersion} · {session.cwd}
          </div>
        )}
      </header>

      <section className="toolbar">
        <input
          className="cwd"
          placeholder="작업 폴더 경로"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          disabled={!connected || busy}
        />
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
        <button
          type="button"
          className="primary"
          disabled={!connected || busy || !cwd.trim()}
          onClick={() => void guard(() => openSession(cwd.trim()))}
        >
          새 세션
        </button>
        {sessions.length > 0 && (
          <select
            value={session?.sessionId ?? ""}
            onChange={(e) => {
              const target = sessions.find((s) => s.sessionId === e.target.value);
              if (target) void guard(() => switchTo(target));
            }}
          >
            <option value="" disabled>
              세션 선택
            </option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.state === "running" ? "● " : "○ "}
                {s.cwd} ({new Date(s.startedAt).toLocaleTimeString()})
              </option>
            ))}
          </select>
        )}
      </section>

      {error && <div className="banner error">{error}</div>}

      <ChatView items={chat.items} running={chat.running} />

      <footer className="composer">
        <textarea
          placeholder={session ? "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)" : "먼저 세션을 여세요"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!session || !connected}
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
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ReturnType<typeof useSession>["connection"] }) {
  if (connection.status === "connected") {
    const { host } = connection;
    return (
      <span className="badge ok" title={`데몬 pid ${host.pid} · Node ${host.nodeVersion}`}>
        로컬 연결됨 · agent {host.agentVersion}
      </span>
    );
  }
  if (connection.status === "connecting") return <span className="badge">연결 중…</span>;
  return (
    <span className="badge bad" title={connection.reason}>
      연결 끊김 · 재시도 중
    </span>
  );
}
