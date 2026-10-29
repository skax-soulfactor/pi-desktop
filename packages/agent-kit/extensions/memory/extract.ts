import type { Memory, MemoryKind } from "./store";
import { MEMORY_KINDS } from "./store";

/**
 * 턴이 끝난 뒤 따로 모델을 불러 기억을 뽑는 패스의 순수 로직 (desktop-agent src/main/memory/extract.ts를 옮김).
 * 파일·Pi에 손대지 않는다. 대화 정리, 프롬프트, 관대한 JSON 파싱, 걸러 내기를 맡는다.
 */

/** 이번 실행에서 모은 실패 신호 (교훈 후보) */
export interface FailureSignal {
  kind: "tool-error" | "approval-denied";
  detail: string;
}

export type MemoryOp =
  { op: "create"; kind: MemoryKind; text: string } | { op: "update"; id: string; kind?: MemoryKind; text: string } | { op: "forget"; id: string };

/** 바깥을 실제로 관찰하는 도구. 이것이 하나도 성공하지 않은 턴에서 에이전트가 한 말은 아직 주장이다 */
const OBSERVING_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "powershell", "web_fetch", "process_document"]);

/** 추출에 넘길 이번 실행의 모습 */
export interface RunDigest {
  transcript: string;
  failures: FailureSignal[];
  /** 관찰 도구가 하나라도 성공했는가 */
  verified: boolean;
  /** 사용자가 쓴 메시지가 있었는가 (없으면 뽑을 것도 없다) */
  hasUser: boolean;
}

type Part = { type: string; text?: string; name?: string; arguments?: unknown };
type RunMessage = {
  role?: string;
  content?: unknown;
  toolName?: string;
  isError?: boolean;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")
    .trim();
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** agent_end의 메시지들을 사람이 읽는 대화 기록과 실패 신호로 정리한다 */
export function digestRun(messages: readonly unknown[]): RunDigest {
  const lines: string[] = [];
  const failures: FailureSignal[] = [];
  let verified = false;
  let hasUser = false;
  for (const raw of messages) {
    const message = raw as RunMessage;
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) {
        hasUser = true;
        lines.push(`사용자: ${text}`);
      }
    } else if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content as Part[]) {
        if (part.type === "text" && part.text?.trim()) lines.push(`에이전트: ${part.text.trim()}`);
        else if (part.type === "toolCall") lines.push(`(도구 호출 ${part.name} ${clip(JSON.stringify(part.arguments ?? {}), 200)})`);
      }
    } else if (message.role === "toolResult") {
      const name = message.toolName ?? "?";
      const text = textOf(message.content);
      if (message.isError) {
        lines.push(`(도구 실패 ${name}: ${clip(text, 300)})`);
        // 승인 확장(permissions)의 거부 이유는 "거부"를 담는다
        failures.push({
          kind: /거부/.test(text) ? "approval-denied" : "tool-error",
          detail: `${name} — ${clip(text, 200)}`,
        });
      } else {
        lines.push(`(도구 결과 ${name}: ${clip(text, 300)})`);
        if (OBSERVING_TOOLS.has(name)) verified = true;
      }
    }
  }
  return { transcript: lines.join("\n"), failures, verified, hasUser };
}

export const EXTRACT_SYSTEM = `너는 데스크톱 에이전트의 기억 관리자다. 방금 끝난 대화를 검토해 다음 대화에서도 알아야 할 것만 장기 기억으로 남긴다.

기억 종류:
- preference: 사용자의 선호·작업 규칙 (예: "커밋 메시지는 한글로 쓴다")
- fact: 사용자 환경·진행 중인 일에 대한 사실 (예: "회사 PC는 Windows다")
- lesson: 에이전트의 실수와 재발 방지 규칙. "무엇을 할 때 → 어떻게 해야 한다(또는 하지 말아야 한다), 이유" 꼴의 한두 문장

규칙:
- 한 기억은 한두 문장의 한국어로 짧게 쓴다.
- 같은 주제의 기억이 이미 있으면 create 대신 update(id 포함)로 고친다. 중복 금지.
- 사용자 말이 기존 기억과 어긋나면 그 기억을 update하거나 forget한다.
- 이번 대화에만 필요한 것, 일회성 내용은 저장하지 않는다.
- 검증되지 않은 진단이나 해결책을 사실로 저장하지 않는다. "A로 B를 해결했다"는 사용자가 해결을 확인했을 때만.
- 비밀번호·API 키·토큰 등 민감 정보는 절대 저장하지 않는다.
- 실패 신호(도구 오류, 승인 거부)가 있으면 lesson을 먼저 검토한다. 단, 거부 자체를 교훈으로 삼지 말고 사용자가 원한 방식이 드러났을 때만 남긴다.
- 저장할 것이 없으면 ops를 빈 배열로 반환한다. 대부분의 대화는 그렇다.

출력: 아래 JSON만 출력한다. 설명·인사·코드 펜스 금지.
{"ops":[{"op":"create","kind":"preference|fact|lesson","text":"내용"},{"op":"update","id":"기존 id","text":"고친 내용"},{"op":"forget","id":"기존 id"}]}`;

