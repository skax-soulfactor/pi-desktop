import { open } from "node:fs/promises";
import type { FileChange } from "./file-watcher";

/** FileWatcher 중 이 클래스가 쓰는 부분 (테스트에서 바꿔 끼우기 위함) */
export interface WatchFn {
  watch(path: string, listener: (change: FileChange) => void): () => void;
}

/** 파일의 [from, to) 바이트를 읽는다 (테스트에서 바꿔 끼우기 위함) */
export type ReadRange = (path: string, from: number, to: number) => Promise<string>;

/** 우리 Pi가 이 시간 동안 아무 활동이 없었는데 파일에 메시지가 덧붙으면 다른 프로그램이 쓴 것으로 본다 */
export const DEFAULT_EXTERNAL_WRITE_GRACE_MS = 3_000;

/** 한 번에 읽을 최대 크기. 이보다 많이 덧붙었으면 앞부분만 본다 */
const MAX_READ = 256 * 1024;

/**
 * 이 데몬의 Pi가 쓰는 세션 파일에 다른 프로그램(TUI 등)이 쓴 것을 감지한다 (설계 §5.4).
 *
 * 두 가지가 모두 맞을 때 감지한다.
 * 1. 시각: 파일의 수정 시각(mtime)이 우리 Pi의 마지막 활동(이벤트 수신, 명령 전송)보다 graceMs 이상 뒤다.
 *    Pi는 자기 활동과 같은 시점에만 파일에 쓰기 때문이다. 감시 시각이 아니라 mtime과 비교하므로
 *    파일 감시 주기(주기적 stat)만큼의 지연에 영향받지 않는다.
 * 2. 내용: 새로 덧붙은 부분에 대화 메시지 항목("type":"message")이 있다.
 *    사용량 기록처럼 이벤트 없이 덧붙을 수 있는 항목으로는 오탐하지 않게 한다.
 *
 * 한 번 감지하면 사용자가 정리할 때까지(clear) 다시 알리지 않는다.
 * 세션 파일이 바뀌면(fork·clone 등) 새 파일을 감시하고 감지 표시를 지운다.
 */
export class ExternalWriteDetector {
  private path: string | undefined;
  private unwatch: (() => void) | undefined;
  private lastActivity: number;
  private lastSize = 0;
  private detected: number | undefined;
  private checking = Promise.resolve();

  constructor(
    private readonly files: WatchFn,
    private readonly onDetect: (path: string, at: number) => void,
    private readonly graceMs = DEFAULT_EXTERNAL_WRITE_GRACE_MS,
    private readonly now: () => number = Date.now,
    private readonly readRange: ReadRange = readFileRange,
  ) {
    this.lastActivity = now();
  }

  /** 우리 Pi가 무언가를 했다 (이벤트 수신, 명령 전송). */
  activity(): void {
    this.lastActivity = this.now();
  }

  /**
   * 감시할 세션 파일을 정한다. 이전과 다르면 감시를 옮기고 감지 표시를 지운다.
   * @param size 지금 파일 크기. 이 뒤로 덧붙는 부분만 본다
   */
  track(path: string | undefined, size = 0): void {
    if (path === this.path) return;
    this.unwatch?.();
    this.unwatch = undefined;
    this.path = path;
    this.lastSize = size;
    this.detected = undefined;
    // 파일을 옮긴 직후의 기록은 우리 Pi가 쓴 것이므로 활동으로 친다.
    this.activity();
    if (path) this.unwatch = this.files.watch(path, (change) => this.enqueue(change));
  }

  /** 사용자가 "무시하고 계속"을 골랐다. 이후 다시 감지하면 다시 알린다. */
  clear(): void {
    this.detected = undefined;
    this.activity();
  }

  get detectedAt(): number | undefined {
    return this.detected;
  }

  /** 진행 중인 판단이 끝날 때까지 기다린다 (테스트용) */
  idle(): Promise<void> {
    return this.checking;
  }

  dispose(): void {
    this.unwatch?.();
    this.unwatch = undefined;
    this.path = undefined;
  }

  /** 변경을 순서대로 하나씩 판단한다 (덧붙은 범위를 차례로 읽기 위함). */
  private enqueue(change: FileChange): void {
    this.checking = this.checking.then(() => this.check(change)).catch(() => {});
  }

  private async check(change: FileChange): Promise<void> {
    if (change.path !== this.path) return;
    const from = this.lastSize;
    this.lastSize = change.size;
    if (this.detected !== undefined) return;
    // 파일이 줄었으면(다시 쓰기) 판단하지 않고 크기만 맞춘다.
    if (change.size <= from) return;
    if (change.modified - this.lastActivity < this.graceMs) return;

    const appended = await this.readRange(change.path, from, Math.min(change.size, from + MAX_READ));
    if (!/"type"\s*:\s*"message"/.test(appended)) return;
    if (change.path !== this.path || this.detected !== undefined) return;
    this.detected = this.now();
    this.onDetect(change.path, this.detected);
  }
}

async function readFileRange(path: string, from: number, to: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, to - from));
    await handle.read(buffer, 0, buffer.length, from);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}
