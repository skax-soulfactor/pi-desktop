import { dirname, relative } from "node:path";
import type { PackageFilterChange, PackageResourceItem, PackageResourceType } from "@pi-desktop/host-protocol";

/**
 * 패키지 리소스 고르기 (설계 §4.5 "패키지 필터 편집").
 *
 * settings.json의 패키지 항목을 객체 형태로 바꿔 리소스 종류별 배열에 `+경로`(켬)·`-경로`(끔)를 적는다.
 * Pi의 `pi config`가 하는 것과 같은 규칙을 따른다:
 * - 경로는 패키지 리소스 기준 폴더(baseDir)에서의 상대 경로
 * - 같은 경로를 가리키던 이전 항목(+, -, !, 그대로)은 지우고 새로 붙인다
 * - 종류 배열이 비면 그 키를 지우고, 필터가 하나도 없으면 문자열 소스로 되돌린다
 * 쓰기는 Pi의 SettingsManager로 한다 (Pi와 같은 잠금·병합).
 */

const RESOURCE_TYPES: PackageResourceType[] = ["extensions", "skills", "prompts", "themes"];

type PackageSource = string | ({ source: string } & Partial<Record<PackageResourceType, string[]>> & Record<string, unknown>);

interface PiResolved {
  path: string;
  enabled: boolean;
  metadata: { source: string; scope: string; origin: string; baseDir?: string };
}

interface FilterSettingsManager {
  getGlobalSettings(): { packages?: PackageSource[] };
  getProjectSettings(): { packages?: PackageSource[] };
  setPackages(packages: PackageSource[]): void;
  setProjectPackages(packages: PackageSource[]): void;
  flush(): Promise<void>;
  drainErrors(): Array<{ error: Error }>;
}

/** 이 파일이 쓰는 Pi SDK의 일부 */
export interface PackageFilterSdk {
  SettingsManager: { create(cwd: string, agentDir?: string, options?: { projectTrusted?: boolean }): FilterSettingsManager };
  DefaultPackageManager: new (options: { cwd: string; agentDir: string; settingsManager: unknown }) => {
    resolve(onMissing?: (source: string) => Promise<"install" | "skip" | "error">): Promise<Record<PackageResourceType, PiResolved[]>>;
  };
}

function stripPrefix(entry: string): string {
  return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
}

/** 패키지 목록에 켜고 끈 것을 적용한 새 목록. 그 소스가 없으면 오류 */
export function applyPackageFilter(
  packages: readonly PackageSource[],
  source: string,
  changes: readonly PackageFilterChange[],
  reset = false,
): PackageSource[] {
  const next = [...packages];
  const index = next.findIndex((p) => (typeof p === "string" ? p : p.source) === source);
  if (index === -1) throw new Error(`설정에 없는 패키지입니다: ${source}`);
  const current = next[index]!;
  const pkg: Exclude<PackageSource, string> = typeof current === "string" ? { source: current } : { ...current };
  if (reset) for (const type of RESOURCE_TYPES) delete pkg[type];
  for (const change of changes) {
    const kept = (pkg[change.type] ?? []).filter((entry) => stripPrefix(entry) !== change.pattern);
    kept.push(`${change.enabled ? "+" : "-"}${change.pattern}`);
    pkg[change.type] = kept;
  }
  for (const type of RESOURCE_TYPES) if (pkg[type] !== undefined && pkg[type]!.length === 0) delete pkg[type];
  const hasFilters = RESOURCE_TYPES.some((type) => pkg[type] !== undefined);
  // 필터가 없으면 문자열로 되돌린다. autoload 같은 다른 키가 있으면 객체로 둔다.
  const otherKeys = Object.keys(pkg).filter((k) => k !== "source" && !RESOURCE_TYPES.includes(k as PackageResourceType));
  next[index] = hasFilters || otherKeys.length > 0 ? pkg : pkg.source;
  return next;
}

/** 그 패키지(같은 범위에 적힌 소스)가 내놓는 리소스와 켜짐 여부 */
export async function listPackageResources(
  sdk: PackageFilterSdk,
  cwd: string,
  agentDir: string,
  source: string,
  scope: "user" | "project",
): Promise<PackageResourceItem[]> {
  const settingsManager = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: scope === "project" });
  const resolved = await new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(async () => "skip");
  const items: PackageResourceItem[] = [];
  for (const type of RESOURCE_TYPES) {
    for (const r of resolved[type] ?? []) {
      if (r.metadata.origin !== "package" || r.metadata.source !== source || r.metadata.scope !== scope) continue;
      items.push({ type, path: r.path, pattern: relative(r.metadata.baseDir ?? dirname(r.path), r.path), enabled: r.enabled });
    }
  }
  return items;
}

/** 켜고 끈 것을 그 범위의 settings.json에 적는다 */
export async function setPackageFilter(
  sdk: PackageFilterSdk,
  cwd: string,
  agentDir: string,
  params: { source: string; scope: "user" | "project"; changes: PackageFilterChange[]; reset?: boolean },
): Promise<void> {
  const settings = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: params.scope === "project" });
  const current = params.scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
  const next = applyPackageFilter(current.packages ?? [], params.source, params.changes, params.reset === true);
  if (params.scope === "project") settings.setProjectPackages(next);
  else settings.setPackages(next);
  await settings.flush();
  const [error] = settings.drainErrors();
  if (error) throw new Error(`설정을 저장하지 못했습니다: ${error.error.message}`);
}
