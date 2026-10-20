import { useEffect, useRef, useState } from "react";
import type { AssistantBlock, ChatItem } from "./chat-state";
import { Markdown } from "./markdown/Markdown";

/** 대화 목록. 새 내용이 오면 사용자가 위로 스크롤해 둔 경우가 아니면 맨 아래로 따라간다. */
export function ChatView({
  items,
  running,
  onAbortBash,
}: {
  items: ChatItem[];
  running: boolean;
  /** 실행 중인 `!` 셸 명령을 멈춘다 */
  onAbortBash?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      className="chat"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {items.length === 0 && <p className="empty">세션을 열고 메시지를 보내 보세요.</p>}
      {items.map((item) => (
        <Item key={item.key} item={item} onAbortBash={onAbortBash} />
      ))}
      {running && <div className="working">Pi가 작업 중…</div>}
    </div>
  );
}

function Item({ item, onAbortBash }: { item: ChatItem; onAbortBash: (() => void) | undefined }) {
  switch (item.kind) {
    case "user":
      return <div className="msg user">{item.text}</div>;
    case "assistant":
      return (
        <div className={`msg assistant${item.done ? "" : " streaming"}`}>
          {item.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
          {item.stopReason === "error" && <div className="error-line">오류: {item.errorMessage ?? "알 수 없음"}</div>}
          {item.stopReason === "aborted" && <div className="muted">중단됨</div>}
        </div>
      );
    case "tool":
      return isShell(item) ? <ShellCard item={item} onAbort={onAbortBash} /> : <ToolCard item={item} />;
    case "notice":
      return <div className={`notice ${item.level}`}>{item.text}</div>;
  }
}

function Block({ block }: { block: AssistantBlock }) {
  if (block.type === "thinking") {
    return block.text ? (
      <details className="thinking">
        <summary>생각</summary>
        <div>{block.text}</div>
      </details>
    ) : null;
  }
  if (block.type === "toolCall") return null; // 툴 실행 카드에서 따로 보여준다.
  return <Markdown text={block.text} />;
}

function ToolCard({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const status = item.status === "running" ? "실행 중" : item.status === "error" ? "실패" : "완료";
  return (
    <div className={`tool ${item.status}`}>
      <button type="button" className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-name">{item.toolName}</span>
        <span className="tool-args">{summarizeArgs(item.args)}</span>
        <span className="tool-status">
          {status}
          {item.durationMs !== undefined && ` · ${item.durationMs}ms`}
        </span>
      </button>
      {open && (
        <div className="tool-body">
          <pre className="tool-json">{JSON.stringify(item.args, null, 2)}</pre>
          {item.output && <pre className="tool-output">{item.output}</pre>}
        </div>
      )}
    </div>
  );
}

function isShell(item: Extract<ChatItem, { kind: "tool" }>): boolean {
  return item.toolName === "!bash" || item.toolName === "!!bash";
}

/**
 * 사용자가 입력창에서 실행한 `!` 셸 명령. 터미널처럼 명령과 출력을 바로 보여준다.
 * `!!`(컨텍스트 제외)는 결과가 모델에 전달되지 않는다는 표시를 붙인다.
 */
function ShellCard({ item, onAbort }: { item: Extract<ChatItem, { kind: "tool" }>; onAbort: (() => void) | undefined }) {
  const args = item.args as { command?: unknown } | undefined;
  const excluded = item.toolName === "!!bash";
  return (
    <div className={`tool shell ${item.status}`}>
      <div className="shell-head">
        <code className="shell-command">$ {String(args?.command ?? "")}</code>
        {excluded && <span className="muted" title="이 출력은 모델에 전달되지 않습니다">컨텍스트 제외</span>}
        <span className="tool-status">
          {item.status === "running" ? "실행 중" : item.exitCode !== undefined ? `종료 코드 ${item.exitCode}` : item.status === "error" ? "실패" : "완료"}
        </span>
        {item.status === "running" && onAbort && (
          <button type="button" className="danger small" onClick={onAbort}>
            멈춤
          </button>
        )}
      </div>
      {item.output && <pre className="shell-output">{item.output}</pre>}
    </div>
  );
}

/** 툴 인자 중 대표 값 하나를 한 줄로 보여준다 (예: bash의 command, read의 path). */
function summarizeArgs(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const record = args as Record<string, unknown>;
  const main = record.command ?? record.path ?? record.pattern ?? Object.values(record)[0];
  const text = typeof main === "string" ? main : JSON.stringify(main ?? "");
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
