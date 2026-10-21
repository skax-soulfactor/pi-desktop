/**
 * 세션 하나의 활동 상태를 Pi 이벤트에서 추적한다 (앱의 활동 패널, 설계 §3.3).
 *
 * - busy: Pi가 일하는 중 (agent_start ~ agent_settled). Pi가 끝나면 이어서 할 일(재시도, 큐)이 없을 때
 *   agent_settled가 오므로 agent_end가 아니라 이것을 쓴다.
 * - title: 사용자가 붙인 세션 이름(set_session_name·get_state.sessionName), 없으면 이 프로세스에서 받은 첫 질문.
 */

/** 제목으로 쓰는 첫 질문의 최대 글자 수 */
export const TITLE_LIMIT = 80;

export class ActivityTracker {
  busy = false;
  private name: string | undefined;
  private firstPrompt: string | undefined;

  get title(): string | undefined {
    return this.name ?? this.firstPrompt;
  }

  observe(record: unknown): void {
    if (typeof record !== "object" || record === null) return;
    const event = record as { type?: unknown; message?: { role?: unknown; content?: unknown } };
    if (event.type === "agent_start") this.busy = true;
    else if (event.type === "agent_settled") this.busy = false;
    else if (event.type === "message_start" && event.message?.role === "user" && this.firstPrompt === undefined) {
      const text = promptText(event.message.content);
      if (text) this.firstPrompt = text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT)}…` : text;
    }
  }

  /** 세션 이름 (빈 문자열·undefined면 이름 없음) */
  setName(name: unknown): void {
    this.name = typeof name === "string" && name.trim() ? name.trim() : undefined;
  }

  /** 같은 프로세스에서 다른 세션 파일로 옮겼을 때 (fork, clone, new_session, switch_session) */
  resetForNewSession(): void {
    this.name = undefined;
    this.firstPrompt = undefined;
  }
}

function promptText(content: unknown): string {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join(" ")
        : "";
  return raw.replace(/\s+/g, " ").trim();
}
