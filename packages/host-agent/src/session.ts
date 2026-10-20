import { randomUUID } from "node:crypto";
import type { PiLocation, PiResponse, SessionSummary } from "@pi-desktop/host-protocol";
import { EventJournal, type JournalEntry } from "./journal";
import { PiProcess, type PiExit } from "./pi-process";

export interface AgentSessionOptions {
  cwd: string;
  pi: PiLocation;
  nodePath: string;
  sessionFile?: string;
  piArgs?: string[];
  env?: NodeJS.ProcessEnv;
  journalCapacity?: number;
}

/**
 * 데몬이 소유하는 세션 하나 = Pi RPC 프로세스 하나 + 이벤트 저널.
 *
 * 앱 연결과 수명이 무관하다. 앱이 모두 떠나도 Pi는 계속 돌고 이벤트는 저널에 쌓인다 (설계 §3.4).
 */
export class AgentSession {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  readonly journal: EventJournal;
  private readonly process: PiProcess;
  private sessionFile: string | undefined;
  private exitInfo: PiExit | undefined;
  private readonly entryListeners = new Set<(entry: JournalEntry) => void>();
  private readonly exitListeners = new Set<(exit: PiExit) => void>();

  constructor(private readonly options: AgentSessionOptions) {
    this.journal = new EventJournal(options.journalCapacity);
    const args = [...(options.piArgs ?? [])];
    if (options.sessionFile) args.push("--session", options.sessionFile);
    this.process = new PiProcess({
      nodePath: options.nodePath,
      cliPath: options.pi.cliPath,
      cwd: options.cwd,
      args,
      env: options.env,
    });
    this.sessionFile = options.sessionFile;
  }

  /**
   * Pi를 띄우고 `get_state`로 준비 완료를 확인한다.
   * 이때 Pi가 정한 세션 파일 경로를 알아 두어, 나중에 프로세스가 죽어도 이어 열 수 있게 한다.
   */
  async start(): Promise<void> {
    this.process.onRecord((record) => {
      const entry = this.journal.append(record);
      for (const listener of this.entryListeners) listener(entry);
    });
    this.process.onExit((exit) => {
      this.exitInfo = exit;
      for (const listener of this.exitListeners) listener(exit);
    });
    this.process.start();

    let state: Awaited<ReturnType<PiProcess["send"]>>;
    try {
      state = await this.process.send({ type: "get_state" });
    } catch (error) {
      // 시작 중에 죽었다면 stderr에 원인이 있으므로 함께 알린다 (예: 잘못된 인자, 모델 없음).
      const detail = this.exitInfo?.stderrTail.trim();
      throw new Error(
        detail ? `Pi가 시작 중 종료되었습니다:\n${detail.split("\n").slice(-10).join("\n")}` : String(error),
      );
    }
    const data = state.data as Record<string, unknown> | undefined;
    if (state.success === true && typeof data?.sessionFile === "string") {
      this.sessionFile = data.sessionFile;
    } else if (state.success !== true) {
      throw new Error(`Pi 초기화 실패: ${String(state.error ?? "get_state 실패")}`);
    }
  }

  send(command: Record<string, unknown>): Promise<PiResponse> {
    return this.process.send(command);
  }

  sendRaw(record: Record<string, unknown>): void {
    this.process.sendRaw(record);
  }

  onEntry(listener: (entry: JournalEntry) => void): () => void {
    this.entryListeners.add(listener);
    return () => this.entryListeners.delete(listener);
  }

  onExit(listener: (exit: PiExit) => void): () => void {
    if (this.exitInfo) {
      listener(this.exitInfo);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  stop(): Promise<PiExit> {
    return this.process.stop();
  }

  get isRunning(): boolean {
    return this.process.isRunning;
  }

  summary(): SessionSummary {
    const summary: SessionSummary = {
      sessionId: this.id,
      cwd: this.options.cwd,
      state: this.exitInfo ? "exited" : "running",
      lastSeq: this.journal.lastSeq,
      piVersion: this.options.pi.version,
      startedAt: this.startedAt,
    };
    if (this.sessionFile) summary.sessionFile = this.sessionFile;
    if (this.exitInfo) summary.exitCode = this.exitInfo.exitCode;
    return summary;
  }
}
