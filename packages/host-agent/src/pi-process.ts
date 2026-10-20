import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createJsonlReader, encodeJsonl, type PiResponse } from "@pi-desktop/host-protocol";

export interface PiProcessOptions {
  /** Pi를 실행할 node 실행 파일 */
  nodePath: string;
  /** Pi CLI 진입 파일 (`dist/bundle/cli.js`) */
  cliPath: string;
  cwd: string;
  /** `--mode rpc` 뒤에 붙일 인자 */
  args?: string[];
  env?: NodeJS.ProcessEnv;
  /** 응답 대기 제한 시간 (ms) */
  responseTimeoutMs?: number;
}

export interface PiExit {
  exitCode: number | null;
  signal: string | null;
  stderrTail: string;
}

const STDERR_TAIL_BYTES = 8 * 1024;

/**
 * `pi --mode rpc` 자식 프로세스 하나를 감싼다.
 *
 * - 데몬이 보내는 명령에는 `d-<번호>` 형태의 id를 붙이고, 같은 id의 `response`를 돌려준다.
 * - 그 밖의 모든 레코드(세션 이벤트, extension UI 요청, id 없는 오류 응답 등)는 해석하지 않고
 *   `onRecord`로 넘긴다. 저널에 그대로 쌓기 위해서다 (설계 §1: 모르는 이벤트도 버리지 않음).
 */
export class PiProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private stderrTail = "";
  private exited: PiExit | undefined;
  private readonly pending = new Map<
    string,
    { resolve: (r: PiResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly recordListeners = new Set<(record: unknown) => void>();
  private readonly exitListeners = new Set<(exit: PiExit) => void>();

  constructor(private readonly options: PiProcessOptions) {}

  start(): void {
    if (this.child) throw new Error("이미 시작한 Pi 프로세스입니다");
    const child = spawn(this.options.nodePath, [this.options.cliPath, "--mode", "rpc", ...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const reader = createJsonlReader((record) => this.handleRecord(record));
    child.stdout.on("data", (chunk: Buffer) => reader.push(chunk));
    child.stdout.on("end", () => reader.end());
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });
    // 프로세스가 먼저 죽으면 stdin 쓰기에서 EPIPE가 날 수 있다. 종료 처리는 exit 이벤트가 맡는다.
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      this.stderrTail += `\n[spawn error] ${error.message}`;
      this.finish(null, null);
    });
    child.on("exit", (code, signal) => this.finish(code, signal));
  }

  /** Pi RPC 명령을 보내고 응답을 기다린다. */
  send(command: Record<string, unknown>): Promise<PiResponse> {
    if (this.exited || !this.child) {
      return Promise.reject(new Error("Pi 프로세스가 실행 중이 아닙니다"));
    }
    const id = `d-${this.nextId++}`;
    const timeoutMs = this.options.responseTimeoutMs ?? 60_000;
    return new Promise<PiResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi 응답 시간 초과: ${String(command.type)}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ ...command, id });
    });
  }

  /** 응답이 없는 레코드를 그대로 보낸다 (예: `extension_ui_response`). */
  sendRaw(record: Record<string, unknown>): void {
    if (this.exited || !this.child) throw new Error("Pi 프로세스가 실행 중이 아닙니다");
    this.write(record);
  }

  onRecord(listener: (record: unknown) => void): () => void {
    this.recordListeners.add(listener);
    return () => this.recordListeners.delete(listener);
  }

  onExit(listener: (exit: PiExit) => void): () => void {
    if (this.exited) {
      listener(this.exited);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /**
   * 정상 종료를 요청한다. Pi 문서대로 stdin을 닫고, 제한 시간 안에 끝나지 않으면 강제 종료한다.
   */
  async stop(graceMs = 5_000): Promise<PiExit> {
    if (this.exited) return this.exited;
    const child = this.child;
    if (!child) throw new Error("시작하지 않은 Pi 프로세스입니다");
    const done = new Promise<PiExit>((resolve) => this.onExit(resolve));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), graceMs);
    const exit = await done;
    clearTimeout(timer);
    return exit;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get isRunning(): boolean {
    return Boolean(this.child) && !this.exited;
  }

  private write(record: Record<string, unknown>): void {
    this.child?.stdin.write(encodeJsonl(record));
  }

  private handleRecord(record: unknown): void {
    if (isOwnResponse(record)) {
      const pending = this.pending.get(record.id);
      if (pending) {
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        pending.resolve(record);
        return;
      }
    }
    for (const listener of this.recordListeners) listener(record);
  }

  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = { exitCode: code, signal, stderrTail: this.stderrTail };
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Pi 프로세스가 종료되었습니다"));
      this.pending.delete(id);
    }
    for (const listener of this.exitListeners) listener(this.exited);
    this.exitListeners.clear();
  }
}

function isOwnResponse(record: unknown): record is PiResponse & { id: string } {
  if (typeof record !== "object" || record === null) return false;
  const r = record as Record<string, unknown>;
  return r.type === "response" && typeof r.id === "string" && r.id.startsWith("d-");
}
