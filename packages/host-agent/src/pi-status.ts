import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PiLatest, PiLocation, PiStatus, PiVersions } from "@pi-desktop/host-protocol";
import { locatePi, PI_PACKAGE_NAME } from "./pi-locator";

const execFileAsync = promisify(execFile);

/**
 * Pi Manager 상태 화면용 정보 (설계 §4.9 "상태 감지"). 읽기만 하고 아무것도 바꾸지 않는다.
 *
 * - auth.json은 프로바이더 이름만 읽는다. 키 값은 앱으로 보내지 않는다 (설계 §4.7).
 * - 세션 파일은 개수와 크기만 센다 (너무 많으면 일부만 세고 truncated).
 */

export interface PiStatusOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  /** 테스트용: Pi 찾기 */
  locate?: () => Promise<PiLocation>;
  /** 테스트용: 다른 node의 버전 읽기 */
  nodeVersionOf?: (nodePath: string) => Promise<string | undefined>;
  /** 세션 파일을 세는 최대 개수 */
  maxSessionFiles?: number;
}

export async function piStatus(options: PiStatusOptions = {}): Promise<PiStatus> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const agentDir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  const sessionDir = env.PI_CODING_AGENT_SESSION_DIR || join(agentDir, "sessions");

  let pi: PiLocation | undefined;
  let piError: string | undefined;
  try {
    pi = await (options.locate ?? (() => locatePi({ env, homeDir: home })))();
  } catch (error) {
    piError = error instanceof Error ? error.message : String(error);
  }

  const nodePath = pi?.nodePath ?? process.execPath;
  const nodeVersion = pi?.nodePath
    ? await (options.nodeVersionOf ?? nodeVersionOf)(pi.nodePath)
    : process.version;
  const required = pi ? await requiredNode(pi.packageDir) : undefined;

  const status: PiStatus = {
    platform,
    node: {
      path: nodePath,
      ...(nodeVersion ? { version: nodeVersion } : {}),
      ...(required ? { required } : {}),
      ok: Boolean(nodeVersion && (!required || satisfiesMinimum(nodeVersion, required))),
    },
    data: await agentData(agentDir, sessionDir, options.maxSessionFiles ?? 50_000),
  };
  if (pi) status.pi = pi;
  if (piError) status.piError = piError;
  if (platform === "win32") status.gitBash = await findGitBash(agentDir, env);
  return status;
}

/** "v22.19.0"이 ">=22.19.0"(최소 버전)을 만족하는지. 최소 버전 형식만 해석하고 모르면 만족으로 본다 */
export function satisfiesMinimum(version: string, range: string): boolean {
  const min = />=\s*v?(\d+(?:\.\d+){0,2})/.exec(range)?.[1];
  if (!min) return true;
  return compareVersions(version, min) >= 0;
}

/** 숫자 부분만 비교한다 (v 접두사, 프리릴리스 꼬리표는 무시). a가 크면 양수 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function requiredNode(packageDir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as { engines?: { node?: unknown } };
    return typeof pkg.engines?.node === "string" ? pkg.engines.node : undefined;
  } catch {
    return undefined;
  }
}

async function nodeVersionOf(nodePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(nodePath, ["--version"], { timeout: 10_000, windowsHide: true });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function agentData(agentDir: string, sessionDir: string, maxFiles: number): Promise<PiStatus["data"]> {
  const exists = await isDir(agentDir);
  const sessions = { count: 0, bytes: 0, truncated: false };
  const queue = [sessionDir];
  while (queue.length > 0 && !sessions.truncated) {
    const dir = queue.shift()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        sessions.count++;
        sessions.bytes += (await stat(path).catch(() => undefined))?.size ?? 0;
        if (sessions.count >= maxFiles) {
          sessions.truncated = true;
          break;
        }
      }
    }
  }
  return {
    agentDir,
    exists,
    sessionDir,
    sessions,
    authProviders: await authProviderNames(join(agentDir, "auth.json")),
    hasModelsJson: await isFile(join(agentDir, "models.json")),
    hasSettings: await isFile(join(agentDir, "settings.json")),
  };
}

/** auth.json의 프로바이더 이름만 돌려준다 (값은 읽어도 밖으로 내보내지 않는다) */
export async function authProviderNames(path: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.keys(parsed).sort();
  } catch {
    return [];
  }
}

/**
 * Windows에서 Pi의 bash 툴이 쓸 Git Bash. Pi와 같은 순서로 찾는다:
 * settings.json의 shellPath → Git for Windows 설치 경로.
 * (PATH의 bash.exe는 WSL 진입용 System32\bash.exe일 수 있어 찾지 않는다)
 */
async function findGitBash(agentDir: string, env: NodeJS.ProcessEnv): Promise<NonNullable<PiStatus["gitBash"]>> {
  const configured = await readShellPath(join(agentDir, "settings.json"));
  if (configured) return { found: await isFile(configured), path: configured, source: "settings" };
  const candidates = [
    env.ProgramFiles && join(env.ProgramFiles, "Git", "bin", "bash.exe"),
    env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (await isFile(path)) return { found: true, path, source: "git" };
  }
  return { found: false };
}

async function readShellPath(settingsPath: string): Promise<string | undefined> {
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { shellPath?: unknown };
    if (typeof settings.shellPath !== "string" || !settings.shellPath) return undefined;
    return settings.shellPath.replace(/^~(?=$|[\\/])/, homedir());
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false;
}

