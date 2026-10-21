import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * 입력창 `@` 파일 피커용 파일 검색 (설계 §4.1). 데몬이 호스트에서 하므로 WSL·원격 호스트의 파일도 찾는다.
 *
 * - 목록: git 저장소면 `git ls-files`(추적 + 무시되지 않은 새 파일)로 .gitignore를 따른다.
 *   git이 아니면 흔한 생성물 폴더를 빼고 직접 훑는다. 폴더도 후보에 넣는다(끝에 "/").
 * - 목록은 작업 폴더별로 잠시(기본 10초) 캐시한다. 글자를 칠 때마다 다시 훑지 않기 위해서다.
 * - 경로 구분자는 항상 "/"다 (Windows에서도. Pi는 둘 다 읽는다).
 */

/** git이 아닌 폴더를 훑을 때 건너뛰는 폴더 */
export const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "target",
]);

export interface FileList {
  paths: string[];
  /** 너무 많아 일부만 담았다 */
  truncated: boolean;
}

export interface FileSearchResult {
  files: string[];
  truncated: boolean;
}

/**
 * 검색어로 경로 순위를 매긴다. 낮은 등급이 앞이다.
 * 0 이름이 같음 · 1 이름이 검색어로 시작 · 2 이름에 들어 있음 · 3 경로에 들어 있음 · 4 글자가 순서대로 들어 있음
 * 같은 등급이면 짧은 경로, 그다음 가나다순. 검색어가 비면 얕은 경로부터.
 */
export function rankPaths(paths: readonly string[], query: string, limit: number): string[] {
  const q = query.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const byLength = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
  if (!q) {
    const depth = (p: string) => p.replace(/\/$/, "").split("/").length;
    return [...paths].sort((a, b) => depth(a) - depth(b) || byLength(a, b)).slice(0, limit);
  }
  const scored: Array<{ path: string; tier: number }> = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const name = lower.replace(/\/$/, "").split("/").pop() ?? lower;
    let tier: number | undefined;
    if (name === q) tier = 0;
    else if (name.startsWith(q)) tier = 1;
    else if (name.includes(q)) tier = 2;
    else if (lower.includes(q)) tier = 3;
    else if (isSubsequence(q, lower)) tier = 4;
    if (tier !== undefined) scored.push({ path, tier });
  }
  scored.sort((a, b) => a.tier - b.tier || byLength(a.path, b.path));
  return scored.slice(0, limit).map((s) => s.path);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const ch of haystack) {
    if (ch === needle[at]) at++;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

/** 파일 경로들에서 상위 폴더를 뽑아 함께 돌려준다 (폴더는 끝에 "/") */
export function withDirectories(files: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join("/")}/`);
  }
  return [...dirs, ...files];
}

/** git 저장소면 파일 목록, 아니면(또는 git이 없으면) undefined */
export function listGitFiles(cwd: string, maxEntries: number): Promise<FileList | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(undefined);
        const files = [...new Set(String(stdout).split("\0").filter(Boolean))];
        resolve({ paths: files.slice(0, maxEntries), truncated: files.length > maxEntries });
      },
    );
  });
}

/** git이 아닌 폴더를 너비 우선으로 훑는다. 생성물 폴더와 숨은 폴더 일부는 건너뛴다 */
export async function walkFiles(cwd: string, maxEntries: number): Promise<FileList> {
  const paths: string[] = [];
  const queue = [""];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    const entries = await readdir(join(cwd, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(path);
      } else if (entry.isFile()) {
        paths.push(path);
        if (paths.length >= maxEntries) return { paths, truncated: true };
      }
    }
  }
  return { paths, truncated: false };
}

export interface FileIndexOptions {
  /** 목록에 담는 최대 파일 수 (기본 50,000) */
  maxEntries?: number;
  /** 목록 캐시 시간 (기본 10초) */
  ttlMs?: number;
  /** 테스트용: 목록을 만드는 함수 */
  list?: (cwd: string, maxEntries: number) => Promise<FileList>;
}

/** 작업 폴더별 파일 목록 캐시와 검색 */
export class FileIndex {
  private readonly cache = new Map<string, { at: number; list: Promise<FileList> }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly list: (cwd: string, maxEntries: number) => Promise<FileList>;

  constructor(options: FileIndexOptions = {}) {
    this.maxEntries = options.maxEntries ?? 50_000;
    this.ttlMs = options.ttlMs ?? 10_000;
    this.list = options.list ?? (async (cwd, max) => (await listGitFiles(cwd, max)) ?? walkFiles(cwd, max));
  }

  async search(cwd: string, query: string, limit = 50): Promise<FileSearchResult> {
    const now = Date.now();
    let cached = this.cache.get(cwd);
    if (!cached || now - cached.at > this.ttlMs) {
      cached = { at: now, list: this.list(cwd, this.maxEntries) };
      this.cache.set(cwd, cached);
      // 실패한 목록은 다음 요청에서 다시 만든다.
      cached.list.catch(() => this.cache.delete(cwd));
    }
    const list = await cached.list;
    return { files: rankPaths(withDirectories(list.paths), query, limit), truncated: list.truncated };
  }
}
