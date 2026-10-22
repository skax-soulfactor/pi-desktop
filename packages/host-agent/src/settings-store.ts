import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiLocation, SettingsReadResult } from "@pi-desktop/host-protocol";

/**
 * 사용자 settings.json 읽기와 항목 단위 쓰기 (설계 §5.9 "settings.json은 항목 단위로 골라서 복사").
 *
 * - 전체를 덮어쓰지 않는다. 받은 최상위 키만 바꾸고 나머지는 그대로 둔다.
 * - 쓰기 직전에 파일을 다시 읽으므로, 그 사이 Pi가 다른 키를 바꿨어도 지우지 않는다.
 * - 쓰기 전에 settings.json.bak으로 백업하고, 임시 파일 → 이름 바꾸기로 원자적으로 쓴다. 깨진 파일은 덮어쓰지 않는다.
 */

type Json = Record<string, unknown>;

export function settingsPath(agentDir: string): string {
  return join(agentDir, "settings.json");
}

async function readSettingsFile(path: string): Promise<{ exists: boolean; data: Json }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { exists: false, data: {} };
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json 최상위가 객체가 아닙니다");
  return { exists: true, data: parsed as Json };
}

/** 사용자 settings.json의 최상위 값. 깨졌으면 error를 담는다 */
export async function readSettings(agentDir: string): Promise<SettingsReadResult> {
  try {
    const { exists, data } = await readSettingsFile(settingsPath(agentDir));
    return { exists, values: data };
  } catch (e) {
    return { exists: true, values: {}, error: `settings.json을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 받은 최상위 키만 바꾸고 remove의 키는 지운다. 나머지 키는 그대로 둔다 */
export async function mergeSettings(agentDir: string, values: Json, remove: readonly string[] = []): Promise<void> {
  const keys = Object.keys(values);
  if (keys.length === 0 && remove.length === 0) throw new Error("바꿀 항목이 없습니다");
  const path = settingsPath(agentDir);
  const { exists, data } = await readSettingsFile(path);
  const next: Json = { ...data };
  for (const key of keys) next[key] = values[key];
  for (const key of remove) delete next[key];
  if (exists) await copyFile(path, `${path}.bak`);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, path);
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
