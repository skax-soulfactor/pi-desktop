import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * 파일·폴더 트리 변경 감시 (Extension Dev Mode, 설계 §4.5 "저장할 때마다 자동 reload").
 *
 * fs.watch 대신 주기적으로 훑어 수정 시각·크기를 견준다. WSL·네트워크 드라이브·SSH 호스트에서도 같게 동작한다.
 * 뿌리(root)는 파일이나 폴더다. 폴더는 아래를 모두 보되 node_modules·.git은 건너뛰고, 너무 많으면 앞의 것만 본다.
 * 없는 뿌리는 비어 있는 것으로 본다(나중에 생기면 바뀐 것으로 알린다).
 */

const SKIPPED = new Set(["node_modules", ".git"]);
export const MAX_FILES = 2000;

/** 뿌리들 아래 파일의 "수정 시각:크기" */
export async function snapshot(roots: readonly string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const visit = async (path: string): Promise<void> => {
    if (files.size >= MAX_FILES) return;
    const info = await stat(path).catch(() => undefined);
    if (!info) return;
    if (info.isFile()) {
      files.set(path, `${info.mtimeMs}:${info.size}`);
      return;
    }
    if (!info.isDirectory()) return;
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED.has(entry.name)) continue;
      await visit(join(path, entry.name));
    }
  };
  for (const root of roots) await visit(root);
  return files;
}

/** 두 스냅숏 사이에 생기거나 바뀌거나 사라진 파일 (경로 순) */
export function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, sig] of after) if (before.get(path) !== sig) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

/** 뿌리들을 주기적으로 훑어 바뀐 파일을 알린다. 반환된 함수를 부르면 멈춘다 */
export function watchTree(roots: readonly string[], onChange: (paths: string[]) => void, intervalMs = 1000): () => void {
  let stopped = false;
  let previous: Map<string, string> | undefined;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    const current = await snapshot(roots);
    if (stopped) return;
    if (previous) {
      const paths = changedPaths(previous, current);
      if (paths.length > 0) onChange(paths);
    }
    previous = current;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref?.();
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
