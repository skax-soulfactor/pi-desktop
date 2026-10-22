import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PiLocation, SettingsReadResult } from "@pi-desktop/host-protocol";

/**
 * settings.json 읽기와 쓰기 (설계 §4.8 설정 폼, §5.9 "settings.json은 항목 단위로 골라서 복사").
 *
 * 사용자 범위는 데이터 폴더의 settings.json, 프로젝트 범위는 작업 폴더의 .pi/settings.json이다.
 * - 항목 쓰기(merge): 전체를 덮어쓰지 않는다. 받은 최상위 키만 바꾸고 나머지는 그대로 둔다.
 *   쓰기 직전에 파일을 다시 읽으므로, 그 사이 Pi가 다른 키를 바꿨어도 지우지 않는다.
 * - 원본 쓰기(write): JSON 편집 모드. 읽을 때의 수정 시각과 다르면(그 사이 바뀜) 거부한다.
 * - 쓰기 전에 settings.json.bak으로 백업하고, 임시 파일 → 이름 바꾸기로 원자적으로 쓴다. 깨진 파일은 덮어쓰지 않는다.
 */

type Json = Record<string, unknown>;

export function settingsPath(agentDir: string): string {
  return join(agentDir, "settings.json");
}

/** 범위에 맞는 settings.json 경로. 프로젝트는 작업 폴더가 있어야 한다 */
export function settingsFileFor(scope: "user" | "project" | undefined, agentDir: string, cwd: string | undefined): string {
  if (scope !== "project") return settingsPath(agentDir);
  if (!cwd) throw new Error("프로젝트 설정에는 작업 폴더가 필요합니다");
  return join(cwd, ".pi", "settings.json");
}

function parseSettings(raw: string): Json {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json 최상위가 객체가 아닙니다");
  return parsed as Json;
}

async function readSettingsFile(path: string): Promise<{ exists: boolean; data: Json }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { exists: false, data: {} };
  }
  return { exists: true, data: parseSettings(raw) };
}

/** settings.json의 최상위 값과 원본 글·수정 시각. 깨졌으면 error를 담는다 (원본 글은 그대로 준다) */
export async function readSettings(path: string): Promise<SettingsReadResult> {
  let raw: string;
  let mtimeMs: number;
  try {
    [raw, mtimeMs] = await Promise.all([readFile(path, "utf8"), stat(path).then((s) => s.mtimeMs)]);
  } catch {
    return { path, exists: false, values: {}, raw: "" };
  }
  try {
    return { path, exists: true, values: parseSettings(raw), raw, mtimeMs };
  } catch (e) {
    return { path, exists: true, values: {}, raw, mtimeMs, error: `settings.json을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function writeAtomic(path: string, text: string, existed: boolean): Promise<void> {
  if (existed) await copyFile(path, `${path}.bak`);
  else await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}

/** 받은 최상위 키만 바꾸고 remove의 키는 지운다. 나머지 키는 그대로 둔다 */
export async function mergeSettings(path: string, values: Json, remove: readonly string[] = []): Promise<void> {
  const keys = Object.keys(values);
  if (keys.length === 0 && remove.length === 0) throw new Error("바꿀 항목이 없습니다");
  const { exists, data } = await readSettingsFile(path);
  const next: Json = { ...data };
  for (const key of keys) next[key] = values[key];
  for (const key of remove) delete next[key];
  await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`, exists);
}

/**
 * 원본 글을 그대로 쓴다 (JSON 편집 모드). 최상위가 객체인 JSON이어야 한다.
 * baseMtime은 읽을 때의 수정 시각이다. 없으면(null) 파일이 없을 때만 쓴다.
 */
export async function writeSettingsRaw(path: string, content: string, baseMtime: number | null): Promise<{ mtimeMs: number }> {
  try {
    parseSettings(content);
  } catch (e) {
    throw new Error(`JSON이 올바르지 않습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
  const current = await stat(path).catch(() => undefined);
  if (baseMtime === null ? current !== undefined : current?.mtimeMs !== baseMtime) {
    throw new Error("읽은 뒤에 settings.json이 바뀌었습니다. 다시 읽은 뒤 고치세요");
  }
  await writeAtomic(path, content.endsWith("\n") ? content : `${content}\n`, current !== undefined);
  return { mtimeMs: (await stat(path)).mtimeMs };
}

/**
 * 설치된 Pi가 함께 배포한 settings.json의 JSON Schema (<Pi 패키지>/schemas/settings.schema.json).
 * 앱은 이것으로 설정 폼을 만든다. 그 Pi 버전의 항목을 그대로 따르므로 Pi가 항목을 늘려도 앱을 고칠 필요가 없다.
 * 이 파일이 없는 Pi면 null이다.
 */
export async function readSettingsSchema(pi: PiLocation): Promise<Json | null> {
  try {
    const parsed = JSON.parse(await readFile(join(pi.packageDir, "schemas", "settings.schema.json"), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    return null;
  }
}
