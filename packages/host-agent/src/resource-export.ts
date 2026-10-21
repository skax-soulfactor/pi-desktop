import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { ResourceExportResult } from "@pi-desktop/host-protocol";
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from "./resource-import";

/**
 * 다른 호스트로 복사할 리소스 내보내기 (설계 §5.9). 대상 호스트는 resources.import로 쓴다.
 *
 * - 스킬: SKILL.md가 있는 폴더 전체. 파일 하나로 된 스킬(skills/<이름>.md)은 SKILL.md로 담는다
 * - 프롬프트: .md 파일 하나
 * - 확장: .ts·.js 파일 하나, 또는 index.ts·index.js가 있는 폴더 전체. 폴더의 node_modules·.git은 옮기지 않는다
 *   (대상에서 npm install로 다시 받는다)
 * 리소스 목록(resources.list)이 알려 준 경로를 받으므로 그 모양만 확인한다. 개수·크기 한도는 가져오기와 같다.
 */

/** 확장 폴더에서 옮기지 않는 폴더 */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);
const EXTENSION_FILE = /.(ts|js|mts|cts|mjs|cjs)$/i;
const EXTENSION_ENTRY = /^index.(ts|js)$/i;

async function listFiles(dir: string, out: string[] = [], base = dir, skipped?: Set<string>): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length > MAX_IMPORT_FILES) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && skipped && SKIPPED_DIRS.has(entry.name)) skipped.add(relative(base, path).split(sep).join("/"));
    else if (entry.isDirectory()) await listFiles(path, out, base, skipped);
    else if (entry.isFile()) out.push(relative(base, path).split(sep).join("/"));
  }
  return out;
}

export async function exportResource(kind: "skill" | "prompt" | "extension", path: string): Promise<ResourceExportResult> {
  if (kind === "extension") return exportExtension(path);
  if (extname(path).toLowerCase() !== ".md") throw new Error(`마크다운 리소스 파일이 아닙니다: ${path}`);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`파일이 없습니다: ${path}`);

  const single = async (name: string): Promise<ResourceExportResult> => {
    if (info.size > MAX_IMPORT_BYTES) throw new Error(`너무 큽니다: ${path}`);
    return { files: [{ path: name, size: info.size, contentBase64: (await readFile(path)).toString("base64") }] };
  };
  if (kind === "prompt") return single(basename(path));
  if (basename(path).toLowerCase() !== "skill.md") return single("SKILL.md");

  return exportFolder(dirname(path));
}

async function exportExtension(path: string): Promise<ResourceExportResult> {
  if (!EXTENSION_FILE.test(path)) throw new Error(`확장 파일이 아닙니다: ${path}`);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`파일이 없습니다: ${path}`);
  if (!EXTENSION_ENTRY.test(basename(path))) {
    if (info.size > MAX_IMPORT_BYTES) throw new Error(`너무 큽니다: ${path}`);
    return { files: [{ path: basename(path), size: info.size, contentBase64: (await readFile(path)).toString("base64") }] };
  }
  const dir = dirname(path);
  const skipped = new Set<string>();
  const result = await exportFolder(dir, skipped);
  if (skipped.size > 0) result.skipped = [...skipped].sort();
  if (await hasDependencies(join(dir, "package.json"))) result.needsInstall = true;
  return result;
}

/** package.json에 dependencies가 있는지 (대상에서 npm install이 필요한지) */
async function hasDependencies(path: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path, "utf8")) as { dependencies?: Record<string, unknown> };
    return Boolean(pkg.dependencies && Object.keys(pkg.dependencies).length > 0);
  } catch {
    return false;
  }
}

async function exportFolder(dir: string, skipped?: Set<string>): Promise<ResourceExportResult> {
  const rels = await listFiles(dir, [], dir, skipped);
  if (rels.length > MAX_IMPORT_FILES) throw new Error(`파일이 너무 많습니다 (최대 ${MAX_IMPORT_FILES}개): ${dir}`);
  const files: ResourceExportResult["files"] = [];
  let total = 0;
  for (const rel of rels) {
    const data = await readFile(join(dir, ...rel.split("/")));
    total += data.length;
    if (total > MAX_IMPORT_BYTES) throw new Error(`너무 큽니다 (최대 ${MAX_IMPORT_BYTES} 바이트): ${dir}`);
    files.push({ path: rel, size: data.length, contentBase64: data.toString("base64") });
  }
  return { files };
}
