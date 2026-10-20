/**
 * Pi get_tree 결과(세션 항목 트리)를 화면에 그릴 행 목록으로 바꾸는 순수 함수 (설계 §4.1 세션 트리).
 *
 * - 한 갈래로 이어지는 대화는 같은 깊이로 이어 그리고, 자식이 둘 이상인 곳(분기)에서만 들여쓴다
 * - 현재 위치(leafId)까지의 경로를 표시한다
 * - fork는 사용자 메시지에서만 할 수 있다 (Pi RPC fork 명령의 제약)
 * - 시스템 메시지, 사용량 기록, 확장 내부 항목처럼 대화 흐름에 의미 없는 항목은 숨기고 자식은 그대로 잇는다
 * 세션이 길 수 있어 재귀 대신 명시적 스택으로 순회한다.
 */

export interface TreeNode {
  entry: Record<string, unknown> & { id?: string; type?: string; parentId?: string | null };
  children: TreeNode[];
  label?: string;
}

export type RowKind = "user" | "assistant" | "tool" | "meta";

export interface TreeRow {
  id: string;
  depth: number;
  kind: RowKind;
  text: string;
  /** 사용자가 붙인 라벨 (/label) */
  label?: string;
  /** 루트에서 현재 위치까지의 경로 위에 있는지 */
  active: boolean;
  /** 현재 위치(leaf) */
  isLeaf: boolean;
  /** 형제가 있는 갈래의 시작 */
  branchStart: boolean;
  canFork: boolean;
}

const SNIPPET = 80;

export function layoutTree(tree: TreeNode[], leafId: string | null | undefined): TreeRow[] {
  const active = activePath(tree, leafId);
  const rows: TreeRow[] = [];
  // 스택에는 뒤에서부터 꺼낼 것을 넣는다 (먼저 그릴 것이 마지막).
  const stack: Array<{ node: TreeNode; depth: number; branchStart: boolean }> = [];
  /** 자식이 하나면 같은 깊이로 잇고, 둘 이상이면(분기) 한 단계 들여쓴다. */
  const pushChildren = (children: TreeNode[], depth: number, branching: boolean) => {
    const ordered = [...children].sort(byTimestamp);
    for (let i = ordered.length - 1; i >= 0; i--) {
      stack.push({ node: ordered[i]!, depth, branchStart: branching });
    }
  };
  // 루트가 여럿이면(탐색 API나 끊긴 부모) 각각을 갈래로 본다.
  pushChildren(tree, 0, tree.length > 1);

  while (stack.length > 0) {
    const { node, depth, branchStart } = stack.pop()!;
    const id = String(node.entry.id ?? "");
    const shown = describe(node.entry);
    if (shown) {
      const row: TreeRow = {
        id,
        depth,
        kind: shown.kind,
        text: shown.text,
        active: active.has(id),
        isLeaf: id === leafId,
        branchStart,
        canFork: shown.kind === "user",
      };
      if (node.label) row.label = node.label;
      rows.push(row);
    }
    const branching = node.children.length > 1;
    // 숨긴 항목에서 시작한 갈래 표시는 첫 번째로 보이는 자식이 이어받는다.
    pushChildren(node.children, branching ? depth + 1 : depth, branching || (!shown && branchStart));
  }
  return rows;
}

/** leaf에서 부모를 따라 올라가며 경로 위의 id를 모은다. */
function activePath(tree: TreeNode[], leafId: string | null | undefined): Set<string> {
  const parents = new Map<string, string | null>();
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const id = String(node.entry.id ?? "");
    parents.set(id, (node.entry.parentId as string | null | undefined) ?? null);
    stack.push(...node.children);
  }
  const path = new Set<string>();
  let cursor: string | null | undefined = leafId;
  while (cursor && !path.has(cursor)) {
    path.add(cursor);
    cursor = parents.get(cursor);
  }
  return path;
}

function byTimestamp(a: TreeNode, b: TreeNode): number {
  return String(a.entry.timestamp ?? "").localeCompare(String(b.entry.timestamp ?? ""));
}

/** 항목을 한 줄로 설명한다. 숨길 항목이면 undefined. */
export function describe(entry: TreeNode["entry"]): { kind: RowKind; text: string } | undefined {
  switch (entry.type) {
    case "message": {
      const message = (entry.message ?? {}) as Record<string, unknown>;
      switch (message.role) {
        case "user":
          return { kind: "user", text: snippet(textOf(message.content)) || "(빈 메시지)" };
        case "assistant": {
          const text = snippet(textOf(message.content));
          if (text) return { kind: "assistant", text };
          const tools = toolNames(message.content);
          return { kind: "tool", text: tools.length ? `툴 호출: ${tools.join(", ")}` : "(빈 응답)" };
        }
        case "bashExecution":
          return { kind: "tool", text: `! ${snippet(String(message.command ?? ""))}` };
        default:
          // system, toolResult(툴 호출 줄에서 이미 보임) 등은 숨긴다.
          return undefined;
      }
    }
    case "model_change":
      return { kind: "meta", text: `모델 → ${String(entry.provider)}/${String(entry.modelId)}` };
    case "thinking_level_change":
      return { kind: "meta", text: `thinking → ${String(entry.thinkingLevel)}` };
    case "compaction":
      return { kind: "meta", text: "컨텍스트 요약 (컴팩션)" };
    case "branch_summary":
      return { kind: "meta", text: `분기 요약: ${snippet(String(entry.summary ?? ""))}` };
    case "session_info":
      return entry.name ? { kind: "meta", text: `세션 이름: ${String(entry.name)}` } : undefined;
    default:
      // usage, custom, custom_message, label, context_edit 등
      return undefined;
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .join(" ");
}

function toolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "toolCall")
    .map((part) => String((part as { name?: unknown }).name ?? ""));
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
}
