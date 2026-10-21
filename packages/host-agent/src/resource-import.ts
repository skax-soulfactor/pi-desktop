import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { ResourceImportParams, ResourceImportResult } from "@pi-desktop/host-protocol";
import { backupLocation, movePath } from "./import-manage";
import { resourceNameProblem } from "./resource-files";

/**
 * 개별 스킬·프롬프트 가져오기 (설계 §4.6 "개별 스킬·프롬프트 가져오기"), 다른 호스트에서 복사한 확장 쓰기 (§5.9).
 *
 * 앱이 GitHub 등에서 받은 파일들을 사용자(데이터 폴더) 또는 프로젝트(.pi/) 범위에 쓴다.
 * - 스킬: <범위>/skills/<이름>/ 아래에 폴더째. 프롬프트: <범위>/prompts/<이름>.md 하나
 * - 확장: <범위>/extensions/<이름>.ts 같은 파일 하나, 또는 <범위>/extensions/<이름>/ 폴더째
 * - 이미 있으면 덮어쓰지 않는다 (이름을 바꿔 가져오게 한다). replace면 이전 것을 백업 폴더로 옮긴 뒤 바꾼다 (업데이트)
 * - 파일 경로는 스킬 폴더 안으로만: 절대 경로·..·드라이브 문자는 거부한다
 * - 임시 폴더에 다 쓴 뒤 이름을 바꿔, 중간에 실패해도 반쯤 쓴 스킬이 남지 않게 한다
 */

export const MAX_IMPORT_FILES = 200;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** 스킬 폴더 기준 상대 경로가 안전한지. 안전하면 정규화한 조각들, 아니면 undefined */
export function safeRelativeParts(path: string): string[] | undefined {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return undefined;
  const parts = path.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || p.includes("\0"))) return undefined;
  return parts;
}

export async function importResource(
  params: ResourceImportParams,
  cwd: string,
  agentDir: string,
  backupDir?: string,
): Promise<ResourceImportResult> {
  const replace = params.replace === true && backupDir !== undefined;
  const problem = resourceNameProblem(params.name);
  if (problem) throw new Error(problem);
  if (params.files.length === 0) throw new Error("가져올 파일이 없습니다");
  if (params.files.length > MAX_IMPORT_FILES) throw new Error(`파일이 너무 많습니다 (최대 ${MAX_IMPORT_FILES}개)`);
  const decoded = params.files.map((f) => {
    const parts = safeRelativeParts(f.path);
    if (!parts) throw new Error(`안전하지 않은 파일 경로입니다: ${f.path}`);
    return { parts, data: Buffer.from(f.contentBase64, "base64") };
  });
  const total = decoded.reduce((sum, f) => sum + f.data.length, 0);
  if (total > MAX_IMPORT_BYTES) throw new Error(`너무 큽니다 (최대 ${MAX_IMPORT_BYTES} 바이트)`);

  const base = params.scope === "user" ? agentDir : join(cwd, ".pi");
  if (params.kind === "prompt") {
    if (decoded.length !== 1) throw new Error("프롬프트는 파일 하나여야 합니다");
    return writeSingle(join(base, "prompts", `${params.name}.md`), decoded[0]!.data, "프롬프트", replace, backupDir);
  }
  if (params.kind === "extension") return importExtension(join(base, "extensions"), params.name, decoded, replace, backupDir);

  if (!decoded.some((f) => f.parts.length === 1 && f.parts[0]!.toLowerCase() === "skill.md")) {
    throw new Error("스킬 폴더 맨 위에 SKILL.md가 있어야 합니다");
  }
  return writeFolder(join(base, "skills", params.name), decoded, "스킬", replace, backupDir);
}

type Decoded = { parts: string[]; data: Buffer };

/**
 * 확장: 파일 하나(.ts·.js)는 extensions/<이름><확장자>로, index.ts·index.js가 있는 폴더는 extensions/<이름>/으로.
 * Pi는 같은 이름의 파일과 폴더를 둘 다 불러오므로, 다른 모양으로 이미 있으면 replace여도 거부한다.
 */
