import type { SessionEventNotification } from "@pi-desktop/host-protocol/messages";

/**
 * Event Inspector의 이벤트 보관소와 순수 함수들 (설계 §4.11, §1 "모르는 이벤트와 필드는 버리지 않고 raw로").
 *
 * 앱이 켜질 때 리스너 하나를 달아 세션마다 최근 이벤트를 원본 그대로 모은다.
 * 그래서 Inspector를 열기 전에 온 이벤트도 볼 수 있다. 화면 상태(chat-state 등)와는 따로 둔다.
 */

/** 세션마다 남기는 최근 이벤트 수 */
export const KEEP_PER_SESSION = 2000;

export interface LoggedEvent {
  seq: number;
  /** 데몬이 받은 시각 (ms) */
  at: number;
  /** event.type. 없으면 "(type 없음)" */
  type: string;
  event: unknown;
}

/** 앱이 화면에 쓰는 이벤트 종류. 그 밖의 것은 Inspector에서 "앱이 쓰지 않음"으로 표시한다 */
export const HANDLED_TYPES: ReadonlySet<string> = new Set([
  "agent_start",
  "agent_settled",
  "queue_update",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "bash_execution_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "extension_ui_request",
]);

const NO_TYPE = "(type 없음)";

export function typeOf(event: unknown): string {
  const type = typeof event === "object" && event !== null ? (event as { type?: unknown }).type : undefined;
  return typeof type === "string" && type ? type : NO_TYPE;
}

/** 한 줄 요약: 메시지 역할·도구 이름·내부 이벤트 종류 등 눈에 띄는 필드 */
export function eventSummary(event: unknown): string {
  if (typeof event !== "object" || event === null) return String(event);
  const e = event as Record<string, unknown>;
  const parts: string[] = [];
  const message = e.message as Record<string, unknown> | undefined;
  if (message && typeof message.role === "string") parts.push(message.role);
  const inner = e.assistantMessageEvent as Record<string, unknown> | undefined;
  if (inner && typeof inner.type === "string") parts.push(inner.type);
  for (const key of ["toolName", "method", "title", "reason"]) {
    if (typeof e[key] === "string") parts.push(`${key}=${e[key] as string}`);
  }
  if (typeof e.toolCallId === "string") parts.push(`#${e.toolCallId.slice(-6)}`);
  return parts.join(" · ");
}

/** 종류별 개수 (많은 순) */
export function typeCounts(events: readonly LoggedEvent[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** 숨긴 종류를 빼고, 검색어가 있으면 종류·원본 JSON에 그 글이 있는 것만 */
export function filterEvents(events: readonly LoggedEvent[], hidden: ReadonlySet<string>, query: string): LoggedEvent[] {
  const q = query.trim().toLowerCase();
  return events.filter((e) => !hidden.has(e.type) && (!q || e.type.toLowerCase().includes(q) || JSON.stringify(e.event).toLowerCase().includes(q)));
}

/** 시각을 HH:MM:SS.mmm로 */
export function eventTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 세션마다 최근 이벤트를 모으는 보관소. 같은 seq는 한 번만 담는다 (재연결 재생으로 다시 와도) */
export class EventLog {
  private sessions = new Map<string, LoggedEvent[]>();
  private listeners = new Set<() => void>();

  constructor(private readonly keep = KEEP_PER_SESSION) {}

  static key(hostId: string, sessionId: string): string {
    return `${hostId}|${sessionId}`;
  }

  add(hostId: string, n: SessionEventNotification): void {
    const key = EventLog.key(hostId, n.sessionId);
    const list = this.sessions.get(key) ?? [];
    const last = list.at(-1);
    if (last && n.seq <= last.seq && list.some((e) => e.seq === n.seq)) return;
    list.push({ seq: n.seq, at: n.at, type: typeOf(n.event), event: n.event });
    if (last && n.seq < last.seq) list.sort((a, b) => a.seq - b.seq);
    if (list.length > this.keep) list.splice(0, list.length - this.keep);
    this.sessions.set(key, list);
    for (const listener of this.listeners) listener();
  }

  list(hostId: string, sessionId: string): LoggedEvent[] {
    return [...(this.sessions.get(EventLog.key(hostId, sessionId)) ?? [])];
  }

  clear(hostId: string, sessionId: string): void {
    this.sessions.delete(EventLog.key(hostId, sessionId));
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let shared: EventLog | undefined;

/** 앱 전체에서 하나만 쓰는 보관소. 처음 부를 때 세션 이벤트 리스너를 단다 */
export function sharedEventLog(): EventLog {
  if (!shared) {
    const log = new EventLog();
    window.piDesktop.onSessionEvent((hostId, n) => log.add(hostId, n));
    shared = log;
  }
  return shared;
}
