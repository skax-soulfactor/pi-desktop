import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { ResourceExportResult } from "@pi-desktop/host-protocol";
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from "./resource-import";

/**
 * 다른 호스트로 복사할 리소스 내보내기 (설계 §5.9). 대상 호스트는 resources.import로 쓴다.
 *
 * - 스킬: SKILL.md가 있는 폴더 전체. 파일 하나로 된 스킬(skills/<이름>.md)은 SKILL.md로 담는다
 * - 프롬프트: .md 파일 하나
 * 리소스 목록(resources.list)이 알려 준 경로를 받으므로 그 모양만 확인한다. 개수·크기 한도는 가져오기와 같다.
 */

async function listFiles(dir: string, out: string[] = [], base = dir): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length > MAX_IMPORT_FILES) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(path, out, base);
    else if (entry.isFile()) out.push(relative(base, path).split(sep).join("/"));
  }
  return out;
}

export async function exportResource(kind: "skill" | "prompt", path: string): Promise<ResourceExportResult> {
  if (extname(path).toLowerCase() !== ".md") throw new Error(`마크다운 리소스 파일이 아닙니다: ${path}`);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`파일이 없습니다: ${path}`);

  const single = async (name: string): Promise<ResourceExportResult> => {
    if (info.size > MAX_IMPORT_BYTES) throw new Error(`너무 큽니다: ${path}`);
    return { files: [{ path: name, size: info.size, contentBase64: (await readFile(path)).toString("base64") }] };
  };
  if (kind === "prompt") return single(basename(path));
  if (basename(path).toLowerCase() !== "skill.md") return single("SKILL.md");

  const dir = dirname(path);
  const rels = await listFiles(dir);
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