async function isDir(path: string): Promise<boolean> {
  try {
    await access(path);
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 최신 버전 조회 결과 캐시 (1시간). npm 레지스트리에 자주 묻지 않기 위해서다 */
const LATEST_TTL_MS = 60 * 60 * 1000;
/** 조회에 실패했으면 이만큼만 기억한다 */
const LATEST_ERROR_TTL_MS = 60 * 1000;
let latestCache: { at: number; value: PiLatest } | undefined;

/**
 * npm 레지스트리에서 Pi 최신 버전을 읽는다 (`npm view`). 네트워크가 없거나 npm이 없으면 오류를 담아 돌려준다.
 * @param force 캐시를 무시하고 다시 묻는다
 */
export async function latestPiVersion(
  force = false,
  view: () => Promise<string> = npmViewVersion,
  now: () => number = Date.now,
): Promise<PiLatest> {
  // 실패(네트워크가 아직 안 붙은 WSL 시작 직후 등)는 잠깐만 기억해, 업데이트 표시가 한 시간씩 막히지 않게 한다.
  const ttl = latestCache?.value.error ? LATEST_ERROR_TTL_MS : LATEST_TTL_MS;
  if (!force && latestCache && now() - latestCache.at < ttl) return latestCache.value;
  let value: PiLatest;
  try {
    value = { version: await view(), checkedAt: now() };
  } catch (error) {
    value = { error: error instanceof Error ? error.message.split("\n")[0]! : String(error), checkedAt: now() };
  }
  latestCache = { at: now(), value };
  return value;
}

/** 테스트용: 캐시 비우기 */
export function resetLatestCache(): void {
  latestCache = undefined;
}

/**
 * 앞의 방법이 실패하면 다음 방법으로 묻는다. 모두 실패하면 각 방법의 오류 첫 줄을 모아 던진다.
 * 최신 버전 조회는 npm 명령을 먼저 쓰고(사용자 npm 설정·프록시를 따른다), npm이 없거나 실패하면
 * (공식 설치기로 깐 WSL 등) npm 레지스트리에 HTTPS로 직접 묻는다.
 */
export async function firstSuccess<T>(attempts: ReadonlyArray<readonly [label: string, run: () => Promise<T>]>): Promise<T> {
  const errors: string[] = [];
  for (const [label, run] of attempts) {
    try {
      return await run();
    } catch (error) {
      errors.push(`${label}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
    }
  }
  throw new Error(errors.join(" / "));
}

/** npm 명령을 실행한다. 실패하면 "Command failed: …" 대신 npm이 남긴 마지막 오류 줄을 오류 메시지로 쓴다 */
async function runNpm(args: string[], maxBuffer?: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync("npm", args, {
      // Windows에서 npm은 npm.cmd라 셸을 거쳐야 실행된다.
      shell: process.platform === "win32",
      timeout: 20_000,
      windowsHide: true,
      ...(maxBuffer ? { maxBuffer } : {}),
    });
    return stdout;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const last = stderr
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    throw new Error(last ?? (error instanceof Error ? error.message : String(error)));
  }
}

/** npm 레지스트리의 Pi 패키지 정보 (설치용 축약본: dist-tags와 버전 목록만 쓴다) */
async function registryPackument(): Promise<{ "dist-tags"?: { latest?: unknown }; versions?: Record<string, unknown> }> {
  const response = await fetch(`https://registry.npmjs.org/${PI_PACKAGE_NAME.replace("/", "%2f")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as { "dist-tags"?: { latest?: unknown }; versions?: Record<string, unknown> };
}

async function npmViewVersion(): Promise<string> {
  return firstSuccess([
    ["npm", npmCliVersion],
    [
      "레지스트리",
      async () => {
        const latest = (await registryPackument())["dist-tags"]?.latest;
        if (typeof latest !== "string" || !/^\d+\.\d+\.\d+/.test(latest)) throw new Error("latest 태그가 없습니다");
        return latest;
      },
    ],
  ]);
}

async function npmCliVersion(): Promise<string> {
  const version = (await runNpm(["view", PI_PACKAGE_NAME, "version"])).trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`알 수 없는 응답: ${version.slice(0, 80)}`);
  return version;
}

let versionsCache: { at: number; value: PiVersions } | undefined;

/** npm 레지스트리에 배포된 Pi 버전 목록 (`npm view <pkg> versions --json`). 1시간 캐시, 실패하면 오류를 담는다 */
export async function piVersions(
  view: () => Promise<string[]> = npmViewVersions,
  now: () => number = Date.now,
): Promise<PiVersions> {
  if (versionsCache && now() - versionsCache.at < LATEST_TTL_MS) return versionsCache.value;
  let value: PiVersions;
  try {
    value = { versions: await view() };
  } catch (error) {
    value = { versions: [], error: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
  }
  versionsCache = { at: now(), value };
  return value;
}

/** 테스트용: 버전 목록 캐시 비우기 */
export function resetVersionsCache(): void {
  versionsCache = undefined;
}

async function npmViewVersions(): Promise<string[]> {
  return firstSuccess([
    ["npm", npmCliVersions],
    ["레지스트리", async () => Object.keys((await registryPackument()).versions ?? {})],
  ]);
}

async function npmCliVersions(): Promise<string[]> {
  const parsed = JSON.parse(await runNpm(["view", PI_PACKAGE_NAME, "versions", "--json"], 4 * 1024 * 1024)) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter((v): v is string => typeof v === "string");
}
