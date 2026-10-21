import { createHash } from "node:crypto";
import { Methods, type PiStatus, type ResourceExportResult, type ResourceItem, type ResourcesView } from "@pi-desktop/host-protocol";
import type { CopyKind, HostInventory, InventoryItem } from "../shared/api";
import { exportKindOf, fileShas } from "./copies";

type Request = <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;

/**
 * 호스트 비교에 쓸 사용자 범위 리소스 목록 (설계 §5.9 "호스트 비교 화면").
 *
 * 데이터 폴더를 작업 폴더로 리소스 목록을 읽어, 사용자 범위이고 패키지에 들지 않은 스킬·프롬프트·확장과
 * 데이터 폴더의 AGENTS.md·SYSTEM.md·APPEND_SYSTEM.md만 담는다. 프로젝트 범위는 호스트마다 폴더가 달라 견주지 않는다.
 * 내용은 복사할 때와 같은 resources.export로 읽어 해시만 남긴다.
 */
export async function collectInventory(hostId: string, request: Request): Promise<HostInventory> {
  const status = await request<PiStatus>(Methods.piStatus);
  const agentDir = status.data.agentDir;
  const view = await request<ResourcesView>(Methods.resourcesList, { cwd: agentDir }, 120_000);
  const own = (r: ResourceItem) => r.scope === "user" && !r.fromPackage && !r.path.startsWith("builtin:");
  const entries: Array<{ kind: CopyKind; name: string; path: string }> = [
    ...view.contextFiles.filter((f) => f.scope === "user").map((f) => ({ kind: "context" as const, name: baseName(f.path), path: f.path })),
    ...[view.systemPrompt, ...view.appendSystemPrompt]
      .filter((p): p is string => typeof p === "string" && isInside(p, view.agentDir))
      .map((p) => ({ kind: "context" as const, name: baseName(p), path: p })),
    ...view.skills.filter(own).map((r) => ({ kind: "skill" as const, name: r.name, path: r.path })),
    ...view.prompts.filter(own).map((r) => ({ kind: "prompt" as const, name: r.name, path: r.path })),
    ...view.extensions.filter(own).map((r) => ({ kind: "extension" as const, name: r.name, path: r.path })),
  ];
  const items = await Promise.all(
    entries.map(async (entry): Promise<InventoryItem> => {
      try {
        const result = await request<ResourceExportResult>(Methods.resourcesExport, { kind: exportKindOf(entry.kind), path: entry.path }, 60_000);
        return { ...entry, digest: digestOf(fileShas(result.files)), files: result.files.length };
      } catch (e) {
        return { ...entry, files: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return { hostId, agentDir, platform: status.platform, items };
}

/** 파일 하나면 그 SHA(이름이 달라도 같게 본다), 여럿이면 정렬한 "경로 SHA" 줄들의 SHA-1 */
export function digestOf(shas: Record<string, string>): string {
  const entries = Object.entries(shas);
  if (entries.length === 1) return entries[0]![1];
  const lines = entries.map(([path, sha]) => `${path} ${sha}`).sort();
  return createHash("sha1").update(lines.join("\n")).digest("hex");
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 호스트 경로 형식(/, \)과 상관없이 dir 안인지 */
function isInside(path: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(path).startsWith(`${norm(dir)}/`);
}
