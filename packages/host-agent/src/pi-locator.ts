import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ErrorCodes, JsonRpcError, type PiLocation } from "@pi-desktop/host-protocol";

const execFileAsync = promisify(execFile);

/** 현재 패키지 이름. 구 이름(`@mariozechner/...`)은 0.73.1에서 멈췄으므로 찾지 않는다. */
export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export interface LocateOptions {
  /** 요청에서 직접 지정한 CLI 경로 (가장 우선) */
  piCliPath?: string;
  env?: NodeJS.ProcessEnv;
  /** 홈 디렉터리 (테스트에서 바꿔 끼울 때) */
  homeDir?: string;
  /** 테스트에서 `npm root -g` 결과를 바꿔 끼울 때 */
  npmGlobalRoot?: () => Promise<string | undefined>;
}

/**
 * 이 호스트에 설치된 Pi를 찾는다 (설계 §5.1).
 *
 * 순서: 요청 파라미터 → `PI_DESKTOP_PI_CLI` 환경 변수 → 관리형 설치(공식 설치기) → npm 전역 설치.
 * Windows의 `pi.cmd` shim을 거치지 않고 `node <cli.js>`로 직접 실행하기 위해 cli.js 경로를 돌려준다.
 * PATH 탐색과 Nix 설치는 M2(Pi Manager)에서 추가한다.
 */
export async function locatePi(options: LocateOptions = {}): Promise<PiLocation> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const tried: string[] = [];

  const candidates: Array<{ cliPath: string | undefined; source: PiLocation["source"] }> = [
    { cliPath: options.piCliPath, source: "param" },
    { cliPath: env.PI_DESKTOP_PI_CLI, source: "env" },
  ];
  for (const { cliPath, source } of candidates) {
    if (!cliPath) continue;
    tried.push(cliPath);
    const found = await fromCliPath(resolve(cliPath), source);
    if (found) return found;
  }

  const agentDir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  tried.push(join(agentDir, "install"));
  const managed = await fromManagedInstall(agentDir, env, home);
  if (managed) return managed;

  const globalRoot = await (options.npmGlobalRoot ?? npmGlobalRoot)();
  if (globalRoot) {
    const packageDir = join(globalRoot, ...PI_PACKAGE_NAME.split("/"));
    tried.push(packageDir);
    const found = await fromPackageDir(packageDir, "npm-global");
    if (found) return found;
  }

  throw new JsonRpcError(ErrorCodes.PiNotFound, "설치된 Pi를 찾지 못했습니다", { tried });
}

/** 관리형 설치의 버전 문자열로 허용하는 문자. 설치기의 런처 스크립트와 같은 규칙이다. */
const MANAGED_VERSION_PATTERN = /^[0-9A-Za-z._+-]+$/;

/**
 * 공식 설치기(`curl https://pi.dev/install.sh | sh`)가 만든 관리형 설치를 찾는다.
 *
 * 구조: `<agentDir>/install/current-version`에 현재 버전이 있고,
 * 실제 패키지는 `<agentDir>/install/releases/<버전>/node_modules/@earendil-works/pi-coding-agent`에 있다.
 * 설치기의 런처(`<agentDir>/bin/pi`)가 하는 일을 그대로 재현한다:
 * - `PI_MANAGED_INSTALL_ROOT`를 넘겨 `pi update`가 관리형 설치를 갱신하게 한다
 * - 설치기가 깐 Node(`~/.local/share/pi-node/current/bin`)가 있으면 그 node로 실행하고 PATH 앞에 둔다
 *
 * 이 런처는 셸 설정(.bashrc)에서만 PATH에 들어가므로, 비대화형으로 뜨는 데몬은 PATH로 찾을 수 없다.
 * 관리형 설치기는 macOS/Linux(WSL 포함) 전용이다.
 */
async function fromManagedInstall(
  agentDir: string,
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<PiLocation | undefined> {
  const root = join(agentDir, "install");
  let version: string;
  try {
    version = (await readFile(join(root, "current-version"), "utf8")).trim();
  } catch {
    return undefined;
  }
  if (!MANAGED_VERSION_PATTERN.test(version) || version === "." || version === "..") return undefined;

  const packageDir = join(root, "releases", version, "node_modules", ...PI_PACKAGE_NAME.split("/"));
  const found = await fromPackageDir(packageDir, "managed");
  if (!found) return undefined;

  const extraEnv: Record<string, string> = { PI_MANAGED_INSTALL_ROOT: root };
  const nodeBin = join(env.XDG_DATA_HOME || join(home, ".local", "share"), "pi-node", "current", "bin");
  const nodeExe = join(nodeBin, "node");
  if (await exists(nodeExe)) {
    found.nodePath = nodeExe;
    extraEnv.PATH = env.PATH ? `${nodeBin}${delimiter}${env.PATH}` : nodeBin;
  }
  found.env = extraEnv;
  return found;
}

/** cli.js 경로에서 위로 올라가며 Pi의 package.json을 찾는다. */
async function fromCliPath(cliPath: string, source: PiLocation["source"]): Promise<PiLocation | undefined> {
  if (!(await exists(cliPath))) return undefined;
  let dir = dirname(cliPath);
  for (let i = 0; i < 5; i++) {
    const pkg = await readPackageJson(join(dir, "package.json"));
    if (pkg?.name === PI_PACKAGE_NAME) {
      return { cliPath, packageDir: dir, version: String(pkg.version ?? "unknown"), source };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // package.json을 못 찾아도 사용자가 직접 지정한 경로라면 그대로 쓴다.
  return { cliPath, packageDir: dirname(cliPath), version: "unknown", source };
}

async function fromPackageDir(packageDir: string, source: PiLocation["source"]): Promise<PiLocation | undefined> {
  const pkg = await readPackageJson(join(packageDir, "package.json"));
  if (!pkg || pkg.name !== PI_PACKAGE_NAME) return undefined;
  const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin as Record<string, string> | undefined)?.pi;
  if (!bin) return undefined;
  const cliPath = join(packageDir, bin);
  if (!(await exists(cliPath))) return undefined;
  return { cliPath, packageDir, version: String(pkg.version ?? "unknown"), source };
}

async function npmGlobalRoot(): Promise<string | undefined> {
  try {
    // Windows에서 npm은 npm.cmd라 셸을 거쳐야 실행된다.
    const { stdout } = await execFileAsync("npm", ["root", "-g"], {
      shell: process.platform === "win32",
      timeout: 15_000,
      windowsHide: true,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function readPackageJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
