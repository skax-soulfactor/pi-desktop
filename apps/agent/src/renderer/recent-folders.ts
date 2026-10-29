/**
 * 최근에 대화를 연 작업 폴더 (설계 DESIGN-AGENT.md §4 "작업 폴더").
 * 새 대화·폴더 옮기기에서 고를 수 있게 이 PC(앱 화면)에만 둔다. 저장하지 못해도 동작한다.
 */
const KEY = "agent.recentCwds";
const LAST_KEY = "agent.lastCwd";
export const MAX_RECENT = 6;

/** Windows 경로는 대소문자·구분자가 달라도 같은 폴더로 본다 */
function same(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}

export function addRecent(list: string[], folder: string, max = MAX_RECENT): string[] {
  return [folder, ...list.filter((f) => !same(f, folder))].slice(0, max);
}

export function recentFolders(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    const list = Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : [];
    // 최근 목록이 없던 예전 버전(v0.1.2)이 기억한 마지막 폴더도 살린다
    const last = localStorage.getItem(LAST_KEY);
    return last && !list.some((f) => same(f, last)) ? [...list, last].slice(0, MAX_RECENT) : list;
  } catch {
    return [];
  }
}

export function lastFolder(): string | undefined {
  return recentFolders()[0];
}

export function rememberFolder(folder: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(addRecent(recentFolders(), folder)));
    localStorage.setItem(LAST_KEY, folder);
  } catch {
    // 기억하지 못해도 대화는 연다
  }
}

export function isSameFolder(a: string, b: string): boolean {
  return same(a, b);
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
