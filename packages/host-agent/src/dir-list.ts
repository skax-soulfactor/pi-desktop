import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { FsListDirResult } from "@pi-desktop/host-protocol";

/**
 * 폴더 탐색 창용 하위 폴더 목록 (설계 §5.5, M3).
 * Electron의 폴더 선택 대화상자는 Windows 파일 시스템만 보여주므로, WSL·원격 호스트는 데몬이 그 호스트에서 훑는다.
 *
 * - 경로가 비었거나 `~`면 홈, `~/x`는 홈 기준, 상대 경로도 홈 기준으로 푼다.
 * - 폴더만 돌려준다. 폴더를 가리키는 링크도 폴더로 친다(대상을 확인할 수 없는 링크는 뺀다).
 * - 숨김 폴더(`.`으로 시작)도 담는다. 보일지는 화면에서 정한다.
 */

/** 한 폴더에서 돌려줄 최대 하위 폴더 수 */
export const MAX_DIRS = 2000;

/** 입력 경로를 호스트의 절대 경로로 푼다 */
export function resolveDirPath(input: string | undefined, home: string): string {
  const raw = (input ?? "").trim();
  if (!raw || raw === "~") return resolve(home);
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return resolve(home, raw.slice(2));
  return isAbsolute(raw) ? resolve(raw) : resolve(home, raw);
}

export async function listDirectories(input: string | undefined, home: string): Promise<FsListDirResult> {
  const path = resolveDirPath(input, home);
  const info = await stat(path).catch(() => undefined);
  if (!info) throw new Error(`폴더가 없습니다: ${path}`);
  if (!info.isDirectory()) throw new Error(`폴더가 아닙니다: ${path}`);

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (e) {
    throw new Error(`폴더를 읽지 못했습니다: ${path} (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(entry.name);
    else if (entry.isSymbolicLink()) {
      const target = await stat(join(path, entry.name)).catch(() => undefined);
      if (target?.isDirectory()) dirs.push(entry.name);
    }
  }
  dirs.sort((a, b) => a.localeCompare(b));
  const parent = dirname(path);
  return {
    path,
    ...(parent !== path ? { parent } : {}),
    home: resolve(home),
    dirs: dirs.slice(0, MAX_DIRS),
    truncated: dirs.length > MAX_DIRS,
  };
}
