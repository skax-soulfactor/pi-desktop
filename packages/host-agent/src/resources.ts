import { stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { projectTrust, type TrustSdk } from "./trust";
import type {
  ConfiguredPackageInfo,
  ContextFileInfo,
  ResourceDiagnosticInfo,
  ResourceItem,
  ResourcesView,
} from "@pi-desktop/host-protocol";

/**
 * 작업 폴더에서 Pi가 불러오는 리소스 목록 (설계 §4.2~4.5, M4 첫 단계: 읽기 전용).
 *
 * 그 호스트에 설치된 Pi의 SDK로 Pi와 똑같이 찾는다 (pi-sdk.ts와 같은 방식).
 * - 프롬프트·스킬·AGENTS.md·시스템 프롬프트: DefaultResourceLoader를 noExtensions로 돌린다.
 * - 확장·테마: 확장 코드는 불러오는 순간 실행되므로, 패키지 매니저의 경로 해석(resolve)으로 목록만 얻는다.
 *   설치되지 않은 패키지는 설치하지 않고 건너뛴다.
 */

interface PiSourceInfo {
  path: string;
  source: string;
  scope: string;
  origin: "package" | "top-level";
}

interface PiResolvedResource {
  path: string;
  enabled: boolean;
  metadata: { source: string; scope: string; origin: "package" | "top-level" };
}

interface PiDiagnostic {
  type: "warning" | "error" | "collision";
  message: string;
  path?: string;
}

/** 이 파일이 쓰는 Pi SDK의 일부 */
export interface ResourceSdk extends TrustSdk {
  DefaultPackageManager: new (options: { cwd: string; agentDir: string; settingsManager: unknown }) => {
    resolve(onMissing?: (source: string) => Promise<"install" | "skip" | "error">): Promise<
      Record<"extensions" | "skills" | "prompts" | "themes", PiResolvedResource[]>
    >;
    listConfiguredPackages(): ConfiguredPackageInfo[];
  };
  DefaultResourceLoader: new (options: {
    cwd: string;
    agentDir: string;
    settingsManager: unknown;
    noExtensions: boolean;
  }) => {
    reload(): Promise<void>;
    getSkills(): {
      skills: Array<{ name: string; description: string; filePath: string; sourceInfo: PiSourceInfo; disableModelInvocation: boolean }>;
      diagnostics: PiDiagnostic[];
    };
    getPrompts(): {
      prompts: Array<{ name: string; description: string; argumentHint?: string; filePath: string; sourceInfo: PiSourceInfo }>;
      diagnostics: PiDiagnostic[];
    };
    getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
    getSystemPromptSource(): { path: string } | undefined;
    getAppendSystemPromptSources(): Array<{ path: string }>;
  };
}

export async function listResources(sdk: ResourceSdk, cwd: string, agentDir: string): Promise<ResourcesView> {
  const info = await stat(cwd).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`작업 폴더를 찾을 수 없습니다: ${cwd}`);

  const settingsManager = sdk.SettingsManager.create(cwd, agentDir);
  const packages = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager });
  const resolved = await packages.resolve(async () => "skip");
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true });
  await loader.reload();

  const { skills, diagnostics: skillDiagnostics } = loader.getSkills();
  const { prompts, diagnostics: promptDiagnostics } = loader.getPrompts();

  const promptItems: ResourceItem[] = prompts.map((p) => ({
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.argumentHint ? { argumentHint: p.argumentHint } : {}),
    path: p.filePath,
    enabled: true,
    ...sourceOf(p.sourceInfo),
  }));
  const skillItems: ResourceItem[] = skills.map((s) => ({
    name: s.name,
    ...(s.description ? { description: s.description } : {}),
    path: s.filePath,
    enabled: true,
    disableModelInvocation: s.disableModelInvocation,
    ...sourceOf(s.sourceInfo),
  }));

  return {
    cwd,
    agentDir,
    trust: projectTrust(sdk, cwd, agentDir),
    contextFiles: loader.getAgentsFiles().agentsFiles.map(
      (f): ContextFileInfo => ({
        path: f.path,
        scope: isInside(f.path, agentDir) ? "user" : "project",
        bytes: Buffer.byteLength(f.content, "utf8"),
      }),
    ),
    ...(loader.getSystemPromptSource() ? { systemPrompt: loader.getSystemPromptSource()!.path } : {}),
    appendSystemPrompt: loader.getAppendSystemPromptSources().map((s) => s.path),
    // 꺼 둔 프롬프트·스킬은 로더가 돌려주지 않으므로 경로 해석 결과에서 채운다.
    prompts: [...promptItems, ...disabledItems(resolved.prompts, promptName)],
    skills: [...skillItems, ...disabledItems(resolved.skills, skillName)],
    extensions: resolved.extensions.map((r) => resolvedItem(r, extensionName)),
    themes: resolved.themes.map((r) => resolvedItem(r, (path) => basename(path, extname(path)))),
    packages: packages.listConfiguredPackages().map((p) => ({
      source: p.source,
      scope: p.scope,
      filtered: p.filtered,
      ...(p.installedPath ? { installedPath: p.installedPath } : {}),
    })),
    diagnostics: [
      ...promptDiagnostics.map((d) => diagnostic("prompt", d)),
      ...skillDiagnostics.map((d) => diagnostic("skill", d)),
    ],
  };
}

function sourceOf(info: { source: string; scope: string; origin: string }) {
  return { scope: info.scope, source: info.source, fromPackage: info.origin === "package" };
}

function resolvedItem(r: PiResolvedResource, name: (path: string) => string): ResourceItem {
  return { name: name(r.path), path: r.path, enabled: r.enabled, ...sourceOf(r.metadata) };
}

function disabledItems(resolved: PiResolvedResource[], name: (path: string) => string): ResourceItem[] {
  return resolved.filter((r) => !r.enabled).map((r) => resolvedItem(r, name));
}

/** prompts/review.md → review */
export function promptName(path: string): string {
  return basename(path, extname(path));
}

/** skills/hello/SKILL.md → hello, skills/hello.md → hello */
export function skillName(path: string): string {
  return basename(path).toLowerCase() === "skill.md" ? basename(dirname(path)) : basename(path, extname(path));
}

/** extensions/my-ext.ts → my-ext, extensions/my-ext/index.ts → my-ext, builtin:mcp → mcp */
export function extensionName(path: string): string {
  if (path.startsWith("builtin:")) return path.slice("builtin:".length);
  const file = basename(path, extname(path));
  return file === "index" ? basename(dirname(path)) : file;
}

function diagnostic(kind: ResourceDiagnosticInfo["kind"], d: PiDiagnostic): ResourceDiagnosticInfo {
  return { kind, type: d.type, message: d.message, ...(d.path ? { path: d.path } : {}) };
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}
