/**
 * Pi RPC 이벤트를 채팅 화면 상태로 바꾸는 순수 함수 (설계 §4.1).
 *
 * 규칙 (Pi json.md):
 * - `message_update`는 델타만 담는다. 블록별로 이어 붙이고 `*_end`, `message_end`가 오면 확정본으로 교체한다.
 * - 실행 완료 판정은 `agent_end`가 아니라 `agent_settled`다.
 * - 모르는 이벤트는 무시한다 (Event Inspector에서 raw로 볼 예정).
 *
 * 저널 재생으로 같은 이벤트가 다시 올 수 있으므로 seq가 이미 처리한 값 이하면 버린다.
 */

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; toolName: string; argsText: string };

export type ChatItem =
  | { kind: "user"; key: string; text: string }
  | {
      kind: "assistant";
      key: string;
      blocks: AssistantBlock[];
      done: boolean;
      stopReason?: string;
      errorMessage?: string;
    }
  | {
      kind: "tool";
      key: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      status: "running" | "done" | "error";
      output: string;
      durationMs?: number;
    }
  | { kind: "notice"; key: string; level: "info" | "error"; text: string };

export interface ChatState {
  items: ChatItem[];
  /** Pi가 자동으로 이어서 할 작업이 남아 있는지 (agent_start ~ agent_settled) */
  running: boolean;
  /** 마지막으로 반영한 저널 순번 */
  lastSeq: number;
}

export const initialChatState: ChatState = { items: [], running: false, lastSeq: 0 };

type AnyEvent = Record<string, unknown> & { type?: string };

export function applyEvent(state: ChatState, seq: number, raw: unknown): ChatState {
  if (seq <= state.lastSeq) return state;
  const next: ChatState = { ...state, lastSeq: seq };
  if (typeof raw !== "object" || raw === null) return next;
  const event = raw as AnyEvent;

  switch (event.type) {
    case "agent_start":
      return { ...next, running: true };
    case "agent_settled":
      return { ...next, running: false, items: finishOpenAssistant(next.items) };

    case "message_start": {
      const message = event.message as AnyEvent | undefined;
      if (message?.role === "user") {
        return { ...next, items: [...next.items, { kind: "user", key: `u${seq}`, text: contentText(message.content) }] };
      }
      if (message?.role === "assistant") {
        return { ...next, items: [...next.items, { kind: "assistant", key: `a${seq}`, blocks: [], done: false }] };
      }
      return next;
    }

    case "message_update":
      return updateLastAssistant(next, (item) => ({
        ...item,
        blocks: applyDelta(item.blocks, event.assistantMessageEvent as AnyEvent | undefined),
      }));

    case "message_end": {
      const message = event.message as AnyEvent | undefined;
      if (message?.role !== "assistant") return next;
      return updateLastAssistant(next, (item) => {
        const updated = { ...item, blocks: blocksFromContent(message.content), done: true };
        if (typeof message.stopReason === "string") updated.stopReason = message.stopReason;
        if (typeof message.errorMessage === "string") updated.errorMessage = message.errorMessage;
        return updated;
      });
    }

    case "tool_execution_start":
      return {
        ...next,
        items: [
          ...next.items,
          {
            kind: "tool",
            key: `t${seq}`,
            toolCallId: String(event.toolCallId),
            toolName: String(event.toolName),
            args: event.args,
            status: "running",
            output: "",
          },
        ],
      };

    case "tool_execution_update":
      return updateTool(next, String(event.toolCallId), (item) => ({
        ...item,
        output: resultText(event.partialResult),
      }));

    case "tool_execution_end":
      return updateTool(next, String(event.toolCallId), (item) => {
        const updated = {
          ...item,
          status: event.isError === true ? ("error" as const) : ("done" as const),
          output: resultText(event.result),
        };
        if (typeof event.durationMs === "number") updated.durationMs = event.durationMs;
        return updated;
      });

    default:
      return next;
  }
}

