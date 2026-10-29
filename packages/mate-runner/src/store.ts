import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isProfile } from "@pi-desktop/mate-kit";
import type { MatePaths } from "./paths";
import { parseTime } from "./schedule";
import {
  DEFAULT_CONFIG,
  MIN_INTERVAL_MINUTES,
  type Duty,
  type InboxState,
  type InboxStatus,
  type MateConfig,
  type RunRecord,
  type RunnerState,
  type RunRequest,
  type Trigger,
} from "./types";

/**
 * ~/.pi-desktop-mate 파일 읽기·쓰기 (설계 DESIGN-MATE.md §2.2).
 * 파일마다 쓰는 쪽이 하나다: config·duties·requests·inbox-state는 앱, state·runs는 실행기.
 * 쓰기는 임시 파일에 쓴 뒤 바꿔 넣어, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다.
 */

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  // Windows에서 읽는 쪽이 파일을 잠깐 열고 있으면 바꿔 넣기가 실패할 수 있어 몇 번 다시 시도한다.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      if (attempt >= 5) {
        await rm(tmp, { force: true });
        throw error;
      }
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    }
  }
}

// ── 설정 ──

export async function loadConfig(paths: MatePaths): Promise<MateConfig> {
  const raw = await readJson<Partial<MateConfig>>(paths.config, {});
  return {
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : DEFAULT_CONFIG.model,
    paused: raw.paused === true,
    dailyRunLimit:
      typeof raw.dailyRunLimit === "number" && raw.dailyRunLimit >= 0 ? Math.floor(raw.dailyRunLimit) : DEFAULT_CONFIG.dailyRunLimit,
  };
}

export async function saveConfig(paths: MatePaths, patch: Partial<MateConfig>): Promise<MateConfig> {
  const next = { ...(await loadConfig(paths)), ...patch };
  await writeJsonAtomic(paths.config, next);
  return loadConfig(paths);
}

// ── 임무 ──

const DUTY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isDutyId(id: unknown): id is string {
  return typeof id === "string" && DUTY_ID.test(id);
}

