import type { MarketDetail, MarketPackage, MarketSearchResult } from "../shared/api";

/**
 * Marketplace의 npm 카탈로그 (설계 §4.6). 공개 npm 레지스트리만 읽으므로 이 PC(main 프로세스)에서 조회한다.
 * 설치·제거는 그 호스트의 `pi install/remove`가 하므로 여기서는 하지 않는다.
 *
 * - 검색: registry.npmjs.org/-/v1/search에서 `keywords:pi-package`로 거른다 (pi.dev 갤러리와 같은 기준).
 * - 상세: 패키지 문서 하나로 README·버전·매니페스트(pi 필드)·의존성·설치 스크립트를 얻는다.
 */

const REGISTRY = "https://registry.npmjs.org";
/** README가 너무 길면 자른다 */
const README_MAX = 200_000;
/** 상세 화면에 보일 최근 버전 수 */
const VERSIONS_MAX = 30;

/** npm 패키지 이름 (scope 포함). 명령에 넣기 전에 확인한다 */
export function isNpmName(name: string): boolean {
  // 앞쪽 하이픈은 막는다 (명령줄 옵션으로 읽히지 않게).
  return name.length <= 214 && /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/.test(name);
}

export function searchUrl(query: string, from: number, size: number): string {
  const text = `keywords:pi-package ${query}`.trim();
  return `${REGISTRY}/-/v1/search?text=${encodeURIComponent(text)}&from=${from}&size=${size}`;
}

interface NpmSearchObject {
  package: {
    name: string;
    version: string;
    description?: string;
    date?: string;
    publisher?: { username?: string };
    links?: { npm?: string; repository?: string; homepage?: string };
  };
  downloads?: { monthly?: number; weekly?: number };
}

export function parseSearch(body: { total?: number; objects?: NpmSearchObject[] }): MarketSearchResult {
  return {
    total: body.total ?? 0,
    packages: (body.objects ?? []).map(
      (o): MarketPackage => ({
        name: o.package.name,
        version: o.package.version,
        ...(o.package.description ? { description: o.package.description } : {}),
        ...(o.package.date ? { updated: Date.parse(o.package.date) } : {}),
        ...(o.package.publisher?.username ? { publisher: o.package.publisher.username } : {}),
        ...(o.downloads?.monthly !== undefined ? { monthlyDownloads: o.downloads.monthly } : {}),
        ...(o.package.links?.repository ? { repository: o.package.links.repository } : {}),
      }),
    ),
  };
}

interface NpmManifest {
  version?: string;
  description?: string;
  license?: string;
  pi?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface NpmDocument {
  name: string;
  description?: string;
  readme?: string;
  license?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, NpmManifest>;
  time?: Record<string, string>;
  repository?: { url?: string } | string;
}

/** 설치할 때 npm이 실행하는 스크립트 (Pi가 막는지와 상관없이 알린다) */
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];
const KINDS = ["extensions", "skills", "prompts", "themes"] as const;

export function parseDetail(doc: NpmDocument): MarketDetail {
  const latest = doc["dist-tags"]?.latest ?? "";
  const manifest = doc.versions?.[latest] ?? {};
  const pi = manifest.pi && typeof manifest.pi === "object" ? manifest.pi : undefined;
  // pi 매니페스트가 없으면 extensions/·skills/ 같은 관례 폴더로 찾으므로, 무엇이 들었는지 미리 알 수 없다.
  const kinds = pi ? KINDS.filter((k) => Array.isArray(pi[k]) && (pi[k] as unknown[]).length > 0) : [];
  const times = doc.time ?? {};
  const versions = Object.keys(doc.versions ?? {})
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => Date.parse(times[b] ?? "") - Date.parse(times[a] ?? "") || b.localeCompare(a))
    .slice(0, VERSIONS_MAX);
  const repository = typeof doc.repository === "string" ? doc.repository : doc.repository?.url;
  const readme = doc.readme ?? "";
  return {
    name: doc.name,
    latest,
    ...(doc.description ?? manifest.description ? { description: (doc.description ?? manifest.description)! } : {}),
    ...(manifest.license ?? doc.license ? { license: (manifest.license ?? doc.license)! } : {}),
    ...(repository ? { repository: repository.replace(/^git\+/, "") } : {}),
    readme: readme.length > README_MAX ? `${readme.slice(0, README_MAX)}\n\n…(README가 길어 잘랐습니다)` : readme,
    versions,
    ...(times[latest] ? { updated: Date.parse(times[latest]) } : {}),
    manifest: pi ? "declared" : "conventional",
    kinds: [...kinds],
    // 매니페스트가 없으면 extensions/ 폴더가 있을 수 있으므로 확장이 있다고 보고 경고한다.
    mayRunCode: pi ? kinds.includes("extensions") : true,
    dependencies: Object.keys(manifest.dependencies ?? {}),
    installScripts: INSTALL_SCRIPTS.filter((s) => manifest.scripts?.[s]),
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`npm 레지스트리 응답 ${response.status}: ${url}`);
  return (await response.json()) as T;
}

export async function searchPackages(query: string, from = 0, size = 20): Promise<MarketSearchResult> {
  return parseSearch(await getJson(searchUrl(query, Math.max(0, from), Math.min(Math.max(size, 1), 50))));
}

export async function packageDetail(name: string): Promise<MarketDetail> {
  if (!isNpmName(name)) throw new Error(`npm 패키지 이름이 아닙니다: ${name}`);
  // scope 패키지는 @scope%2fname 형태로 요청한다.
  return parseDetail(await getJson(`${REGISTRY}/${name.replace("/", "%2f")}`));
}
