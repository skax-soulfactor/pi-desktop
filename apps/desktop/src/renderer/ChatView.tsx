import { useEffect, useRef, useState } from "react";
import type { AssistantBlock, ChatItem } from "./chat-state";

/** 대화 목록. 새 내용이 오면 사용자가 위로 스크롤해 둔 경우가 아니면 맨 아래로 따라간다. */
export function ChatView({ items, running }: { items: ChatItem[]; running: boolean }) {
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
        <Item key={item.key} item={item} />
      ))}
      {running && <div className="working">Pi가 작업 중…</div>}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
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
      return <ToolCard item={item} />;
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
  return <div className="text">{block.text}</div>;
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

/** 툴 인자 중 대표 값 하나를 한 줄로 보여준다 (예: bash의 command, read의 path). */
function summarizeArgs(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const record = args as Record<string, unknown>;
  const main = record.command ?? record.path ?? record.pattern ?? Object.values(record)[0];
  const text = typeof main === "string" ? main : JSON.stringify(main ?? "");
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