async function importExtension(
  dir: string,
  name: string,
  decoded: Decoded[],
  replace: boolean,
  backupDir: string | undefined,
): Promise<ResourceImportResult> {
  const single = decoded.length === 1 && decoded[0]!.parts.length === 1 && !EXTENSION_ENTRY.test(decoded[0]!.parts[0]!);
  if (single) {
    const ext = extname(decoded[0]!.parts[0]!).toLowerCase();
    if (!EXTENSION_FILE.test(ext)) throw new Error(`확장 파일이 아닙니다: ${decoded[0]!.parts[0]}`);
    const target = join(dir, `${name}${ext}`);
    const other = extensionShapes(dir, name).find((p) => p !== target && existsSync(p));
    if (other) throw new Error(`이미 있는 확장입니다 (다른 모양): ${other}`);
    return writeSingle(target, decoded[0]!.data, "확장", replace, backupDir);
  }
  if (!decoded.some((f) => f.parts.length === 1 && EXTENSION_ENTRY.test(f.parts[0]!))) {
    throw new Error("확장 폴더 맨 위에 index.ts 또는 index.js가 있어야 합니다");
  }
  const target = join(dir, name);
  const other = extensionShapes(dir, name).find((p) => p !== target && existsSync(p));
  if (other) throw new Error(`이미 있는 확장입니다 (다른 모양): ${other}`);
  return writeFolder(target, decoded, "확장", replace, backupDir);
}

const EXTENSION_FILE = /.(ts|js|mts|cts|mjs|cjs)$/i;
const EXTENSION_ENTRY = /^index.(ts|js)$/i;

/** 같은 이름으로 Pi가 불러올 수 있는 확장 위치들 */
function extensionShapes(dir: string, name: string): string[] {
  return [join(dir, name), ...["ts", "js", "mts", "cts", "mjs", "cjs"].map((ext) => join(dir, `${name}.${ext}`))];
}

/** 파일 하나를 쓴다. 이미 있으면 replace일 때만 이전 것을 백업으로 옮기고 바꾼다 */
async function writeSingle(
  target: string,
  data: Buffer,
  label: string,
  replace: boolean,
  backupDir: string | undefined,
): Promise<ResourceImportResult> {
  let backup: string | undefined;
  if (existsSync(target)) {
    if (!replace) throw new Error(`이미 있는 ${label}입니다: ${target}`);
    await mkdir(backupDir!, { recursive: true });
    backup = backupLocation(target, backupDir!);
    await movePath(target, backup);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  return { target, files: 1, ...(backup ? { backup } : {}) };
}

/** 폴더째 쓴다. 임시 폴더에 다 쓴 뒤 이름을 바꾸고, 이미 있으면 replace일 때만 이전 것을 백업으로 옮긴다 */
async function writeFolder(
  target: string,
  decoded: Decoded[],
  label: string,
  replace: boolean,
  backupDir: string | undefined,
): Promise<ResourceImportResult> {
  if (existsSync(target) && !replace) throw new Error(`이미 있는 ${label}입니다: ${target}`);
  let backup: string | undefined;
  const staging = `${target}.pi-desktop-import-${process.pid}`;
  try {
    for (const file of decoded) {
      const path = join(staging, ...file.parts);
      // join이 정규화한 뒤에도 임시 폴더 안인지 한 번 더 확인한다.
      if (!resolve(path).startsWith(resolve(staging) + sep)) throw new Error(`안전하지 않은 파일 경로입니다: ${file.parts.join("/")}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.data);
    }
    if (existsSync(target)) {
      // 새 내용을 다 쓴 뒤에 이전 것을 백업으로 옮기고 바꾼다.
      await mkdir(backupDir!, { recursive: true });
      backup = backupLocation(target, backupDir!);
      await movePath(target, backup);
    }
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    // 바꾸는 도중 실패했으면 이전 것을 되돌린다.
    if (backup && !existsSync(target)) await movePath(backup, target).catch(() => {});
    throw error;
  }
  return { target, files: decoded.length, ...(backup ? { backup } : {}) };
}