/** 프롬프트를 보냈는데 Pi가 거부했을 때처럼, 이벤트가 아닌 안내를 끼워 넣는다. */
export function addNotice(state: ChatState, level: "info" | "error", text: string): ChatState {
  return { ...state, items: [...state.items, { kind: "notice", key: `n${Date.now()}-${state.items.length}`, level, text }] };
}

function applyDelta(blocks: AssistantBlock[], update: AnyEvent | undefined): AssistantBlock[] {
  if (!update || typeof update.contentIndex !== "number") return blocks;
  const index = update.contentIndex;
  const copy = [...blocks];
  const current = copy[index];
  switch (update.type) {
    case "text_start":
      copy[index] = { type: "text", text: "" };
      break;
    case "text_delta":
      copy[index] = { type: "text", text: (current?.type === "text" ? current.text : "") + String(update.delta ?? "") };
      break;
    case "text_end":
      if (typeof update.content === "string") copy[index] = { type: "text", text: update.content };
      break;
    case "thinking_start":
      copy[index] = { type: "thinking", text: "" };
      break;
    case "thinking_delta":
      copy[index] = {
        type: "thinking",
        text: (current?.type === "thinking" ? current.text : "") + String(update.delta ?? ""),
      };
      break;
    case "thinking_end":
      if (typeof update.content === "string") copy[index] = { type: "thinking", text: update.content };
      break;
    case "toolcall_start":
      copy[index] = { type: "toolCall", toolName: String(update.toolName ?? ""), argsText: "" };
      break;
    case "toolcall_delta":
      if (current?.type === "toolCall") copy[index] = { ...current, argsText: current.argsText + String(update.delta ?? "") };
      break;
    default:
      return blocks;
  }
  // 중간 인덱스가 비어 있으면(이벤트 일부를 못 받은 경우) 빈 텍스트로 채워 렌더링이 깨지지 않게 한다.
  for (let i = 0; i < copy.length; i++) copy[i] ??= { type: "text", text: "" };
  return copy;
}

function blocksFromContent(content: unknown): AssistantBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: AssistantBlock[] = [];
  for (const part of content as AnyEvent[]) {
    if (part.type === "text") blocks.push({ type: "text", text: String(part.text ?? "") });
    else if (part.type === "thinking") blocks.push({ type: "thinking", text: String(part.thinking ?? "") });
    else if (part.type === "toolCall") {
      blocks.push({ type: "toolCall", toolName: String(part.name ?? ""), argsText: JSON.stringify(part.arguments ?? {}) });
    }
  }
  return blocks;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as AnyEvent[])
    .map((part) => (part.type === "text" ? String(part.text ?? "") : part.type === "image" ? "[이미지]" : ""))
    .join("");
}

/** 툴 결과 `{ content: [{type:"text", text}] }`에서 텍스트만 뽑는다. */
function resultText(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  return contentText((result as AnyEvent).content);
}

function updateLastAssistant(
  state: ChatState,
  update: (item: Extract<ChatItem, { kind: "assistant" }>) => ChatItem,
): ChatState {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (item?.kind === "assistant") {
      const items = [...state.items];
      items[i] = update(item);
      return { ...state, items };
    }
  }
  return state;
}

function updateTool(
  state: ChatState,
  toolCallId: string,
  update: (item: Extract<ChatItem, { kind: "tool" }>) => ChatItem,
): ChatState {
  const index = state.items.findIndex((item) => item.kind === "tool" && item.toolCallId === toolCallId);
  if (index === -1) return state;
  const items = [...state.items];
  items[index] = update(items[index] as Extract<ChatItem, { kind: "tool" }>);
  return { ...state, items };
}

/** 중단 등으로 message_end 없이 끝난 응답을 완료 상태로 바꾼다. */
function finishOpenAssistant(items: ChatItem[]): ChatItem[] {
  return items.map((item) => (item.kind === "assistant" && !item.done ? { ...item, done: true } : item));
}
