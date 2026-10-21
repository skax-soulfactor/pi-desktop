import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { ResourceFile, ResourceKind, ResourceWriteResult } from "@pi-desktop/host-protocol";

/**
 * 리소스 파일 읽기·쓰기·만들기 (설계 §4.2~4.5, §5.7 ConfigService).
 *
 * 앱이 아무 파일이나 쓰지 못하도록, Pi가 리소스로 읽는 마크다운 파일만 다룬다.
 * - 데이터 폴더(~/.pi/agent) 안의 .md (프롬프트·스킬·AGENTS.md·SYSTEM.md 등). auth.json 같은 설정은 .md가 아니라 막힌다
 * - 작업 폴더나 그 상위 폴더의 .pi/ 안의 .md
 * - 작업 폴더나 그 상위 폴더에 바로 있는 AGENTS.md·CLAUDE.md
 * 쓰기는 임시 파일에 쓴 뒤 바꿔치기하고, 덮어쓰기 전 내용을 .bak 하나로 남긴다.
 * 앱이 연 뒤에 파일이 바뀌었으면(수정 시각 비교) 덮어쓰지 않는다.
 */

/** 한 번에 읽고 쓰는 최대 크기 */
export const MAX_RESOURCE_BYTES = 512 * 1024;

const CONTEXT_FILE_NAMES = new Set(["agents.md", "claude.md"]);

function inside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}

/** 작업 폴더와 그 상위 폴더들 (작업 폴더부터 루트까지) */
function ancestors(cwd: string): string[] {
  const list: string[] = [];
  let dir = resolve(cwd);
  for (;;) {
    list.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return list;
    dir = parent;
  }
}

/** 이 경로를 리소스 파일로 다뤄도 되는지. 안 되면 이유 */
export function resourcePathProblem(path: string, cwd: string, agentDir: string): string | undefined {
  const target = resolve(path);
  if (extname(target).toLowerCase() !== ".md") return "마크다운(.md) 리소스 파일만 다룰 수 있습니다";
  if (inside(target, agentDir)) return undefined;
  for (const dir of ancestors(cwd)) {
    if (inside(target, join(dir, ".pi"))) return undefined;
    if (dirname(target) === dir && CONTEXT_FILE_NAMES.has(basename(target).toLowerCase())) return undefined;
  }
  return "데이터 폴더, 작업 폴더(또는 상위 폴더)의 .pi/, AGENTS.md 밖의 파일은 다룰 수 없습니다";
}

function requireResourcePath(path: string, cwd: string, agentDir: string): string {
  const problem = resourcePathProblem(path, cwd, agentDir);
  if (problem) throw new Error(`${problem}: ${path}`);
  return resolve(path);
}

export async function readResourceFile(path: string, cwd: string, agentDir: string): Promise<ResourceFile> {
  const target = requireResourcePath(path, cwd, agentDir);
  const info = await stat(target).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`파일이 없습니다: ${target}`);
  if (info.size > MAX_RESOURCE_BYTES) throw new Error(`파일이 너무 큽니다 (${info.size} 바이트): ${target}`);
  return { path: target, content: await readFile(target, "utf8"), mtimeMs: info.mtimeMs };
}

/**
 * @param baseMtime 앱이 읽었을 때의 수정 시각. 그 뒤에 바뀌었으면 거부한다. 없으면 새 파일이어야 한다
 */
export async function writeResourceFile(
  path: string,
  content: string,
  baseMtime: number | undefined,
  cwd: string,
  agentDir: string,
): Promise<ResourceWriteResult> {
  const target = requireResourcePath(path, cwd, agentDir);
  if (Buffer.byteLength(content, "utf8") > MAX_RESOURCE_BYTES) throw new Error("내용이 너무 큽니다");
  const info = await stat(target).catch(() => undefined);
  if (baseMtime === undefined && info) throw new Error(`이미 있는 파일입니다: ${target}`);
  if (baseMtime !== undefined) {
    if (!info) throw new Error(`파일이 사라졌습니다: ${target}`);
    // 파일 시스템마다 시각 정밀도가 달라 1ms 안쪽 차이는 같은 것으로 본다.
    if (Math.abs(info.mtimeMs - baseMtime) > 1) {
      throw new Error("연 뒤에 다른 곳에서 파일이 바뀌었습니다. 다시 열어 바뀐 내용을 확인한 뒤 저장하세요");
    }
    await copyFile(target, `${target}.bak`);
  }
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.pi-desktop-${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, target);
  return { path: target, mtimeMs: (await stat(target)).mtimeMs };
}

/** 스킬·프롬프트 이름 규칙 (Pi의 Agent Skills 규칙과 같다: 소문자·숫자·하이픈, 64자 이하) */
export function resourceNameProblem(name: string): string | undefined {
  if (!name) return "이름을 입력하세요";
  if (name.length > 64) return "이름은 64자 이하여야 합니다";
  if (!/^[a-z0-9-]+$/.test(name)) return "이름은 영문 소문자·숫자·하이픈(-)만 쓸 수 있습니다";
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) return "하이픈은 앞뒤나 연달아 쓸 수 없습니다";
  return undefined;
}

/** 새 리소스의 경로와 처음 내용 */
export function newResource(
  kind: ResourceKind,
  scope: "user" | "project",
  name: string,
  cwd: string,
  agentDir: string,
): { path: string; content: string } {
  const base = scope === "user" ? agentDir : join(cwd, ".pi");
  switch (kind) {
    case "prompt":
      return {
        path: join(base, "prompts", `${name}.md`),
        content: `---\ndescription: ${name} 프롬프트\nargument-hint: <인자>\n---\n$1에 대해 ...\n`,
      };
    case "skill":
      return {
        path: join(base, "skills", name, "SKILL.md"),
        content: `---\nname: ${name}\ndescription: 이 스킬이 무엇을 하고 언제 쓰는지 적으세요\n---\n\n# ${name}\n\n여기에 지침을 적으세요.\n`,
      };
    case "agents":
      return {
        path: scope === "user" ? join(agentDir, "AGENTS.md") : join(cwd, "AGENTS.md"),
        content: "# 지침\n\n여기에 Pi가 항상 따를 규칙을 적으세요.\n",
      };
  }
}

/** 새 리소스를 만들고 그 파일을 돌려준다. 이미 있으면 거부한다 */
export async function createResourceFile(
  kind: ResourceKind,
  scope: "user" | "project",
  name: string,
  cwd: string,
  agentDir: string,
): Promise<ResourceFile> {
  if (kind !== "agents") {
    const problem = resourceNameProblem(name);
    if (problem) throw new Error(problem);
  }
  const { path, content } = newResource(kind, scope, name, cwd, agentDir);
  const written = await writeResourceFile(path, content, undefined, cwd, agentDir);
  return { path: written.path, content, mtimeMs: written.mtimeMs };
}
