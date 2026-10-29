import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { appendProposal, extensionEntries, makeProposal } from "@pi-desktop/mate-kit";
import { runPi, type PiLaunch, type RunOutcome } from "./executor";
import type { MatePaths } from "./paths";
import { isDue, localDateKey } from "./schedule";
import {
  getDuty,
  listDuties,
  loadConfig,
  loadState,
  newRunId,
  pruneRuns,
  saveState,
  takeRequests,
  writeRun,
} from "./store";
import { DEFAULT_TIMEOUT_SEC, type Duty, type RunRecord, type RunnerState } from "./types";

const TICK_MS = 30_000;
const LOG_LIMIT = 1_000_000;

export interface RunnerOptions {
  paths: MatePaths;
  /** mate-kit 폴더 */
  kitDir: string;
  /** 실행마다 Pi 위치를 찾는다 (사용자가 Pi를 업데이트해도 따라가도록) */
  locatePi: () => Promise<PiLaunch>;
  build?: string;
  now?: () => number;
}

export async function log(paths: MatePaths, message: string): Promise<void> {
  try {
    await mkdir(paths.runDir, { recursive: true });
    const size = await stat(paths.log).then((s) => s.size, () => 0);
    if (size > LOG_LIMIT) await writeFile(paths.log, "", "utf8");
    await appendFile(paths.log, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // 로그 실패로 실행을 멈추지 않는다
  }
}

/**
 * 임무 한 번을 실행하고 기록을 남긴다.
 * observe 단계는 제안 도구가 없으므로 마지막 답변을 인박스에 결과로 남긴다 (실행마다 한 건, 같은 내용은 중복 제거).
 */
export async function runDuty(
  options: RunnerOptions,
  duty: Duty,
  reason: RunRecord["reason"],
  signal?: AbortSignal,
  runId = newRunId((options.now ?? Date.now)()),
): Promise<RunRecord> {
  const { paths } = options;
  const now = options.now ?? Date.now;
  const config = await loadConfig(paths);
  const record: RunRecord = {
    id: runId,
    dutyId: duty.id,
    dutyName: duty.name,
    reason,
    status: "running",
    startedAt: now(),
    model: duty.model ?? config.model,
    profile: duty.profile,
  };
  await writeRun(paths, record);
  await log(paths, `run start ${runId} duty=${duty.id} reason=${reason} model=${record.model}`);

  let outcome: RunOutcome;
  try {
    const [launch, extensions] = await Promise.all([options.locatePi(), extensionEntries(options.kitDir)]);
    outcome = await runPi(
      launch,
      {
        duty,
        runId,
        model: record.model,
        extensions,
        inboxPath: paths.inbox,
        sessionsDir: paths.sessions,
        timeoutSec: duty.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
      },
      signal,
    );
  } catch (error) {
    outcome = { status: "failed", error: (error as Error).message, costUsd: 0, tokens: 0, proposals: 0 };
  }

  if (duty.profile === "observe" && outcome.status === "done" && outcome.summary) {
    const item = makeProposal({ title: `${duty.name} 결과`, summary: outcome.summary }, { dutyId: duty.id, runId });
    if (await appendProposal(paths.inbox, item)) outcome.proposals += 1;
  }

  const finished: RunRecord = { ...record, ...outcome, endedAt: now() };
  await writeRun(paths, finished);
  await pruneRuns(paths);
  await log(paths, `run end ${runId} status=${finished.status}${finished.error ? ` error=${finished.error.split("\n")[0]}` : ""}`);
  return finished;
}

/**
 * 상주 실행기 (설계 DESIGN-MATE.md §2.3).
 * 30초마다(그리고 실행 요청 폴더가 바뀌면 바로) 요청과 시간표를 확인하고, 한 번에 하나씩 실행한다.
 */
export class Runner {
  private state: RunnerState = { duties: {}, today: { date: "", count: 0 } };
  private busy = false;
  private again = false;
  private timer: NodeJS.Timeout | undefined;
  private watcher: FSWatcher | undefined;
  private abort = new AbortController();
  /** "지금 실행" 요청 중 아직 실행하지 않은 임무 */
  private queue: string[] = [];

  constructor(private readonly options: RunnerOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  async start(): Promise<void> {
    const { paths } = this.options;
    await mkdir(paths.requests, { recursive: true });
    this.state = await loadState(paths);
    // 지난번 실행기가 실행 도중 끝났다면 그 실행은 실패로 남긴다
    delete this.state.current;
    this.state = { ...this.state, pid: process.pid, build: this.options.build, startedAt: this.now(), heartbeatAt: this.now() };
    await saveState(paths, this.state);
    await log(paths, `runner start pid=${process.pid}`);
    try {
      this.watcher = watch(paths.requests, () => void this.tick());
    } catch {
      // 감시를 못 해도 주기 확인으로 처리된다
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.watcher?.close();
    // 도는 실행이 있으면 abort 신호로 Pi 프로세스 트리를 끝낸다
    this.abort.abort();
    await log(this.options.paths, `runner stop pid=${process.pid}`);
  }

  /** 할 일이 없을 때까지 요청 → 시간표 순으로 하나씩 실행한다 */
  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        const next = await this.pickNext();
        await this.heartbeat();
        if (!next) break;
        await this.execute(next.duty, next.reason);
        this.again = true;
      } while (this.again && !this.abort.signal.aborted);
    } catch (error) {
      await log(this.options.paths, `tick error ${(error as Error).stack ?? error}`);
    } finally {
      this.busy = false;
    }
  }

  private async pickNext(): Promise<{ duty: Duty; reason: RunRecord["reason"] } | undefined> {
    const { paths } = this.options;
    const requests = await takeRequests(paths);
    for (const request of requests) this.queue.push(request.dutyId);
    while (this.queue.length > 0) {
      const duty = await getDuty(paths, this.queue.shift()!);
      if (duty) return { duty, reason: "manual" };
    }
    const config = await loadConfig(paths);
    if (config.paused) return undefined;
    const today = localDateKey(this.now());
    if (this.state.today.date !== today) this.state.today = { date: today, count: 0 };
    if (this.state.today.count >= config.dailyRunLimit) return undefined;
    for (const duty of await listDuties(paths)) {
      if (isDue(duty, this.state.duties[duty.id]?.lastRunAt, this.now())) return { duty, reason: "schedule" };
    }
    return undefined;
  }

  private async execute(duty: Duty, reason: RunRecord["reason"]): Promise<void> {
    const { paths } = this.options;
    const startedAt = this.now();
    // 실패해도 마지막 실행 시각을 남겨, 같은 임무를 곧바로 다시 돌리지 않는다
    this.state.duties[duty.id] = { ...this.state.duties[duty.id], lastRunAt: startedAt };
    if (reason === "schedule") this.state.today.count += 1;
    const runId = newRunId(startedAt);
    this.state.current = { runId, dutyId: duty.id, startedAt };
    await saveState(paths, this.state);
    const record = await runDuty(this.options, duty, reason, this.abort.signal, runId);
    this.state.duties[duty.id] = { lastRunAt: startedAt, lastStatus: record.status };
    delete this.state.current;
    await saveState(paths, this.state);
  }

  private async heartbeat(): Promise<void> {
    this.state.heartbeatAt = this.now();
    await saveState(this.options.paths, this.state);
  }
}

// ── 하나만 돌기 ──

export function isAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: 있지만 신호를 보낼 권한이 없음 (살아 있음)
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readPid(paths: MatePaths): Promise<number | undefined> {
  const text = await readFile(paths.pid, "utf8").catch(() => "");
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** 다른 실행기가 살아 있으면 false. 아니면 자기 pid를 기록한다 */
export async function acquirePid(paths: MatePaths): Promise<boolean> {
  await mkdir(paths.runDir, { recursive: true });
  const existing = await readPid(paths);
  if (existing && existing !== process.pid && isAlive(existing)) return false;
  await writeFile(paths.pid, String(process.pid), "utf8");
  // 동시에 둘이 떴다면 나중에 쓴 쪽만 남는다
  await new Promise((r) => setTimeout(r, 50));
  return (await readPid(paths)) === process.pid;
}

export async function releasePid(paths: MatePaths): Promise<void> {
  if ((await readPid(paths)) === process.pid) await rm(paths.pid, { force: true });
}

export async function fileHash(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 16);
}
