import { dirname, relative } from "node:path";
import type { PackageFilterChange, PackageResourceItem, PackageResourceType } from "@pi-desktop/host-protocol";

/**
 * 패키지 리소스 고르기 (설계 §4.5 "패키지 필터 편집").
 *
 * settings.json의 패키지 항목을 객체 형태로 바꿔 리소스 종류별 배열에 `+경로`(켬)·`-경로`(끔)를 적는다.
 * Pi의 `pi config`가 하는 것과 같은 규칙을 따른다:
 * - 경로는 패키지 리소스 기준 폴더(baseDir)에서의 상대 경로
 * - 같은 경로를 가리키던 이전 항목(+, -, !, 그대로)은 지우고 새로 붙인다
 * - 필터가 하나도 없으면 문자열 소스로 되돌린다. 빈 배열([])은 "그 종류는 하나도 불러오지 않음"이라 지우지 않는다
 * - set은 종류별 배열을 통째로 적는다 (설치할 때 종류를 빼거나, 다른 호스트의 필터를 옮길 때)
 * - overlay는 사용자 패키지를 이 프로젝트에서만 고르는 덧씌우기다. 프로젝트 settings에 { source, autoload: false }
 *   항목을 두면 Pi는 그것을 사용자 패키지 위의 필터로 본다(+는 켬, -는 끔, 없으면 사용자 설정을 따름).
 *   덧씌울 것이 없어지면 그 항목을 지운다.
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
  set: Partial<Record<PackageResourceType, string[]>> = {},
  overlay = false,
): PackageSource[] {
  const next = [...packages];
  let index = next.findIndex((p) => (typeof p === "string" ? p : p.source) === source);
  if (index === -1) {
    if (!overlay) throw new Error(`설정에 없는 패키지입니다: ${source}`);
    next.push({ source, autoload: false });
    index = next.length - 1;
  }
  const current = next[index]!;
  const pkg: Exclude<PackageSource, string> = typeof current === "string" ? { source: current } : { ...current };
  if (reset) for (const type of RESOURCE_TYPES) delete pkg[type];
  for (const type of RESOURCE_TYPES) if (Array.isArray(set[type])) pkg[type] = [...set[type]!];
  for (const change of changes) {
    const kept = (pkg[change.type] ?? []).filter((entry) => stripPrefix(entry) !== change.pattern);
    kept.push(`${change.enabled ? "+" : "-"}${change.pattern}`);
    pkg[change.type] = kept;
  }
  const hasFilters = RESOURCE_TYPES.some((type) => pkg[type] !== undefined);
  // 필터가 없으면 문자열로 되돌린다. autoload 같은 다른 키가 있으면 객체로 둔다.
  const otherKeys = Object.keys(pkg).filter((k) => k !== "source" && !RESOURCE_TYPES.includes(k as PackageResourceType));
  if (overlay && pkg.autoload === false && !hasFilters) {
    // 덧씌울 것이 없으면 항목을 지워 사용자 설정을 그대로 따르게 한다.
    next.splice(index, 1);
    return next;
  }
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
  /** 사용자 패키지를 이 프로젝트 덧씌우기까지 반영해 본다 (켜짐 여부가 프로젝트 기준) */
  overlay = false,
): Promise<PackageResourceItem[]> {
  const settingsManager = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: scope === "project" || overlay });
  const resolved = await new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(async () => "skip");
  const items: PackageResourceItem[] = [];
  for (const type of RESOURCE_TYPES) {
    for (const r of resolved[type] ?? []) {
      // 덧씌우기가 있으면 Pi는 그 패키지를 project 범위로 보고하므로 범위는 따지지 않는다.
      if (r.metadata.origin !== "package" || r.metadata.source !== source || (!overlay && r.metadata.scope !== scope)) continue;
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
  params: {
    source: string;
    scope: "user" | "project";
    changes: PackageFilterChange[];
    reset?: boolean;
    set?: Partial<Record<PackageResourceType, string[]>>;
    /** 사용자 패키지를 이 프로젝트에서만 고른다 (프로젝트 settings의 autoload: false 항목) */
    overlay?: boolean;
  },
): Promise<void> {
  const project = params.scope === "project" || params.overlay === true;
  const settings = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: project });
  const current = project ? settings.getProjectSettings() : settings.getGlobalSettings();
  const next = applyPackageFilter(current.packages ?? [], params.source, params.changes, params.reset === true, params.set, params.overlay === true);
  if (project) settings.setProjectPackages(next);
  else settings.setPackages(next);
  await settings.flush();
  const [error] = settings.drainErrors();
  if (error) throw new Error(`설정을 저장하지 못했습니다: ${error.error.message}`);
}
