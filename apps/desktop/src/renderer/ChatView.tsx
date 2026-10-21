import { useEffect, useRef } from "react";
import type { AssistantBlock, ChatItem } from "./chat-state";
import { Markdown } from "./markdown/Markdown";
import { ToolCard, type ToolCardActions } from "./ToolCards";

/** 대화 목록. 새 내용이 오면 사용자가 위로 스크롤해 둔 경우가 아니면 맨 아래로 따라간다. */
export function ChatView({ items, running, actions }: { items: ChatItem[]; running: boolean; actions: ToolCardActions }) {
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
        <Item key={item.key} item={item} actions={actions} />
      ))}
      {running && <div className="working">Pi가 작업 중…</div>}
    </div>
  );
}

function Item({ item, actions }: { item: ChatItem; actions: ToolCardActions }) {
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
      return <ToolCard item={item} actions={actions} />;
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
