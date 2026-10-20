import { DIALOG_METHODS } from "@pi-desktop/host-protocol";

/**
 * 아직 아무도 답하지 않은 확장 다이얼로그를 추적한다 (설계 §3.4 "GUI가 없는 동안 생기는 일").
 *
 * 저널을 재생하면 이미 답한 다이얼로그 요청도 다시 들어온다. 앱은 이 목록에 있는 것만 띄운다.
 * - Pi가 extension_ui_request(select·confirm·input·editor)를 보내면 추가
 * - 어느 앱이든 extension_ui_response를 보내면 제거
 * - 요청에 timeout이 있으면 Pi가 그 시간에 기본값으로 자동 처리하므로 같은 시간에 제거
 * - Pi 프로세스가 끝나면 모두 제거
 * 제거될 때마다 onResolved로 알려, 데몬이 붙어 있는 다른 앱들의 다이얼로그도 닫게 한다.
 */
export class PendingDialogs {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout> | undefined>();

  constructor(private readonly onResolved: (id: string) => void) {}

  /** Pi가 보낸 레코드를 본다. 다이얼로그 요청이면 추가한다. */
  observe(record: unknown): void {
    if (typeof record !== "object" || record === null) return;
    const r = record as Record<string, unknown>;
    if (r.type !== "extension_ui_request" || typeof r.id !== "string" || typeof r.method !== "string") return;
    if (!DIALOG_METHODS.includes(r.method)) return;
    const id = r.id;
    const timer =
      typeof r.timeout === "number" && r.timeout > 0 ? setTimeout(() => this.resolve(id), r.timeout) : undefined;
    // 데몬이 timeout 때문에 끝나지 않도록 타이머가 프로세스를 붙잡지 않게 한다.
    timer?.unref?.();
    this.pending.set(id, timer);
  }

  /** 다이얼로그가 처리되었다. 목록에 있었으면 true. */
  resolve(id: string): boolean {
    if (!this.pending.has(id)) return false;
    const timer = this.pending.get(id);
    if (timer) clearTimeout(timer);
    this.pending.delete(id);
    this.onResolved(id);
    return true;
  }

  /** Pi 프로세스가 끝났을 때. 남은 다이얼로그는 더 이상 답할 수 없다. */
  clear(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id);
  }

  ids(): string[] {
    return [...this.pending.keys()];
  }

  get size(): number {
    return this.pending.size;
  }
}
