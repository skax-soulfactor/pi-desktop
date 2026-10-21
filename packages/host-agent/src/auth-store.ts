import { execFile } from "node:child_process";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { AuthCheckResult, PiLocation, ProviderInfo } from "@pi-desktop/host-protocol";

const execFileAsync = promisify(execFile);

/**
 * 프로바이더와 자격 증명 (설계 §4.7 Providers).
 *
 * - 목록: 설치된 Pi가 쓰는 pi-ai의 내장 프로바이더(builtinProviders)와 models.json의 사용자 프로바이더.
 *   Pi 버전에 맞게 따라가도록 데몬 번들에 넣지 않고 그 Pi 옆의 pi-ai를 불러온다.
 * - auth.json은 Pi의 형식 그대로 다룬다: `{ "<provider>": { "type": "api_key", "key": "...", "env"?: {...} } }`.
 *   **키 값은 이 모듈 밖으로 내보내지 않는다.** 목록에는 저장된 자격 증명의 종류만 담는다.
 * - 쓰기는 임시 파일에 쓴 뒤 이름을 바꿔(원자적) 반쯤 쓴 파일이 남지 않게 하고, POSIX에서는 권한을 600으로 둔다.
 */

/** auth.json의 프로바이더 키로 허용하는 이름 (Pi 프로바이더 ID 형식) */
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID.test(value);
}

export function agentDirOf(env: NodeJS.ProcessEnv, home = homedir()): string {
  return env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
}

interface BuiltinProvider {
  id: string;
  name?: string;
  auth?: { apiKey?: unknown; oauth?: unknown };
}

/** 설치된 Pi 옆의 pi-ai에서 내장 프로바이더를 읽는다. 찾지 못하면 빈 목록 */
export async function loadBuiltinProviders(pi: PiLocation): Promise<BuiltinProvider[]> {
  // 관리형 설치·npm 전역: <...>/node_modules/@earendil-works/pi-coding-agent 옆에 pi-ai가 있다.
  // 개발용(작업 공간)처럼 끌어올려진 경우도 있어 위로 올라가며 node_modules를 찾는다.
  const candidates = [join(dirname(pi.packageDir), "pi-ai")];
  let dir = pi.packageDir;
  for (let i = 0; i < 6; i++) {
    candidates.push(join(dir, "node_modules", "@earendil-works", "pi-ai"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    const entry = join(candidate, "dist", "providers", "all.js");
    if (!(await stat(entry).catch(() => undefined))) continue;
    try {
      const mod = (await import(pathToFileURL(entry).href)) as { builtinProviders?: () => BuiltinProvider[] };
      return mod.builtinProviders?.() ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

type AuthFile = Record<string, Record<string, unknown>>;

async function readAuthFile(path: string): Promise<AuthFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("auth.json 형식이 올바르지 않습니다");
  return parsed as AuthFile;
}

async function writeAuthFile(path: string, data: AuthFile): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(temp, 0o600);
  await rename(temp, path);
}

async function customProviders(agentDir: string): Promise<string[]> {
  try {
    const models = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as { providers?: Record<string, unknown> };
    return Object.keys(models.providers ?? {});
  } catch {
    return [];
  }
}

/** 프로바이더 목록과 저장된 자격 증명의 종류 (값 없음) */
export async function listProviders(pi: PiLocation | undefined, agentDir: string): Promise<ProviderInfo[]> {
  const builtin = pi ? await loadBuiltinProviders(pi) : [];
  const auth = await readAuthFile(join(agentDir, "auth.json")).catch(() => ({}) as AuthFile);
  const stored = (id: string): ProviderInfo["stored"] => {
    const type = auth[id]?.type;
    return type === "api_key" || type === "oauth" ? type : auth[id] ? "other" : undefined;
  };
  const list: ProviderInfo[] = builtin.map((p) => {
    const info: ProviderInfo = {
      id: p.id,
      name: p.name ?? p.id,
      apiKey: Boolean(p.auth?.apiKey),
      oauth: Boolean(p.auth?.oauth),
      custom: false,
    };
    const s = stored(p.id);
    if (s) info.stored = s;
    return info;
  });
  const known = new Set(list.map((p) => p.id));
  // models.json에만 있는 프로바이더와, auth.json에만 있는 프로바이더도 보여준다.
  for (const id of [...(await customProviders(agentDir)), ...Object.keys(auth)]) {
    if (known.has(id)) continue;
    known.add(id);
    const info: ProviderInfo = { id, name: id, apiKey: true, oauth: false, custom: true };
    const s = stored(id);
    if (s) info.stored = s;
    list.push(info);
  }
  return list;
}

/** API 키를 저장한다. 같은 항목의 다른 필드(env 등)는 남기고 type·key만 바꾼다 */
export async function setApiKey(agentDir: string, provider: string, key: string): Promise<void> {
  const path = join(agentDir, "auth.json");
  const auth = await readAuthFile(path);
  const previous = auth[provider] && auth[provider].type === "api_key" ? auth[provider] : {};
  auth[provider] = { ...previous, type: "api_key", key };
  await writeAuthFile(path, auth);
}

/** 저장된 자격 증명을 지운다. 없으면 아무것도 하지 않는다 */
export async function removeCredential(agentDir: string, provider: string): Promise<boolean> {
  const path = join(agentDir, "auth.json");
  const auth = await readAuthFile(path);
  if (!(provider in auth)) return false;
  delete auth[provider];
  await writeAuthFile(path, auth);
  return true;
}

/**
 * `pi auth check --provider X --json`으로 확인한다 (ready / not_ready / invalid).
 * --credentials는 붙이지 않는다 (키를 출력하게 하지 않는다).
 */
export async function checkAuth(pi: PiLocation, provider: string, env: NodeJS.ProcessEnv): Promise<AuthCheckResult> {
  const args = [pi.cliPath, "auth", "check", "--provider", provider, "--json"];
  const run = async () => {
    try {
      const { stdout } = await execFileAsync(pi.nodePath ?? process.execPath, args, {
        env: { ...env, ...pi.env },
        timeout: 30_000,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      // not_ready(1)·invalid(2)도 종료 코드가 0이 아니므로 표준 출력을 그대로 읽는다.
      const stdout = (error as { stdout?: unknown }).stdout;
      if (typeof stdout === "string" && stdout.trim()) return stdout;
      throw error;
    }
  };
  const stdout = await run();
  const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
  const status = parsed.status;
  const result: AuthCheckResult = {
    provider,
    status: status === "ready" || status === "not_ready" || status === "invalid" ? status : "unknown",
  };
  if (typeof parsed.reason === "string") result.reason = parsed.reason;
  return result;
}
