import type { ResourcesView } from "@pi-desktop/host-protocol/messages";

/**
 * Extension Dev Mode의 순수 함수들 (설계 §4.5 "Extension Dev Mode는 저장할 때마다 자동 reload").
 */

/** 경로 구분자 (Windows 경로면 \, 그 밖은 /) */
function sepOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function parentOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

/**
 * 감시할 파일·폴더: 이 세션이 불러오는 확장(내장·패키지에 든 것은 빼고)과, 새 확장이 생길 수 있는
 * 사용자·프로젝트의 extensions 폴더. 폴더 확장(index.ts·index.js)은 그 폴더째 본다. 겹치는 것은 하나로 줄인다.
 */
export function devModeRoots(view: Pick<ResourcesView, "cwd" | "agentDir" | "extensions">): string[] {
  const roots = new Set<string>();
  for (const ext of view.extensions) {
    if (ext.path.startsWith("builtin:") || ext.fromPackage) continue;
    const name = ext.path.split(/[\\/]/).pop() ?? "";
    roots.add(/^index\.(ts|js|mts|mjs|cts|cjs)$/i.test(name) ? parentOf(ext.path) : ext.path);
  }
  roots.add(`${view.agentDir}${sepOf(view.agentDir)}extensions`);
  roots.add(`${view.cwd}${sepOf(view.cwd)}.pi${sepOf(view.cwd)}extensions`);
  // 다른 뿌리 안에 든 것은 뺀다 (extensions 폴더 아래의 확장 등).
  const list = [...roots];
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return list.filter((p) => !list.some((other) => other !== p && norm(p).startsWith(`${norm(other)}/`))).sort();
}

/** 바뀐 파일 경로들을 짧게 (이름만, 셋까지) */
export function changedText(paths: readonly string[]): string {
  const names = paths.map((p) => p.split(/[\\/]/).pop() ?? p);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}개`;
}
