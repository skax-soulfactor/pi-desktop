/**
 * Marketplace 화면의 순수 함수들 (설계 §4.6).
 * 설치·제거·업데이트는 그 호스트의 pi 명령을 내장 터미널에서 눈앞에 실행한다 (Pi 설치와 같은 방식).
 */

export type PackageScope = "user" | "project";

/** npm 이름 (scope 포함). 앞쪽 하이픈은 막는다 */
const NPM_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * pi install 인자. version이 없으면 최신을 따라가고(pi update로 갱신), 있으면 그 버전에 고정된다.
 * project면 -l로 프로젝트 설정(.pi/settings.json)에 적는다.
 */
export function installArgs(name: string, version: string | undefined, scope: PackageScope): string[] {
  if (!NPM_NAME.test(name)) throw new Error(`npm 패키지 이름이 아닙니다: ${name}`);
  if (version !== undefined && !VERSION.test(version)) throw new Error(`버전 형식이 아닙니다: ${version}`);
  return ["install", `npm:${name}${version ? `@${version}` : ""}`, ...(scope === "project" ? ["-l"] : [])];
}

/**
 * pi remove·update에 넘길 패키지 소스.
 * 로컬 경로로 설치한 패키지는 설정 파일 기준 상대 경로(예: ..\..\pi-packages\x)로 저장되는데,
 * pi는 명령으로 받은 상대 경로를 지금 폴더 기준으로 풀어 "No matching package found"가 된다.
 * 그래서 로컬 경로 소스는 설치된 절대 경로를 넘긴다. npm·git·URL 소스는 그대로 둔다.
 */
export function commandSource(pkg: { source: string; installedPath?: string }): string {
  const remote = /^(npm:|git:|git\+|https?:|ssh:|git@)/i.test(pkg.source);
  return !remote && pkg.installedPath ? pkg.installedPath : pkg.source;
}

/** 설치된 패키지 소스 (commandSource로 고른 것) 제거·업데이트 인자 */
export function removeArgs(source: string, scope: PackageScope): string[] {
  return ["remove", source, ...(scope === "project" ? ["-l"] : [])];
}

export function updateArgs(source: string): string[] {
  return ["update", source];
}

/** 설정의 npm 소스에서 패키지 이름: npm:@x/y@1.2.3 → @x/y, npm:foo → foo. npm이 아니면 undefined */
export function npmNameOfSource(source: string): string | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice(4);
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at > 0 ? spec.slice(0, at) : spec;
}

/** 버전이 고정된 npm 소스인지 (pi update로 바뀌지 않는다) */
export function isPinned(source: string): boolean {
  const name = npmNameOfSource(source);
  return name !== undefined && source.length > `npm:${name}`.length;
}

/** 다운로드 수를 짧게: 1565803 → 1.6M, 12345 → 12K */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const KIND_LABELS: Record<string, string> = { extensions: "확장", skills: "스킬", prompts: "프롬프트", themes: "테마" };

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** 가져올 때 쓸 기본 이름: Pi 이름 규칙(소문자·숫자·하이픈, 64자)에 맞게 다듬는다 */
export function importName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|bat|cmd|rb|pl)$/i;

/** 스킬에 든 실행 스크립트. 스킬은 모델이 이것들을 실행하도록 지시할 수 있어 가져오기 전에 알린다 */
export function scriptFiles(files: ReadonlyArray<{ path: string }>): string[] {
  return files.map((f) => f.path).filter((p) => SCRIPT_EXT.test(p));
}

/** 마크다운 앞머리(--- YAML ---)를 떼어 따로 보이게 한다. 없으면 meta는 undefined */
export function splitFrontmatter(text: string): { meta?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return match ? { meta: match[1]!, body: text.slice(match[0].length) } : { body: text };
}

export type PackageResourceKind = "extensions" | "skills" | "prompts" | "themes";
const RESOURCE_KINDS: PackageResourceKind[] = ["extensions", "skills", "prompts", "themes"];

/** 설치할 때 뺄 종류를 패키지 필터로: 그 종류는 []("하나도 불러오지 않음") */
export function excludeKindsFilter(kinds: readonly PackageResourceKind[]): Partial<Record<PackageResourceKind, string[]>> {
  return Object.fromEntries(kinds.map((k) => [k, [] as string[]]));
}

/** settings.json 값에서 그 소스의 패키지 필터(종류별 배열). 문자열 항목이거나 필터가 없으면 undefined */
export function packageFilterOf(settings: Record<string, unknown>, source: string): Partial<Record<PackageResourceKind, string[]>> | undefined {
  const packages = Array.isArray(settings.packages) ? (settings.packages as unknown[]) : [];
  const entry = packages.find((p) => typeof p === "object" && p !== null && (p as { source?: unknown }).source === source) as
    | Record<string, unknown>
    | undefined;
  if (!entry) return undefined;
  const filter: Partial<Record<PackageResourceKind, string[]>> = {};
  for (const kind of RESOURCE_KINDS) {
    const value = entry[kind];
    if (Array.isArray(value)) filter[kind] = value.filter((v): v is string => typeof v === "string");
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * 다른 호스트로 옮길 필터. Pi가 하나씩 켜고 끄며 적은 +경로·-경로는 그 호스트의 경로 구분자를 쓰므로
 * 대상 OS 구분자로 바꾼다(Windows는 \, 그 밖은 /). 손으로 쓴 glob 패턴은 그대로 둔다.
 */
export function filterForPlatform(
  filter: Partial<Record<PackageResourceKind, string[]>>,
  platform: string | undefined,
): Partial<Record<PackageResourceKind, string[]>> {
  const convert = (entry: string) => {
    if (!platform || !(entry.startsWith("+") || entry.startsWith("-"))) return entry;
    return platform === "win32" ? entry.replace(/\//g, "\\") : entry.replace(/\\/g, "/");
  };
  return Object.fromEntries(Object.entries(filter).map(([kind, entries]) => [kind, (entries ?? []).map(convert)]));
}