/** 이름에서 파일 이름으로 쓸 수 있는 id를 만든다 (한글 등은 빼고, 비면 무작위) */
export function dutyIdFrom(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `duty-${randomUUID().slice(0, 6)}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

function normalizeTrigger(raw: unknown): Trigger | undefined {
  const t = raw as Partial<Record<string, unknown>> | undefined;
  if (!t || typeof t !== "object") return undefined;
  if (t.kind === "manual") return { kind: "manual" };
  if (t.kind === "interval" && typeof t.minutes === "number" && Number.isFinite(t.minutes)) {
    return { kind: "interval", minutes: Math.max(MIN_INTERVAL_MINUTES, Math.round(t.minutes)) };
  }
  if (t.kind === "daily" && typeof t.time === "string" && parseTime(t.time)) {
    const weekdays = Array.isArray(t.weekdays)
      ? [...new Set(t.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
    return weekdays.length > 0 && weekdays.length < 7 ? { kind: "daily", time: t.time, weekdays } : { kind: "daily", time: t.time };
  }
  return undefined;
}

/** 파일·화면에서 온 값을 검사해 임무로 만든다. 잘못되면 이유를 돌려준다 */
export function normalizeDuty(raw: unknown): Duty | string {
  const d = raw as Partial<Record<string, unknown>> | undefined;
  if (!d || typeof d !== "object") return "임무 형식이 아닙니다";
  if (!isDutyId(d.id)) return "id는 영문 소문자·숫자·-만 쓸 수 있습니다";
  if (typeof d.name !== "string" || !d.name.trim()) return "이름이 필요합니다";
  if (typeof d.cwd !== "string" || !d.cwd.trim()) return "작업 폴더가 필요합니다";
  if (typeof d.prompt !== "string" || !d.prompt.trim()) return "지시가 필요합니다";
  if (!isProfile(d.profile)) return "권한 단계가 잘못되었습니다";
  const trigger = normalizeTrigger(d.trigger);
  if (!trigger) return "실행 시점이 잘못되었습니다";
  const duty: Duty = {
    id: d.id,
    name: d.name.trim(),
    enabled: d.enabled !== false,
    cwd: d.cwd.trim(),
    prompt: d.prompt.trim(),
    profile: d.profile,
    trigger,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
  };
  if (typeof d.model === "string" && d.model.trim()) duty.model = d.model.trim();
  if (typeof d.timeoutSec === "number" && d.timeoutSec > 0) duty.timeoutSec = Math.min(3600, Math.round(d.timeoutSec));
  if (typeof d.updatedAt === "number") duty.updatedAt = d.updatedAt;
  return duty;
}

export async function listDuties(paths: MatePaths): Promise<Duty[]> {
  let names: string[];
  try {
    names = await readdir(paths.duties);
  } catch {
    return [];
  }
  const duties: Duty[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const duty = normalizeDuty(await readJson<unknown>(join(paths.duties, name), undefined));
    if (typeof duty !== "string" && `${duty.id}.json` === name) duties.push(duty);
  }
  return duties.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getDuty(paths: MatePaths, id: string): Promise<Duty | undefined> {
  if (!isDutyId(id)) return undefined;
  const duty = normalizeDuty(await readJson<unknown>(join(paths.duties, `${id}.json`), undefined));
  return typeof duty === "string" ? undefined : duty;
}

export async function saveDuty(paths: MatePaths, raw: unknown): Promise<Duty> {
  const duty = normalizeDuty(raw);
  if (typeof duty === "string") throw new Error(duty);
  await writeJsonAtomic(join(paths.duties, `${duty.id}.json`), duty);
  return duty;
}

export async function deleteDuty(paths: MatePaths, id: string): Promise<void> {
  if (!isDutyId(id)) throw new Error("잘못된 임무 id입니다");
  await rm(join(paths.duties, `${id}.json`), { force: true });
}

// ── 실행 요청 ("지금 실행") ──

export async function addRequest(paths: MatePaths, dutyId: string, now = Date.now()): Promise<void> {
  if (!isDutyId(dutyId)) throw new Error("잘못된 임무 id입니다");
  const request: RunRequest = { dutyId, requestedAt: now };
  await writeJsonAtomic(join(paths.requests, `${now}-${dutyId}.json`), request);
}

/** 쌓인 요청을 오래된 순으로 꺼내고 파일은 지운다 */
export async function takeRequests(paths: MatePaths): Promise<RunRequest[]> {
  let names: string[];
  try {
    names = (await readdir(paths.requests)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const requests: RunRequest[] = [];
  for (const name of names) {
    const path = join(paths.requests, name);
    const request = await readJson<RunRequest | undefined>(path, undefined);
    await rm(path, { force: true });
    if (request && isDutyId(request.dutyId)) requests.push(request);
  }
  return requests;
}

export async function pendingRequests(paths: MatePaths): Promise<RunRequest[]> {
  try {
    const names = (await readdir(paths.requests)).filter((n) => n.endsWith(".json")).sort();
    const all = await Promise.all(names.map((n) => readJson<RunRequest | undefined>(join(paths.requests, n), undefined)));
    return all.filter((r): r is RunRequest => !!r);
  } catch {
    return [];
  }
}

// ── 실행기 상태·실행 기록 ──

export async function loadState(paths: MatePaths): Promise<RunnerState> {
  const raw = await readJson<Partial<RunnerState>>(paths.state, {});
  return {
    ...raw,
    duties: raw.duties && typeof raw.duties === "object" ? raw.duties : {},
    today: raw.today && typeof raw.today.date === "string" ? raw.today : { date: "", count: 0 },
  };
}

export async function saveState(paths: MatePaths, state: RunnerState): Promise<void> {
  await writeJsonAtomic(paths.state, state);
}

export async function writeRun(paths: MatePaths, run: RunRecord): Promise<void> {
  await writeJsonAtomic(join(paths.runs, `${run.id}.json`), run);
}

/** 최근 실행 기록 (새것부터). runId가 시각으로 시작하므로 이름순 = 시간순 */
export async function listRuns(paths: MatePaths, limit = 100): Promise<RunRecord[]> {
  let names: string[];
  try {
    names = (await readdir(paths.runs)).filter((n) => n.endsWith(".json")).sort().reverse().slice(0, limit);
  } catch {
    return [];
  }
  const runs = await Promise.all(names.map((n) => readJson<RunRecord | undefined>(join(paths.runs, n), undefined)));
  return runs.filter((r): r is RunRecord => !!r);
}

export async function pruneRuns(paths: MatePaths, keep = 200): Promise<void> {
  try {
    const names = (await readdir(paths.runs)).filter((n) => n.endsWith(".json")).sort();
    await Promise.all(names.slice(0, Math.max(0, names.length - keep)).map((n) => rm(join(paths.runs, n), { force: true })));
  } catch {
    // 폴더가 없으면 지울 것도 없다
  }
}

/** 시각 순으로 정렬되는 실행 id */
export function newRunId(now = Date.now()): string {
  return `${new Date(now).toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15)}-${randomUUID().slice(0, 6)}`;
}

// ── 인박스 상태 ──

export async function loadInboxState(paths: MatePaths): Promise<InboxState> {
  return readJson<InboxState>(paths.inboxState, {});
}

export async function setInboxStatus(paths: MatePaths, ids: string[], status: InboxStatus | undefined, now = Date.now()): Promise<InboxState> {
  const state = await loadInboxState(paths);
  for (const id of ids) {
    if (status) state[id] = { status, at: now };
    else delete state[id];
  }
  await writeJsonAtomic(paths.inboxState, state);
  return state;
}
