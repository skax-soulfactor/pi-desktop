import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { ImportedInspectResult } from "@pi-desktop/host-protocol";
import { safeRelativeParts } from "./resource-import";

/**
 * 가져온 스킬·프롬프트 관리 (설계 §4.6: 업데이트 확인, 로컬 수정 감지, 깨끗한 제거).
 *
 * 앱의 imports.json에 적힌 위치만 다루되, 그 기록을 그대로 믿지 않고 위치 모양을 확인한다:
 * 데이터 폴더나 .pi/ 바로 아래의 skills/<이름>/ 폴더, 또는 prompts/<이름>.md 파일이어야 한다.
 * 로컬 수정 감지는 git과 같은 blob SHA로 비교한다 (가져올 때 GitHub 트리의 SHA를 기록해 둔다).
 * 제거와 교체는 바로 지우지 않고 앱 홈의 백업 폴더로 옮긴다.
 */

const MAX_FILES = 500;
const MAX_TEXT_BYTES = 512 * 1024;

/** git이 파일 내용에 매기는 SHA ("blob <크기>\0<내용>"의 SHA-1) */
export function gitBlobSha(data: Buffer): string {
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}

/** 가져온 항목 위치로 맞는지. 아니면 이유 */
export function importTargetProblem(target: string, kind: "skill" | "prompt", agentDir: string): string | undefined {
  const path = resolve(target);
  const parent = dirname(path);
  const root = dirname(parent);
  const inScope = resolve(root) === resolve(agentDir) || basename(root) === ".pi";
  if (kind === "skill" && basename(parent) === "skills" && inScope) return undefined;
  if (kind === "prompt" && basename(parent) === "prompts" && extname(path).toLowerCase() === ".md" && inScope) return undefined;
  return `가져온 ${kind === "skill" ? "스킬" : "프롬프트"} 위치가 아닙니다: ${target}`;
}

function requireTarget(target: string, kind: "skill" | "prompt", agentDir: string): string {
  const problem = importTargetProblem(target, kind, agentDir);
  if (problem) throw new Error(problem);
  return resolve(target);
}

async function listFiles(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(path, base, out);
    else if (entry.isFile()) out.push(relative(base, path).split(sep).join("/"));
  }
  return out;
}

export async function inspectImported(target: string, kind: "skill" | "prompt", agentDir: string): Promise<ImportedInspectResult> {
  const path = requireTarget(target, kind, agentDir);
  const info = await stat(path).catch(() => undefined);
  if (!info) return { exists: false, files: {} };
  if (kind === "prompt") return { exists: true, files: { [basename(path)]: gitBlobSha(await readFile(path)) } };
  const files: Record<string, string> = {};
  for (const rel of await listFiles(path)) files[rel] = gitBlobSha(await readFile(join(path, ...rel.split("/"))));
  return { exists: true, files };
}

/** 가져온 항목 안의 텍스트 파일 하나. 프롬프트는 path를 쓰지 않는다 */
export async function readImported(target: string, kind: "skill" | "prompt", path: string, agentDir: string): Promise<string> {
  const base = requireTarget(target, kind, agentDir);
  let file = base;
  if (kind === "skill") {
    const parts = safeRelativeParts(path);
    if (!parts) throw new Error(`안전하지 않은 파일 경로입니다: ${path}`);
    file = join(base, ...parts);
  }
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`파일이 없습니다: ${file}`);
  if (info.size > MAX_TEXT_BYTES) throw new Error(`파일이 너무 큽니다: ${file}`);
  return readFile(file, "utf8");
}

/** 백업 폴더 안의 새 위치: <이름>-<시각> */
export function backupLocation(target: string, backupDir: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return join(backupDir, `${basename(target)}-${stamp}`);
}

/** 가져온 항목을 백업 폴더로 옮긴다 (바로 지우지 않는다). 옮긴 곳을 돌려준다 */
export async function moveToBackup(target: string, kind: "skill" | "prompt", agentDir: string, backupDir: string): Promise<string> {
  const path = requireTarget(target, kind, agentDir);
  if (!(await stat(path).catch(() => undefined))) throw new Error(`이미 없습니다: ${path}`);
  await mkdir(backupDir, { recursive: true });
  const backup = backupLocation(path, backupDir);
  await movePath(path, backup);
  return backup;
}

/** 옮기기. 프로젝트가 다른 드라이브에 있으면 rename이 안 되므로 복사한 뒤 지운다 */
export async function movePath(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

/** 리소스 탭에서 지울 수 있는 종류 */
export type DeletableKind = "prompt" | "skill" | "extension";

const KIND_DIR: Record<DeletableKind, string> = { prompt: "prompts", skill: "skills", extension: "extensions" };

/**
 * 리소스 목록의 경로에서 실제로 지울 대상(파일 또는 폴더)을 정한다. 지울 수 없는 위치면 이유를 던진다.
 * - 프롬프트: prompts/ 바로 아래의 .md 파일
 * - 스킬: skills/<이름>/SKILL.md면 그 폴더, skills/ 바로 아래의 .md 파일이면 그 파일
 * - 확장: extensions/ 바로 아래의 파일·폴더, extensions/<이름>/index.ts면 그 폴더
 * 데이터 폴더(agentDir)나 프로젝트의 .pi 폴더 안이어야 한다. 패키지에 든 리소스는 Marketplace에서 제거한다.
 */
export function resourceDeleteTarget(path: string, kind: DeletableKind, agentDir: string): string {
  const file = resolve(path);
  const dirName = KIND_DIR[kind];
  const inScope = (kindDir: string) =>
    basename(kindDir) === dirName && (resolve(dirname(kindDir)) === resolve(agentDir) || basename(dirname(kindDir)) === ".pi");
  let target: string | undefined;
  if (kind === "prompt") {
    if (extname(file).toLowerCase() === ".md" && inScope(dirname(file))) target = file;
  } else if (kind === "skill") {
    if (basename(file) === "SKILL.md" && inScope(dirname(dirname(file)))) target = dirname(file);
    else if (extname(file).toLowerCase() === ".md" && inScope(dirname(file))) target = file;
  } else {
    if (inScope(dirname(file))) target = file;
    else if (inScope(dirname(dirname(file)))) target = dirname(file);
  }
  if (!target) throw new Error(`지울 수 있는 ${kind === "prompt" ? "프롬프트" : kind === "skill" ? "스킬" : "확장"} 위치가 아닙니다: ${path}`);
  return target;
}

/** 리소스를 지운다: 바로 지우지 않고 백업 폴더로 옮긴다. 옮긴 곳을 돌려준다 */
export async function deleteResource(path: string, kind: DeletableKind, agentDir: string, backupDir: string): Promise<string> {
  const target = resourceDeleteTarget(path, kind, agentDir);
  if (!(await stat(target).catch(() => undefined))) throw new Error(`이미 없습니다: ${target}`);
  await mkdir(backupDir, { recursive: true });
  const backup = backupLocation(target, backupDir);
  await movePath(target, backup);
  return backup;
}
