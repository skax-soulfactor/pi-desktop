import { posix } from "node:path";
import type { GithubCatalog, GithubFile, GithubRepoRef } from "../shared/api";

/**
 * Marketplace의 GitHub 저장소 카탈로그 (설계 §4.6). 공개 저장소만 읽으므로 이 PC(main)에서 조회한다.
 *
 * - 저장소를 훑어 SKILL.md가 든 폴더를 스킬로, prompts/ 아래 .md를 프롬프트로 찾는다.
 * - 커밋 SHA로 고정해 읽는다: 목록을 본 뒤 저장소가 바뀌어도 가져오는 내용이 달라지지 않도록.
 * - API 호출은 저장소당 두 번(커밋 SHA, 트리). 인증 없이 시간당 60회 한도가 있어 파일 내용은
 *   한도에 들지 않는 raw.githubusercontent.com에서 받는다.
 */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
/** 스킬 하나를 가져올 때의 한도 */
export const MAX_IMPORT_FILES = 200;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** "owner/repo", "owner/repo@ref", "https://github.com/owner/repo(/tree/ref)" */
export function parseRepoSpec(input: string): GithubRepoRef {
  const text = input.trim().replace(/\.git$/, "");
  const url = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^#?]+))?/.exec(text);
  const [owner, repo, ref] = url
    ? [url[1]!, url[2]!, url[3]]
    : (() => {
        const [path, at] = text.split("@", 2) as [string, string | undefined];
        const [o, r] = path.split("/");
        return [o ?? "", r ?? "", at];
      })();
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) throw new Error(`GitHub 저장소 형식이 아닙니다 (owner/repo): ${input}`);
  if (ref !== undefined && !/^[A-Za-z0-9_./-]+$/.test(ref)) throw new Error(`브랜치·태그 이름이 올바르지 않습니다: ${ref}`);
  return { owner, repo, ...(ref ? { ref } : {}) };
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

/** 트리에서 스킬(SKILL.md가 든 폴더)과 프롬프트(prompts/ 아래 .md)를 찾는다 */
export function catalogFromTree(ref: GithubRepoRef & { sha: string }, tree: TreeEntry[], truncated: boolean): GithubCatalog {
  const blobs = tree.filter((e) => e.type === "blob");
  const skillDirs = blobs.filter((e) => posix.basename(e.path).toLowerCase() === "skill.md").map((e) => posix.dirname(e.path));
  const skillSet = new Set(skillDirs);
  /** 이 파일이 속한 가장 가까운 스킬 폴더 (중첩된 스킬은 각자의 것으로) */
  const ownerOf = (path: string): string | undefined => {
    for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
      if (skillSet.has(dir)) return dir;
      if (dir === "." || dir === "/" || dir === "") return undefined;
    }
  };
  const skills = skillDirs
    .map((dir) => {
      const files: GithubFile[] = blobs
        .filter((e) => ownerOf(e.path) === dir)
        .map((e) => ({ path: dir === "." ? e.path : e.path.slice(dir.length + 1), sha: e.sha, size: e.size ?? 0 }));
      return {
        name: dir === "." ? ref.repo.toLowerCase() : posix.basename(dir),
        dir,
        files,
        size: files.reduce((sum, f) => sum + f.size, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const prompts = blobs
    .filter((e) => /(^|\/)prompts\/[^/]+\.md$/i.test(e.path) && ownerOf(e.path) === undefined)
    .map((e) => ({ name: posix.basename(e.path, ".md"), path: e.path, sha: e.sha, size: e.size ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...ref, skills, prompts, truncated };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "pi-desktop" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error("GitHub API 호출 한도(인증 없이 시간당 60회)를 넘었습니다. 잠시 뒤 다시 시도하세요.");
  }
  if (response.status === 404) throw new Error("저장소나 브랜치를 찾지 못했습니다 (공개 저장소만 읽습니다).");
  if (!response.ok) throw new Error(`GitHub 응답 ${response.status}: ${url}`);
  return (await response.json()) as T;
}

export async function browseRepo(spec: string): Promise<GithubCatalog> {
  const ref = parseRepoSpec(spec);
  const base = `${API}/repos/${ref.owner}/${ref.repo}`;
  const commit = await getJson<{ sha: string }>(`${base}/commits/${encodeURIComponent(ref.ref ?? "HEAD")}`);
  const tree = await getJson<{ tree: TreeEntry[]; truncated: boolean }>(`${base}/git/trees/${commit.sha}?recursive=1`);
  return catalogFromTree({ ...ref, sha: commit.sha }, tree.tree, tree.truncated);
}

function rawUrl(ref: GithubRepoRef & { sha: string }, path: string): string {
  return `${RAW}/${ref.owner}/${ref.repo}/${ref.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** 커밋에 고정한 파일 하나 (미리보기용 텍스트) */
export async function fetchText(ref: GithubRepoRef & { sha: string }, path: string): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(ref.sha)) throw new Error("커밋 SHA가 올바르지 않습니다");
  const response = await fetch(rawUrl(ref, path), { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`파일을 받지 못했습니다 (${response.status}): ${path}`);
  return response.text();
}

/** 가져올 파일들을 받는다 (base64). 개수·크기 한도를 넘으면 받지 않는다 */
export async function downloadFiles(
  ref: GithubRepoRef & { sha: string },
  base: string,
  files: GithubFile[],
): Promise<Array<{ path: string; contentBase64: string }>> {
  if (files.length > MAX_IMPORT_FILES) throw new Error(`파일이 너무 많습니다 (${files.length}개, 최대 ${MAX_IMPORT_FILES}개)`);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_IMPORT_BYTES) throw new Error(`너무 큽니다 (${total} 바이트, 최대 ${MAX_IMPORT_BYTES} 바이트)`);
  const out: Array<{ path: string; contentBase64: string }> = [];
  for (const file of files) {
    const full = base === "." || base === "" ? file.path : `${base}/${file.path}`;
    const response = await fetch(rawUrl(ref, full), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`파일을 받지 못했습니다 (${response.status}): ${full}`);
    out.push({ path: file.path, contentBase64: Buffer.from(await response.arrayBuffer()).toString("base64") });
  }
  return out;
}
