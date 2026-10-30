import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { LaunchSpec } from "../vendor/main/host-connection";
import { deployAgent, runCommand, shQuote, type RemoteRunner } from "../vendor/main/remote-agent";
import { explainSshError, remoteSh, sshArgs, sshExecutable, SSH_PREFIX } from "../vendor/main/ssh";
import type { SshHostConfig } from "../vendor/shared/api";

/**
 * 에이전트 앱의 호스트 (설계 DESIGN-APPS.md §4, §6 D3). 로컬·WSL·SSH 중 하나에 연결한다.
 *
 * Pi Desktop의 원격 배포(vendor/main/remote-agent.ts)를 그대로 쓰되 두 가지를 더한다.
 * - 데몬 홈을 `~/.pi-desktop-agent`로 띄운다 (PI_DESKTOP_HOME). Pi Desktop의 데몬·휴지통과 섞이지 않는다
 * - Pi가 `-e`로 불러올 agent-kit·pi-isolation을 그 호스트의 `~/.pi-desktop-agent/kits/<내용 해시>/`에 올린다.
 *   같은 내용이면 다시 올리지 않는다
 */

export const LOCAL_HOST_ID = "local";
export const WSL_PREFIX = "wsl:";
export { SSH_PREFIX };

/** 호스트 홈 아래 Agent 홈 폴더 이름 */
export const AGENT_HOME_DIR = ".pi-desktop-agent";

/** 세션을 열 때 그 호스트 기준으로 쓰는 경로 */
export interface HostPaths {
  /** 다른 호스트(WSL·SSH)인가. 경로를 `/`로 잇는다 */
  remote: boolean;
  /** 그 호스트의 Agent 홈 */
  home: string;
  /** 그 호스트의 agent-kit 폴더 */
  kitDir: string;
  /** 그 호스트의 pi-isolation 폴더 */
  isolationDir: string;
  /** 그 호스트의 사용자 홈 (새 대화의 기본 폴더) */
  userHome: string;
}

/** 올릴 파일 하나 (kit 폴더 기준 상대 경로, `/`로 잇는다) */
export interface KitFile {
  rel: string;
  data: Buffer;
}

export interface KitBundle {
  /** 내용 해시. 원격 폴더 이름이 된다 */
  hash: string;
  files: KitFile[];
}

/** 설치본에 싣는 것과 같은 범위 (electron-builder.yml의 agent-kit·pi-isolation filter) */
const KIT_PARTS = ["package.json", "src", "extensions"];

async function collectDir(root: string, prefix: string, out: KitFile[]): Promise<void> {
  for (const part of KIT_PARTS) {
    const path = join(root, part);
    const info = await stat(path).catch(() => undefined);
    if (!info) continue;
    if (info.isFile()) {
      out.push({ rel: `${prefix}/${part}`, data: await readFile(path) });
      continue;
    }
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) out.push({ rel: `${prefix}/${relative(root, full).split(sep).join("/")}`, data: await readFile(full) });
      }
    };
    await walk(path);
  }
}

/** 로컬의 agent-kit·pi-isolation을 모아 내용 해시를 붙인다 */
export async function collectKit(kitDir: string, isolationDir: string): Promise<KitBundle> {
  const files: KitFile[] = [];
  await collectDir(kitDir, "agent-kit", files);
  await collectDir(isolationDir, "pi-isolation", files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.rel).update("\0").update(file.data).update("\0");
  return { hash: hash.digest("hex").slice(0, 16), files };
}

/** 원격에서 kit을 풀어 놓는 셸 스크립트. 임시 폴더에 다 쓴 뒤 바꿔치기해, 반쯤 올라간 kit을 쓰지 않게 한다 */
export function unpackScript(base: string, bundle: KitBundle): string {
  const lines = ["set -e", `base=${shQuote(base)}`, 'tmp="$base.uploading.$$"', 'rm -rf "$tmp"', 'mkdir -p "$tmp"'];
  const dirs = new Set(bundle.files.map((f) => posix.dirname(f.rel)).filter((d) => d !== "."));
  for (const dir of [...dirs].sort()) lines.push(`mkdir -p "$tmp"/${shQuote(dir)}`);
  for (const file of bundle.files) {
    const encoded = file.data.toString("base64").replace(/.{1,76}/g, "$&\n");
    lines.push(`base64 -d > "$tmp"/${shQuote(file.rel)} <<'PI_KIT_EOF'`, `${encoded}PI_KIT_EOF`);
  }
  lines.push('touch "$tmp/.complete"', 'mkdir -p "$(dirname "$base")"', 'rm -rf "$base"', 'mv "$tmp" "$base"', "echo pi-desktop-kit=ok");
  return `${lines.join("\n")}\n`;
}