/** 관찰 도구가 하나도 성공하지 않은 턴에 덧붙인다. 사실이 아니라 출처를 기준으로 자른다 */
export const UNVERIFIED_RULE = `

이번 대화에서는 도구로 확인한 것이 하나도 없다.
- 그러므로 에이전트가 설명한 외부 사실(제품 버전·가격·정책, 도구 동작 원리 등)은 저장하지 않는다. 확신에 차서 말했든 출처를 적었든 마찬가지다.
- 사용자가 직접 말한 것만 저장한다: 선호, 쓰는 환경·도구, 요구사항, 결정, 계획.`;

/** 추출 요청 본문. 기록은 끝(가장 최근)을 남기고 앞을 자른다 */
export function extractPrompt(existing: Memory[], digest: RunDigest, budgetChars: number): string {
  const failureText = digest.failures.length > 0 ? `\n\n## 실패 신호 (교훈 후보)\n${digest.failures.map((f) => `- (${f.kind}) ${f.detail}`).join("\n")}` : "";
  const list = existing.map((m) => `- id=${m.id} [${m.kind}] ${m.text}`).join("\n");
  const listBudget = Math.floor(budgetChars * 0.3);
  const existingText = list.length > listBudget ? list.slice(list.length - listBudget) : list;
  const transcriptBudget = Math.max(500, budgetChars - existingText.length - failureText.length);
  const transcript =
    digest.transcript.length > transcriptBudget ? `…${digest.transcript.slice(digest.transcript.length - transcriptBudget)}` : digest.transcript;
  return `## 기존 기억\n${existingText || "(없음)"}\n\n## 이번 대화\n${transcript}${failureText}`;
}

/**
 * 끊긴 ops 배열을 마지막으로 온전한 op까지 되살린다. 로컬 모델은 출력 상한에 걸려 `{"ops":[{...},{...`처럼 끝나곤 한다.
 * 뒤에서부터 닫는 중괄호 자리를 옮겨 가며 "]}"를 붙여 보고 처음 성공하는 것을 쓴다.
 */
function salvage(body: string): unknown {
  let cut = body.length;
  for (let i = 0; i < 20; i++) {
    const close = body.lastIndexOf("}", cut - 1);
    if (close <= 0) return undefined;
    try {
      return JSON.parse(`${body.slice(0, close + 1)}]}`);
    } catch {
      cut = close;
    }
  }
  return undefined;
}

/** 민감 정보로 보이는 글 (키·토큰·비밀번호). 프롬프트로 막아도 새는 것을 한 번 더 거른다 */
export function looksSecret(text: string): boolean {
  return (
    /\b(sk|pk|rk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{12,}/.test(text) ||
    // 숫자와 글자가 섞인 32자 이상 덩어리 (경로처럼 / 로 끊기는 것은 제외)
    /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/.test(text) ||
    /(비밀번호|패스워드|password|passwd|api[ _-]?key|토큰|token)\s*[:=]\s*\S+/i.test(text)
  );
}

/**
 * 모델 출력에서 ops를 꺼낸다. 사고 블록·코드 펜스·사족이 붙어도 JSON 본문만 고른다.
 * 형식이 맞지 않는 op와 민감해 보이는 op는 버린다. JSON이 아예 없으면 "저장할 것 없음"을 글로 답한 것으로 보고
 * 빈 목록을 돌려준다 (작은 모델이 자주 그런다. 턴마다 경고를 띄우지 않게). 읽다 만 JSON은 오류.
 */
export function parseOps(raw: string, knownIds: ReadonlySet<string>): MemoryOp[] {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/<think>/i.test(text)) text = text.replace(/<think>[\s\S]*$/i, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0) return [];
  if (end <= start) throw new Error(`JSON이 닫히지 않았다: ${raw.slice(0, 120)}`);
  const body = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    parsed = salvage(body);
    if (parsed === undefined) throw new Error(`JSON을 읽지 못했다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const list = (parsed as { ops?: unknown }).ops;
  if (!Array.isArray(list)) throw new Error("ops 배열이 없다");

  const ops: MemoryOp[] = [];
  for (const item of list as Array<Record<string, unknown>>) {
    const kind = MEMORY_KINDS.includes(item.kind as MemoryKind) ? (item.kind as MemoryKind) : undefined;
    const body = typeof item.text === "string" ? item.text.trim() : "";
    const id = typeof item.id === "string" ? item.id : "";
    if (body && looksSecret(body)) continue;
    if (item.op === "create" && kind && body) ops.push({ op: "create", kind, text: body });
    else if (item.op === "update" && knownIds.has(id) && body) ops.push(kind ? { op: "update", id, kind, text: body } : { op: "update", id, text: body });
    else if ((item.op === "forget" || item.op === "archive") && knownIds.has(id)) ops.push({ op: "forget", id });
  }
  return ops;
}