/** kit이 그 호스트에 없으면 올린다. 올린 폴더(<Agent 홈>/kits/<해시>)를 돌려준다 */
export async function deployKit(run: RemoteRunner, agentHome: string, bundle: KitBundle): Promise<string> {
  const base = `${agentHome}/kits/${bundle.hash}`;
  const probe = await run(`if [ -f ${shQuote(`${base}/.complete`)} ]; then echo pi-desktop-kit=1; else echo pi-desktop-kit=0; fi`);
  if (!probe.includes("pi-desktop-kit=1")) {
    // 스크립트를 표준 입력으로 넘겨 그 셸이 읽게 한다 (명령 줄 길이 제한을 피한다)
    const out = await run("sh -s", Buffer.from(unpackScript(base, bundle), "utf8"));
    if (!out.includes("pi-desktop-kit=ok")) throw new Error("agent-kit을 올리지 못했습니다");
  }
  return base;
}

export interface RemotePrepareOptions {
  /** 로컬의 번들된 Host Agent 파일 */
  agentScript: string;
  agentVersion: string;
  /** 로컬의 agent-kit·pi-isolation (올릴 내용) */
  kit: () => Promise<KitBundle>;
}

/** 연결 준비 결과: 연결기 실행 명령과 그 호스트 기준 경로 */
export interface Prepared {
  spec: LaunchSpec;
  paths: HostPaths;
}

/**
 * 원격 공통 절차: Node 확인 → Host Agent 올리기 → kit 올리기 → Agent 홈으로 데몬에 붙는 명령.
 * launch는 그 호스트에서 셸 스크립트를 실행하는 명령을 만든다 (wsl.exe·ssh).
 */
export async function prepareRemote(
  label: string,
  run: RemoteRunner,
  launch: (script: string) => { command: string; args: string[] },
  nodeHint: string,
  options: RemotePrepareOptions,
): Promise<Prepared> {
  const deployed = await deployAgent({ label, run, agentScript: options.agentScript, agentVersion: options.agentVersion, nodeHint, homeDir: AGENT_HOME_DIR });
  const home = `${deployed.home}/${AGENT_HOME_DIR}`;
  const base = await deployKit(run, home, await options.kit());
  const command = launch(`exec env PI_DESKTOP_HOME=${shQuote(home)} ${shQuote(deployed.node)} ${shQuote(deployed.remotePath)} connect`);
  return {
    spec: { ...command, agentBuild: deployed.agentBuild },
    paths: { remote: true, home, kitDir: `${base}/agent-kit`, isolationDir: `${base}/pi-isolation`, userHome: deployed.home },
  };
}

const WSL_EXE = "wsl.exe";

export function prepareWsl(distro: string, options: RemotePrepareOptions): Promise<Prepared> {
  const shell = (script: string) => ({ command: WSL_EXE, args: ["-d", distro, "--cd", "~", "--exec", "sh", "-c", script] });
  const label = `WSL(${distro})`;
  return prepareRemote(
    label,
    (script, input) => {
      const { command, args } = shell(script);
      return runCommand(command, args, label, input);
    },
    shell,
    "배포판에 Node.js 22 이상을 설치하세요 (Pi Desktop의 Pi 관리에서 안내합니다).",
    options,
  );
}

export function prepareSsh(host: SshHostConfig, options: RemotePrepareOptions): Promise<Prepared> {
  const ssh = sshExecutable();
  const label = `SSH(${host.name})`;
  const shell = (script: string) => ({ command: ssh, args: [...sshArgs(host), remoteSh(script)] });
  return prepareRemote(
    label,
    (script, input) => {
      const { command, args } = shell(script);
      return runCommand(command, args, label, input);
    },
    shell,
    "서버에 Node.js 22 이상을 설치하세요.",
    options,
  ).catch((error: unknown) => {
    throw new Error(explainSshError(error instanceof Error ? error.message : String(error)));
  });
}

/** 원격 kit의 확장 진입 파일 (로컬 package.json의 pi.extensions를 그 호스트 경로로) */
export async function remoteExtensionEntries(localKitDir: string, remoteKitDir: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(localKitDir, "package.json"), "utf8")) as { pi?: { extensions?: unknown } };
  const entries = Array.isArray(manifest.pi?.extensions) ? manifest.pi.extensions : [];
  return entries.filter((e): e is string => typeof e === "string").map((entry) => posix.join(remoteKitDir, entry));
}
